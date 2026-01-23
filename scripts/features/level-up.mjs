import { getSetting, log } from "../utils.mjs";

Hooks.on("renderActorSheetV2", (app, html) => {
  if (!getSetting("levelUp")) return;
  const actor = app.actor;
  if (!actor || actor.type !== "character" || !actor.isOwner) return;
  const $html = html instanceof jQuery ? html : $(html);
  if (!isLevelUp(actor)) return;

  const $btn = $(`<button type="button" title="Level Up" class="mezz-level-btn">
    <i class="fa-solid fa-arrow-trend-up"></i>
  </button>`);

  $btn.on("click", () => mezzLevelUp(actor));

  $html.find(".sheet-header").first().append($btn);
});

function isLevelUp(actor) {
  let xpCur = Number(actor?.system?.details?.xp?.value || 0);
  const lvl = actor.items.filter(it => it.type === "class").reduce((a, c) => a + (c.system.levels || 0), 0);
  const xpMax = game.system.config.CHARACTER_EXP_LEVELS[lvl] ?? Number.MAX_SAFE_INTEGER;
  return xpCur >= xpMax;
}

async function mezzLevelUp(actor) {
  log(`Level Up clicked for ${actor.name}`);
  const cls = actor.items.find(i => i.type === "class");
  if (!cls) return ui.notifications.warn("No class item found.");
  try {
    const AdvMgr = game.dnd5e.applications.advancement.AdvancementManager;
    const mgr = AdvMgr.forLevelChange(actor, cls.id, +1);
    if (mgr?.steps?.length > 0) return mgr.render({ force: true });
  } catch {}
  await cls.update({ "system.levels": cls.system.levels + 1 });
  ui.notifications.info(`${actor.name} advanced to level ${cls.system.levels + 1}!`);
}
