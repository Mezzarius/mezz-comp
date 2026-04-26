import { getSetting, sendChat, getModuleAsset } from "../utils.mjs";
import { showAuditToast } from "../audit-toast.mjs";

// ─── Container Burst ──────────────────────────────────────────────────────────

const _burstingActors = new Set();

Hooks.on("updateItem", async (item, _change, options, _userId) => {
  if (!getSetting("inventory")) return;
  if (!item.actor) return;

  const actor = item.actor;
  if (_burstingActors.has(actor.id)) return;
  _burstingActors.add(actor.id);

  try {
    const token = actor.getActiveTokens()[0];
    if (!token) return;

    const overloaded = actor.items.filter(i => {
      const cap   = i.system?.capacity?.weight?.value;
      const total = i.system?.contentsWeight;
      return cap != null && total != null && i.type !== "loot" && total > cap;
    });

    for (const container of overloaded) {
      if (!actor.items.get(container.id)) continue;

      sendChat(actor, `<b style="color:red">${container.name}</b> is overloaded and <b>BURSTS OPEN!</b>`);

      try {
        await AudioHelper.play(
          { src: getModuleAsset("assets/sounds/cloth-tearing.mp3"), volume: 0.8 },
          true
        );
      } catch {}

      const contents  = actor.items.filter(i => i.system?.container === container.id);
      const pileItems = contents.map(i => i.toObject());

      if (contents.length) {
        await actor.deleteEmbeddedDocuments("Item", contents.map(i => i.id), { noHook: true });
      }

      if (game.itempiles?.API && pileItems.length) {
        await game.itempiles.API.createItemPile({
          position: { x: token.center.x, y: token.center.y },
          items: pileItems,
          pileSettings: { locked: false, mergeItems: true, canStackItems: true }
        });
      }

      await actor.createEmbeddedDocuments("Item", [{
        name: `${container.name} (Broken)`,
        type: "loot",
        img:  container.img,
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

// ─── GM Audit Notify ──────────────────────────────────────────────────────────

async function notifyGM(message) {
  if (game.user.isGM) {
    showAuditToast(message);
    await appendToAuditLog(message);
  } else {
    game.socket.emit("module.mezz-comp", { type: "GM_NOTIFY", data: message });
  }
}

// Snapshot cache keyed "actor-<id>" or "item-<id>".
// Capped at 100 entries to prevent unbounded growth from missed update events.
const _preUpdateCache = new Map();
const _CACHE_MAX = 100;

function _cacheSet(key, value) {
  if (_preUpdateCache.size >= _CACHE_MAX) {
    _preUpdateCache.delete(_preUpdateCache.keys().next().value);
  }
  _preUpdateCache.set(key, value);
}

// ─── Actor monitor ────────────────────────────────────────────────────────────

const _IGNORED_ACTOR_PREFIXES = [
  "system.spells.",
  "system.attributes.encumbrance",
  "system.traits.",
  "system.bonuses.",
  "system.details.xp",
];

Hooks.on("preUpdateActor", (actor, changes, _options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;

  const flat     = foundry.utils.flattenObject(changes);
  const snapshot = {};

  for (const path of Object.keys(flat)) {
    if (!path.startsWith("system.") || path.startsWith("system._")) continue;
    snapshot[path] = foundry.utils.getProperty(actor, path);
  }

  _cacheSet(`actor-${actor.id}`, snapshot);
});

Hooks.on("updateActor", (actor, changes, _options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;

  const flat   = foundry.utils.flattenObject(changes);
  const before = _preUpdateCache.get(`actor-${actor.id}`) ?? {};
  _preUpdateCache.delete(`actor-${actor.id}`);

  const lines = [];

  for (const [path, newValue] of Object.entries(flat)) {
    if (!path.startsWith("system.") || path.startsWith("system._")) continue;
    if (_IGNORED_ACTOR_PREFIXES.some(p => path.startsWith(p))) continue;

    const oldValue = path in before ? before[path] : "?";
    const short    = path.startsWith("system.") ? path.slice(7) : path;
    lines.push(`${short}: <b>${oldValue}</b> → <b>${newValue}</b>`);
  }

  if (!lines.length) return;

  notifyGM(`🧾 ${user.name} modified <b>${actor.name}</b>: ${lines.join(" | ")}`);
});

// ─── Item monitor ─────────────────────────────────────────────────────────────

function _isNoisyItemPath(path) {
  return (
    path.startsWith("_") ||
    path.startsWith("flags.dnd5e") ||
    path.startsWith("flags.core") ||
    path === "sort"
  );
}

const _ITEM_PATH_LABELS = {
  "system.equipped":            "equipped",
  "system.quantity":            "quantity",
  "system.attunement.progress": "attuned",
};

function _friendlyItemLabel(path, oldValue, newValue) {
  const label = _ITEM_PATH_LABELS[path] ?? (path.startsWith("system.") ? path.slice(7) : path);
  return `${label}: <b>${oldValue}</b> → <b>${newValue}</b>`;
}

Hooks.on("preUpdateItem", (item, changes, options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;
  if (!item.actor || options?.noHook) return;

  const flat     = foundry.utils.flattenObject(changes);
  const snapshot = {};

  for (const path of Object.keys(flat)) {
    if (!path.startsWith("_")) {
      snapshot[path] = foundry.utils.getProperty(item, path);
    }
  }

  _cacheSet(`item-${item.id}`, snapshot);
});

Hooks.on("updateItem", (item, changes, options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;
  if (!item.actor || options?.noHook) return;

  const flat   = foundry.utils.flattenObject(changes);
  const before = _preUpdateCache.get(`item-${item.id}`) ?? {};
  _preUpdateCache.delete(`item-${item.id}`);

  const lines = [];

  for (const [path, newValue] of Object.entries(flat)) {
    if (_isNoisyItemPath(path)) continue;
    const oldValue = path in before ? before[path] : "?";
    lines.push(_friendlyItemLabel(path, oldValue, newValue));
  }

  if (!lines.length) return;

  notifyGM(`🎒 ${user.name} → <b>${item.name}</b> (${item.actor.name}): ${lines.join(" | ")}`);
});

Hooks.on("createItem", (item, _options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM || !item.actor) return;
  notifyGM(`➕ ${user.name} added <b>${item.name}</b> to <b>${item.actor.name}</b>`);
});

Hooks.on("deleteItem", (item, _options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM || !item.actor) return;
  notifyGM(`🗑 ${user.name} deleted <b>${item.name}</b> from <b>${item.actor.name}</b>`);
});

// ─── Audit Journal ────────────────────────────────────────────────────────────

let _auditJournal = null;

// Invalidate cache if the GM deletes the journal mid-session
Hooks.on("deleteJournalEntry", (doc) => {
  if (_auditJournal?.id === doc.id) _auditJournal = null;
});

async function _getAuditJournal() {
  if (_auditJournal) return _auditJournal;

  _auditJournal = game.journal.getName("Mezz Audit Log") ?? null;

  if (!_auditJournal && game.user.isGM) {
    _auditJournal = await JournalEntry.create({
      name:  "Mezz Audit Log",
      pages: [{ name: "Log", type: "text", text: { content: "<h2>Mezz Audit Log</h2><hr>" } }]
    });
  }

  return _auditJournal;
}

export async function appendToAuditLog(message) {
  if (!game.user.isGM) return;

  const journal = await _getAuditJournal();
  if (!journal) return;

  const page = journal.pages.contents[0];
  const time = new Date().toLocaleString();

  await page.update({
    "text.content": page.text.content + `<p><strong>[${time}]</strong><br>${message}</p><hr>`
  });
}
