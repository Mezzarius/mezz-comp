/******************************************************
 * MEZZ-COMP : Container Break + Inventory Guard
 * Uses Foundry's built-in item.system.totalWeight
 ******************************************************/

const DEBUG = true;
const D = (...args) => { if (DEBUG) console.log("MEZZ-COMP |", ...args); };
/* ============================
 * GM INVENTORY AUDIT LOG
 * ============================ */

function notifyGM(msg) {
  if (!game.user.isGM) return;
  ui.notifications.info(`Inventory Change: ${msg}`);
}

Hooks.on("preCreateItem", (itemData, options, userId) => {
  const actor = itemData?.parent;
  if (!actor) return true;

  notifyGM(`ADD → ${itemData.name} on ${actor.name}`);
  return true;
});

Hooks.on("preDeleteItem", (item, options, userId) => {
  const actor = item.parent;
  if (!actor) return true;

  notifyGM(`DELETE → ${item.name} from ${actor.name}`);
  return true;
});

Hooks.on("preUpdateItem", (item, change, options, userId) => {
  const flat = foundry.utils.flattenObject(change);
  if (!Object.keys(flat).length) return true;

  notifyGM(`UPDATE → ${item.name} on ${item.actor?.name}`);
  D("Item update details", flat);

  return true;
});

/* ============================
 * 3) CONTAINER BREAK LOGIC
 * ============================ */

Hooks.on("updateItem", async (item, change, options, userId) => {
  if (!game.user.isGM) return;

  const actor = item.actor;
  if (!actor) return;

  // Only care about containers
  const cap = item.system?.capacity?.weight?.value;
  const total = item.system?.contentsWeight;

  if (cap == null || total == null) return;

  // Only trigger if contentsWeight changed
  if (change.system?.contentsWeight === undefined) return;

  // Debounce: avoid repeated checks
  if (item.getFlag("mezz-comp", "breaking")) return;

  D("Container update detected", {
    actor: actor.name,
    container: item.name,
    capacity: cap,
    totalWeight: total
  });

  const name = item.name;

  // Warning zone
  if (total >= cap - 5 && total <= cap) {
    await ChatMessage.create({
      speaker: { alias: actor.name },
      content: `<b style="color:yellow">${name}</b> is starting to bulge at the seams!`
    });
    return;
  }

  if (total <= cap) return;

  // === BREAK CONTAINER ===
  await item.setFlag("mezz-comp", "breaking", true);

  D("BREAKING container", name);

  await ChatMessage.create({
    speaker: { alias: actor.name },
    content: `<b style="color:red">${name}</b> is overloaded and <b>BURSTS OPEN</b>!`
  });

  try {
    await AudioHelper.play({ src: "sounds/glass-break.mp3" }, true);
  } catch (err) {}

  // Add broken container item
  await actor.createEmbeddedDocuments("Item", [{
    name: `${name} (Broken)`,
    type: item.type,
    img: item.img,
    system: {
      description: { value: "This container shattered from excess weight." },
      weight: { value: item.system?.weight?.value }
    }
  }]);

  await item.delete();
});
