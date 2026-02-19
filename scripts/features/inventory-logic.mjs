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