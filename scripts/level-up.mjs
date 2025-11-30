// =============================================================
//   M E Z Z   –   L E V E L   U P   B U T T O N  (FINAL)
//   Works even when the sheet has NO level controls at all.
// =============================================================

const log = (...a) => DEBUG && console.log("MezzLevelUpButton |", ...a);

Array.prototype.sum || Object.defineProperty(Array.prototype, "sum", {
	enumerable: false,
	writable: true,
	value: function () {
		let tmp = 0;
		const len = this.length;
		for (let i = 0; i < len; ++i) tmp += this[i];
		return tmp;
	},
});

function isLevelUp(actor) {
	let xpCur = Number(actor?.system?.details?.xp?.value);
	if (isNaN(xpCur)) xpCur = 0;

	const lvlTarget = actor.items.filter(it => it.type === "class").map(it => it.system.levels || 0).sum();
	let xpMax = game.system.config.CHARACTER_EXP_LEVELS[lvlTarget];
	if (isNaN(xpMax)) xpMax = Number.MAX_SAFE_INTEGER;

	return xpCur >= xpMax;
}

async function unlock(actor) {
  const locked = actor.getFlag("mezz-comp", "inventoryLocked");
  await actor.setFlag("mezz-comp", "inventoryLocked", false);
  ui.notifications.info(`${actor.name}: inventoryLocked = false`);
}

async function lock(actor) {
  const locked = actor.getFlag("mezz-comp", "inventoryLocked");
  await actor.setFlag("mezz-comp", "inventoryLocked", true);
  ui.notifications.info(`${actor.name}: inventoryLocked = true`);
}

Hooks.on("renderActorSheetV2", (app, html) => {
  const actor = app.actor;
  if (!actor) return;
  if (actor.type !== "character") return;
  if (!actor.isOwner) return;
  const $html = html instanceof jQuery ? html : $(html);
  $html.on("click", "[data-action='findItem']", event => {
  const type = event.currentTarget.dataset.itemType;
  if (["class","race","background"].includes(type)) {
    unlock(actor);
  }
});
  
  const canLevel = isLevelUp(actor);
  if (!canLevel) return;
  // normalize jQuery

  // ensure this is the dnd5e2 sheet
  const isDnd5e2 =
    app.options?.classes?.includes("dnd5e2") ||
    $html.hasClass("dnd5e2") ||
    $html.closest(".dnd5e2").length > 0;
  if (!isDnd5e2) return;

  // Remove duplicates on rerender
  $html.find("[data-mezz-levelup-wrapper]").remove();

  // Create centered wrapper
  const $wrapper = $(`
    <div data-mezz-levelup-wrapper
         style="width: 100%; text-align: center; margin-top: 6px;">
    </div>
  `);

  // Create button
  const $btn = $(`
    <button type="button"
            class="imp-cls__btn-sheet-level-up"
            data-mezz-levelup="true"
            title="Level Up"
            style="width: 36px; height: 36px; font-size: 18px;">
      <i class="fa-solid fa-arrow-trend-up"></i>
    </button>
  `);

  $btn.on("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
	unlock(actor);
    mezzLevelUp(actor);
  });

  $wrapper.append($btn);

  // Insert button centered under the rest buttons
  const restRight = $html.find(".sheet-header .right").first();
  if (restRight.length) {
    restRight.after($wrapper);
  } else {
    $html.find(".sheet-header").first().append($wrapper);
  }
});

/* -------------------------------------------------------------
   LEVEL-UP LOGIC — WORKS EVEN IF THE SHEET HAS NO LEVEL BUTTONS
--------------------------------------------------------------*/
async function mezzLevelUp(actor) {
  log("Level-up button clicked for", actor.name);

  // Pick first class (we can add multiclass UI later)
  const cls = actor.items.find(i => i.type === "class");
  if (!cls) {
    ui.notifications.warn("Character has no class item.");
    return;
  }

  // Try official advancement manager
  try {
    const AdvMgr = game.dnd5e.applications.advancement.AdvancementManager;
    const mgr = AdvMgr.forLevelChange(actor, cls.id, +1);

    if (mgr?.steps?.length > 0) {
      log("Opening official Advancement UI");
      mgr.render({ force: true });
      return;
    }
  } catch (e) {
    log("AdvancementManager failed:", e);
  }

  // FALLBACK: manual level bump
  log("No advancement steps → manually increasing class level.");
  await cls.update({ "system.levels": cls.system.levels + 1 });

  ui.notifications.info(`Level increased: ${cls.name} ${cls.system.levels + 1}`);
  lock(actor);
}
