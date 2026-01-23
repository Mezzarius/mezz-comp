import { getSetting, log, sendChat } from "../utils.mjs";

Hooks.on("updateItem", async (item, change) => {
  if (!getSetting("inventory")) return;

  const actor = item.actor;
  if (!actor) return;

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
      await AudioHelper.play({ src: "modules/mezz-comp/assets/sounds/cloth-tearing.mp3" }, true);
    } catch {}

    await actor.createEmbeddedDocuments("Item", [{
      name: `${container.name} (Broken)`,
      type: "loot",
      img: container.img,
      system: { description: { value: "This container shattered from excess weight." }, weight: { value: container.system.weight.value, units: "${container.system.weight.units}" } }
    }]);
    await container.delete();
  }
});
