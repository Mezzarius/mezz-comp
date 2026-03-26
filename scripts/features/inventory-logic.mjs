import { getSetting, log, sendChat, getModuleAsset } from "../utils.mjs";

/**
 * In-memory guard replacing the async actor flag.
 * Using a synchronous Set means the check-and-set is instant with no await gap
 * where a second updateItem event could slip through.
 * Keyed by actor.id so multiple actors are tracked independently.
 */
const _burstingActors = new Set();

Hooks.on("updateItem", async (item, change, options, userId) => {
  if (!getSetting("inventory")) return;
  if (!item.actor) return;

  const actor = item.actor;

  // Synchronous guard — no await gap between check and set
  if (_burstingActors.has(actor.id)) return;
  _burstingActors.add(actor.id);

  try {
    const token = actor.getActiveTokens()[0];
    if (!token) return;

    // Snapshot overloaded containers NOW, before any mutations happen.
    // Also exclude items that are already broken/loot to avoid re-processing.
    const overloaded = actor.items.filter(i => {
      const cap = i.system?.capacity?.weight?.value;
      const total = i.system?.contentsWeight;
      if (cap == null || total == null) return false;
      if (i.type === "loot") return false;       // skip broken remnants
      if (total <= cap) return false;
      return true;
    });

    for (const container of overloaded) {
      // Guard: item may have already been deleted by a previous loop iteration
      if (!actor.items.get(container.id)) continue;

      sendChat(actor, `<b style="color:red">${container.name}</b> is overloaded and <b>BURSTS OPEN!</b>`);

      try {
        await AudioHelper.play(
          { src: getModuleAsset("assets/sounds/cloth-tearing.mp3"), volume: 0.8 },
          true
        );
      } catch {}

      // Snapshot contents before deletion
      const contents = actor.items.filter(i => i.system?.container === container.id);
      const pileItems = contents.map(i => i.toObject());

      if (contents.length) {
        await actor.deleteEmbeddedDocuments("Item", contents.map(i => i.id));
      }

      if (game.itempiles?.API && pileItems.length) {
        await game.itempiles.API.createItemPile({
          position: { x: token.center.x, y: token.center.y },
          items: pileItems,
          pileSettings: { locked: false, mergeItems: true, canStackItems: true }
        });
      }

      // Create broken remnant — use noHook so our monitor hooks ignore this
      await actor.createEmbeddedDocuments("Item", [{
        name: `${container.name} (Broken)`,
        type: "loot",
        img: container.img,
        system: {
          description: { value: "This container shattered from excess weight." },
          weight: container.system.weight
        }
      }], { noHook: true });

      await container.delete();
    }

  } finally {
    _burstingActors.delete(actor.id);
  }
});

/**
 * ==========================================
 *  PLAYER SHEET CHANGE MONITOR
 * ==========================================
 */

async function notifyGM(message) {
  if (game.user.isGM) {
    ui.notifications.warn(message);
    await appendToAuditLog(message);
  } else {
    game.socket.emit("module.mezz-comp", {
      // FIX: was "GM_NOTIFY" here but "GM_NOTFY" in main.mjs — standardised to GM_NOTIFY
      type: "GM_NOTIFY",
      data: message
    });
  }
}

/**
 * Cache of actor/item state snapshots, keyed by document id.
 * Populated in preUpdate hooks so we have "before" values on hand
 * when the corresponding update hook fires.
 */
const _preUpdateCache = new Map();

/**
 * Actor-wide changes (HP, stats, gold, etc.)
 */
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;

  const flat = foundry.utils.flattenObject(changes);
  const snapshot = {};

  for (const path of Object.keys(flat)) {
    if (!path.startsWith("system.") || path.startsWith("system._")) continue;
    snapshot[path] = foundry.utils.getProperty(actor, path);
  }

  _preUpdateCache.set(`actor-${actor.id}`, snapshot);
});

Hooks.on("updateActor", (actor, changes, options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;

  const flat = foundry.utils.flattenObject(changes);
  const before = _preUpdateCache.get(`actor-${actor.id}`) ?? {};
  _preUpdateCache.delete(`actor-${actor.id}`);

  const lines = [];

  for (const [path, newValue] of Object.entries(flat)) {
    if (!path.startsWith("system.") || path.startsWith("system._")) continue;

    // Ignore paths that dnd5e updates automatically as side-effects of other
    // changes (spell slot bookkeeping, currency weight, encumbrance, etc.).
    // These fire on every spell drag/item add and are not meaningful player edits.
    if (
      path.startsWith("system.spells.")      ||  // spell slot value/override changes
      path.startsWith("system.attributes.encumbrance") ||
      path.startsWith("system.traits.")      ||
      path.startsWith("system.bonuses.")     ||
      path.startsWith("system.details.xp")
    ) continue;

    const oldValue = path in before ? before[path] : "?";
    lines.push(`${path}: <b>${oldValue}</b> → <b>${newValue}</b>`);
  }

  if (!lines.length) return;

  const message =
    `🧾 ${user.name} modified <b>${actor.name}</b><br>` +
    lines.join("<br>");

  notifyGM(message);
});

/**
 * Item changes (quantity, equipped, etc.)
 */
Hooks.on("preUpdateItem", (item, changes, options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;
  if (!item.actor || options?.noHook) return;

  const flat = foundry.utils.flattenObject(changes);
  const snapshot = {};

  for (const path of Object.keys(flat)) {
    if (path.startsWith("_")) continue;
    snapshot[path] = foundry.utils.getProperty(item, path);
  }

  _preUpdateCache.set(`item-${item.id}`, snapshot);
});

Hooks.on("updateItem", (item, changes, options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;
  if (!item.actor || options?.noHook) return;

  const flat = foundry.utils.flattenObject(changes);
  const before = _preUpdateCache.get(`item-${item.id}`) ?? {};
  _preUpdateCache.delete(`item-${item.id}`);

  const lines = [];

  for (const [path, newValue] of Object.entries(flat)) {
    if (path.startsWith("_")) continue;
    const oldValue = path in before ? before[path] : "?";
    lines.push(`${path}: <b>${oldValue}</b> → <b>${newValue}</b>`);
  }

  if (!lines.length) return;

  const message =
    `🎒 ${user.name} modified <b>${item.name}</b> on <b>${item.actor.name}</b><br>` +
    lines.join("<br>");

  notifyGM(message);
});


Hooks.on("createItem", (item, options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;
  if (!item.actor) return;

  notifyGM(`➕ ${user.name} added ${item.name} to ${item.actor.name}`);
});


Hooks.on("deleteItem", (item, options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;
  if (!item.actor) return;

  notifyGM(`🗑 ${user.name} deleted ${item.name} from ${item.actor.name}`);
});

async function getAuditJournal() {
  let journal = game.journal.getName("Mezz Audit Log");

  if (!journal && game.user.isGM) {
    journal = await JournalEntry.create({
      name: "Mezz Audit Log",
      pages: [{
        name: "Log",
        type: "text",
        text: { content: "<h2>Mezz Audit Log</h2><hr>" }
      }]
    });
  }

  return journal;
}

// FIX: exported so main.mjs can import and call it from the socket handler
export async function appendToAuditLog(message) {
  if (!game.user.isGM) return;

  const journal = await getAuditJournal();
  if (!journal) return;

  const page = journal.pages.contents[0];
  const time = new Date().toLocaleString();

  const newContent =
    page.text.content +
    `<p><strong>[${time}]</strong><br>${message}</p><hr>`;

  await page.update({ "text.content": newContent });
}
