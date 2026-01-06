/******************************************************
 * MEZZ-COMP : Inventory Audit + Container Break (v13)
 ******************************************************/

const DEBUG = true;
const D = (...a) => DEBUG && console.log("MEZZ-COMP |", ...a);

/*Hooks.once("ready", () => {
  game.socket.on("module.mezz-comp", payload => {
    if (!game.user.isGM) return;

    if (payload.type === "inventory") {
      ui.notifications.info(payload.msg);
      console.log("MEZZ-COMP |", payload.msg);
    }
  });
});

/* ============================
 * GM NOTIFICATION (SAFE)
 * ============================ */
/*function notifyGM(msg) {
  if (!game.user.isGM) return;
  ui.notifications.info(`Inventory Change: ${msg}`);
}

/* ============================
 * INVENTORY AUDIT
 * ============================ */
/*Hooks.on("createItem", (item, options, userId) => {
  const actor = item.actor;
  if (!actor) return;
  notifyGM(`ADD → ${item.name} on ${actor.name}`);
});

Hooks.on("deleteItem", (item, options, userId) => {
  const actor = item.actor;
  if (!actor) return;
  notifyGM(`DELETE → ${item.name} from ${actor.name}`);
});
*/
Hooks.on("updateItem", async (item, change) => {
  const actor = item.actor;
  if (!actor) return;

  const flat = foundry.utils.flattenObject(change);
  if (!Object.keys(flat).length) return;

  // --- inventory audit ---
//  notifyGM(`UPDATE → ${item.name} on ${actor.name}`);

  // --- container scan ---
  const containers = actor.items.filter(i =>
    i.system?.capacity?.weight?.value != null &&
    i.system?.contentsWeight != null
  );

  for (const container of containers) {
    const cap = container.system.capacity.weight.value;
    const total = container.system.contentsWeight;

    if (cap == null || total == null) continue;

    D("Container check", {
      container: container.name,
      capacity: cap,
      contents: total
    });

    /* ============================
     * RESET ZONE
     * ============================ */
    if (total <= cap) {
      continue;
    }

    /* ============================
     * WARNING
     * ============================ 
    if (total <= cap) {
      await ChatMessage.create({
        speaker: { alias: actor.name },
        content: `<b style="color:orange">${container.name}</b> is starting to bulge at the seams!`
      });
      continue;
    }
	*/
    /* ============================
     * BREAK
     * ============================ */
    await ChatMessage.create({
      speaker: { alias: actor.name },
      content: `<b style="color:red">${container.name}</b> is overloaded and <b>BURSTS OPEN</b>!`
    });

    try {
      await AudioHelper.play({ src: "modules/mezz-comp/assets/sounds/cloth-tearing.mp3" }, true);
    } catch {}

    await actor.createEmbeddedDocuments("Item", [{
      name: `${container.name} (Broken)`,
      type: "loot",
      img: container.img,
      system: {
        description: { value: "This container shattered from excess weight." },
        weight: { value: container.system?.weight?.value ?? 0 }
      }
    }]);

    await container.delete();
  }
});
