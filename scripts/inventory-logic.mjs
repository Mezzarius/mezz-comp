/******************************************************
 * MEZZ-COMP : Container Break + Inventory Guard
 * Uses Foundry's built-in item.system.totalWeight
 ******************************************************/

const DEBUG = true;
const D = (...args) => { if (DEBUG) console.log("MEZZ-COMP |", ...args); };

/* ============================
 * 1) PREVENT QUANTITY EDITS
 * ============================ */

Hooks.on("preUpdateItem", (item, update, options, userId) => {
  if (game.user.isGM) return true;

  const flat = foundry.utils.flattenObject(update);
  const fromSheet = options?.renderSheet !== false;
  const changingQty = flat["system.quantity"] !== undefined;
  const locked = item.actor?.getFlag?.("mezz-comp", "inventoryLocked");

  if (locked == false) return true;


  D("preUpdateItem fired", {
    actor: item.actor?.name,
    item: item.name,
    flat,
    fromSheet,
    changingQty
  });

  // Only block quantity edits from the sheet
  if (fromSheet && changingQty) {
    ui.notifications.error("You cannot change item quantities directly.");
    if (item.sheet?.rendered) item.sheet.render(); // snap UI back
    return false;
  }

  return true;
});

/* ============================
 * 2) PREVENT MANUAL CREATE/DELETE
 * ============================ */

Hooks.on("preCreateItem", (itemData, options, userId) => {
  if (game.user.isGM) return true;

  const fromSheet = options?.renderSheet !== false;
  const actor = itemData?.parent;
  const locked = item.actor?.getFlag?.("mezz-comp", "inventoryLocked");

  if (locked == false) return true;

  D("preCreateItem fired", { itemName: itemData.name, fromSheet });

  if (fromSheet) {
    ui.notifications.error("You cannot manually add items.");
    return false;
  }

  return true;
});

/*Hooks.on("preDeleteItem", (item, options, userId) => {
  if (game.user.isGM) return true;

  const fromSheet = options?.renderSheet !== false;
  const actor = item?.parent;
  const locked = item.actor?.getFlag?.("mezz-comp", "inventoryLocked");
  
  if (locked == false) return true;
  
  D("preDeleteItem fired", { itemName: item.name, fromSheet });

  if (fromSheet) {
    ui.notifications.error("You cannot manually delete items.");
    return false;
  }

  return true;
});
*/
/* ============================
 * 3) CONTAINER BREAK LOGIC
 * ============================ */

Hooks.on("updateItem", async (item, change, options, userId) => {
  const actor = item.actor;
  if (!actor) return;

  D("updateItem fired", {
    actor: actor.name,
    item: item.name,
    type: item.type,
    change
  });

  // Only let the GM actually perform the destructive action
  if (!game.user.isGM) return;

  // Scan ALL items on this actor and find any containers that are over capacity
  for (const container of actor.items) {
    const cap = container.system?.capacity?.weight?.value;
	const weight = container.systems?.weight?.value;
    const total = container.system?.contentsWeight;

    // Only care about things that actually have capacity + totalWeight
    if (cap == null || total == null) continue;

    D("  Checking container", {
      container: container.name,
      capacity: cap,
      totalWeight: total
    });

	if (total >= (capacity - 5) && total <= capacity) { 
	  await ChatMessage.create({
      speaker: { alias: actor.name },
      content: `<b style="color:yellow">${name}</b> is starting to bulge at the seams!<b>BULGING</b>!`
      });
	}
	    if (total <= cap) continue; // safe

    // === BREAK THIS CONTAINER ===
    const name = container.name;
    D("  >>> BREAKING CONTAINER:", name);

    await ChatMessage.create({
      speaker: { alias: actor.name },
      content: `<b style="color:red">${name}</b> is overloaded and <b>BURSTS OPEN</b>!`
    });

    try {
      await AudioHelper.play({ src: "sounds/glass-break.mp3" }, true);
    } catch (err) {
      console.warn("MEZZ-COMP | Failed to play break sound:", err);
    }

    // Drop a broken version in their inventory
    await actor.createEmbeddedDocuments("Item", [{
      name: `${name} (Broken)`,
      type: "loot",            // adjust if your system uses different type
      img: container.img,
      system: {
        description: {
          value: "This container shattered from excess weight."
        },
		weight: {
		  value: container.system?.weight?.value
		}
      }
    }]);

    // Delete the original – Foundry will dump contents into root inventory
    await container.delete();
 }
});
