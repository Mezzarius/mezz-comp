import { PAPERDOLL_SLOTS } from "./paperdoll-config.mjs";

const MODULE_ID = "mezz-comp";

function injectPaperdoll(actor, root) {
  if (!actor || actor.type !== "character") return;

  const portrait = root.querySelector("div.portrait");
  if (!portrait) {
    console.warn(`mezz-comp | paperdoll: div.portrait not found on ${actor.name}'s sheet`);
    return;
  }

  // Don't double-inject on re-renders
  if (portrait.querySelector(".mezz-paperdoll")) return;

  const flagSlots = actor.flags?.[MODULE_ID]?.paperdoll ?? {};

  // Wrapper sits over the portrait
  const wrapper = document.createElement("div");
  wrapper.className = "mezz-paperdoll";
  wrapper.style.cssText = [
    "position:absolute",
    "inset:0",
    "width:100%",
    "height:100%",
    "pointer-events:none",
    "z-index:10"
  ].join(";");

  // Dim overlay
  const overlay = document.createElement("div");
  overlay.style.cssText = [
    "position:absolute",
    "inset:0",
    "background:rgba(0,0,0,0.35)",
    "pointer-events:none"
  ].join(";");
  wrapper.appendChild(overlay);

  // Slots — config uses pixel coords on ~320x400 canvas, convert to %
  const CANVAS_W = 320;
  const CANVAS_H = 400;

  for (const [slotKey, slotDef] of Object.entries(PAPERDOLL_SLOTS)) {
    const el = document.createElement("div");
    el.className = "mezz-slot";
    el.dataset.slot = slotKey;
    el.title = slotDef.label;
    el.style.cssText = [
      "position:absolute",
      `left:${((slotDef.x / CANVAS_W) * 100).toFixed(1)}%`,
      `top:${((slotDef.y / CANVAS_H) * 100).toFixed(1)}%`,
      "width:36px",
      "height:36px",
      "transform:translate(-50%,-50%)",
      "background:rgba(0,0,0,0.55)",
      "border:2px solid #00aaff",
      "border-radius:6px",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "cursor:pointer",
      "box-sizing:border-box",
      "pointer-events:all"
    ].join(";");

    const itemId = flagSlots[slotKey];
    if (itemId) {
      const item = actor.items.get(itemId);
      if (item) {
        const icon = document.createElement("img");
        icon.src = item.img;
        icon.style.cssText = "width:28px;height:28px;border:none;border-radius:3px;";
        icon.title = item.name;
        el.appendChild(icon);
      }
    } else {
      const label = document.createElement("span");
      label.textContent = slotDef.label.charAt(0);
      label.style.cssText = "color:rgba(255,255,255,0.45);font-size:10px;pointer-events:none;user-select:none;";
      el.appendChild(label);
    }

    // Wire up drop handler directly on the slot
    el.addEventListener("dragover", ev => ev.preventDefault());
    el.addEventListener("drop", async ev => {
      ev.preventDefault();
      let data;
      try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
      if (!data?.uuid) return;
      const item = await fromUuid(data.uuid);
      if (!item) return;
      const slot = ev.currentTarget.dataset.slot;
      const rule = PAPERDOLL_SLOTS[slot];
      if (!rule) return;
      if (!rule.accepts.includes(item.type)) {
        ui.notifications.warn(`Cannot equip ${item.name} in ${slot}`);
        return;
      }
      await actor.setFlag(MODULE_ID, `paperdoll.${slot}`, item.id);
    });

    wrapper.appendChild(el);
  }

  // Make portrait relative so our absolute wrapper anchors inside it
  if (getComputedStyle(portrait).position === "static") {
    portrait.style.position = "relative";
  }

  portrait.appendChild(wrapper);
}

// dnd5e v5.x / Foundry v13 fires renderActorSheet5e2 for App V2 sheets
Hooks.on("renderActorSheet5e2", (sheet, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (root) injectPaperdoll(sheet.actor, root);
});

// Fallback for older sheet versions
Hooks.on("renderActorSheet", (sheet, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (root) injectPaperdoll(sheet.actor, root);
});
