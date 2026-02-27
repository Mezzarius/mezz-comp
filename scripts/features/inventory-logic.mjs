import { getSetting, log, sendChat, getModuleAsset } from "../utils.mjs";

Hooks.on("updateItem", async (item, change, options, userId) => {
  if (!getSetting("inventory")) return;
  if (!item.actor) return;

  const actor = item.actor;

  // Prevent recursion loop
  if (actor.getFlag("mezz-comp", "processingContainerBurst")) return;
  await actor.setFlag("mezz-comp", "processingContainerBurst", true);

  try {

    const token = actor.getActiveTokens()[0];
    if (!token) return;

    const containers = actor.items.filter(i =>
      i.system?.capacity?.weight?.value != null &&
      i.system?.contentsWeight != null
    );

    for (const container of containers) {

      const cap = container.system.capacity.weight.value;
      const total = container.system.contentsWeight;

      if (cap == null || total == null) continue;
      if (total <= cap) continue;

      sendChat(actor, `<b style="color:red">${container.name}</b> is overloaded and <b>BURSTS OPEN!</b>`);

      try {
        await AudioHelper.play(
          { src: getModuleAsset("assets/sounds/cloth-tearing.mp3"),
		  volume: 0.8
		  }, true);
      } catch {}

      // Get items inside container
      const contents = actor.items.filter(i =>
        i.system?.container === container.id
      );

      const pileItems = contents.map(i => i.toObject());

      // Delete contents from actor
      if (contents.length) {
        await actor.deleteEmbeddedDocuments(
          "Item",
          contents.map(i => i.id)
        );
      }

      // Spawn Item Pile at token location
      if (game.itempiles?.API && pileItems.length) {
        await game.itempiles.API.createItemPile({
          position: {
            x: token.center.x,
            y: token.center.y
          },
          items: pileItems,
          pileSettings: {
            locked: false,
            mergeItems: true,
            canStackItems: true
          }
        });
      }

      // Create Broken container
      await actor.createEmbeddedDocuments("Item", [{
        name: `${container.name} (Broken)`,
        type: "loot",
        img: container.img,
        system: {
          description: {
            value: "This container shattered from excess weight."
          },
          weight: container.system.weight
        }
      }]);

      await container.delete();
    }

  } finally {
    await actor.unsetFlag("mezz-comp", "processingContainerBurst");
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
      type: "GM_NOTIFY",
      data: message
    });
  }
}
/**
 * Actor-wide changes (HP, stats, gold, etc.)
 */

Hooks.on("updateActor", (actor, changes, options, userId) => {
  const user = game.users.get(userId);
  if (!user) return;

  const flat = foundry.utils.flattenObject(changes);

  const lines = [];

  for (const [path, value] of Object.entries(flat)) {
    if (!path.startsWith("system.")) continue;
    if (path.startsWith("system._")) continue;

    lines.push(`${path} → ${value}`);
  }

  if (!lines.length) return;

  const message =
    `🧾 ${user.name} modified ${actor.name}<br>` +
    lines.join("<br>");

  if (game.user.isGM) {
    ui.notifications.warn(message);
  } else {
    game.socket.emit("module.mezz-comp", {
      type: "GM_NOTIFY",
      data: message
    });
  }
});
/**
 * Item changes (quantity, equipped, etc.)
 */
Hooks.on("updateItem", (item, changes, options, userId) => {
  const user = game.users.get(userId);
  if (!user || user.isGM) return;

  if (!item.actor) return;
  if (options?.noHook) return;

  notifyGM(`🎒 ${user.name} modified ${item.name} on ${item.actor.name}`);
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

async function appendToAuditLog(message) {
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