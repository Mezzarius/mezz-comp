import { PAPERDOLL_SLOTS } from "./slots.mjs";

const MODULE_ID = "mezz-comp";

Hooks.on("renderActorSheet", async (sheet, html) => {

  const actor = sheet.actor;
  if (!actor || actor.type !== "character") return;

  const portrait = html[0].querySelector("div.portrait");
  if (!portrait) return;

  if (portrait.querySelector(".mezz-paperdoll")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "mezz-paperdoll";

  const img = document.createElement("img");
  img.className = "mezz-paperdoll-bg";

  const portraitImg = portrait.querySelector("img");
  img.src = portraitImg?.src || actor.img;

  wrapper.appendChild(img);

  const slots = actor.flags?.["mezz-comp"]?.paperdoll ?? {};

  for (const slotId in PAPERDOLL_SLOTS) {

    const slot = PAPERDOLL_SLOTS[slotId];

    const el = document.createElement("div");
    el.className = "mezz-slot";
    el.dataset.slot = slotId;

    el.style.left = slot.x + "%";
    el.style.top = slot.y + "%";

    const itemId = slots[slotId];

    if (itemId) {

      const item = actor.items.get(itemId);

      if (item) {

        const icon = document.createElement("img");
        icon.src = item.img;

        el.appendChild(icon);

      }

    }

    wrapper.appendChild(el);

  }

  portrait.innerHTML = "";
  portrait.appendChild(wrapper);

});