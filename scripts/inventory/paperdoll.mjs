import { PAPERDOLL_SLOTS } from "./paperdoll-config.mjs";

const MODULE_ID = "mezz-comp";

export function getPaperdollData(actor) {

  const slots = {};
  // FIX: was reading from actor.system.paperdoll which doesn't exist.
  // Flags are stored under actor.flags["mezz-comp"].paperdoll by paperdoll-init.mjs.
  const flagSlots = actor.flags?.[MODULE_ID]?.paperdoll ?? {};

  for (const [key, slot] of Object.entries(PAPERDOLL_SLOTS)) {

    const itemId = flagSlots[key];
    const item = itemId ? actor.items.get(itemId) : null;

    slots[key] = {
      ...slot,
      item
    };

  }

  return slots;

}

export function canEquip(item, slot) {

  const rule = PAPERDOLL_SLOTS[slot];

  if (!rule) return false;

  return rule.accepts.includes(item.type);

}

export async function equipItem(actor, item, slot) {

  if (!canEquip(item, slot)) {
    ui.notifications.warn(`Cannot equip ${item.name} in ${slot}`);
    return;
  }

  // FIX: was writing to actor.update({ "system.paperdoll.X": id }) which
  // doesn't exist in dnd5e's data model. Must use setFlag instead.
  await actor.setFlag(MODULE_ID, `paperdoll.${slot}`, item.id);

}

export function registerPaperdollHooks() {

  Hooks.on("renderActorSheet", (sheet, html) => {

    // FIX: html[0] is the raw DOM element; .find() is a jQuery method.
    // Support both jQuery-wrapped and raw element contexts.
    const root = html[0] ?? html;

    root.querySelectorAll(".pd-slot").forEach(slotEl => {

      slotEl.addEventListener("drop", async (ev) => {

        ev.preventDefault();

        let data;
        try {
          data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        } catch {
          return;
        }

        if (!data?.uuid) return;

        const item = await fromUuid(data.uuid);
        if (!item) return;

        const slot = ev.currentTarget.dataset.slot;
        if (!slot) return;

        await equipItem(sheet.actor, item, slot);

      });

    });

  });

}
