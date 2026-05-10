import { getSetting, log } from "../utils.mjs";

Hooks.on("renderActorSheetV2", (app, html) => {
  if (!getSetting("levelUp")) return;
  const actor = app.actor;
  if (!actor || actor.type !== "character" || !actor.isOwner) return;
  const $html = html instanceof jQuery ? html : $(html);
  if (!isLevelUp(actor)) return;

  const $btn = $(`<button type="button" title="Level Up!" class="mezz-level-btn">
    <i class="fa-solid fa-angles-up"></i>
  </button>`);
  $btn.on("click", () => mezzLevelUp(actor));

  // Target the header-exp wrapper which holds the experience meter
  const $target = $html.find(".sheet-header .header-exp").first();
  if ($target.length) {
    $target.append($btn);
  } else {
    $html.find(".sheet-header").first().append($btn);
  }
});

function isLevelUp(actor) {
  let xpCur = Number(actor?.system?.details?.xp?.value || 0);
  const lvl = actor.items.filter(it => it.type === "class").reduce((a, c) => a + (c.system.levels || 0), 0);
  const xpMax = game.system.config.CHARACTER_EXP_LEVELS[lvl] ?? Number.MAX_SAFE_INTEGER;
  return xpCur >= xpMax;
}

async function pickClassDialog(actor) {
  const classes = actor.items.filter(i => i.type === "class");

  // Build options HTML — existing classes + add new
  const classOptions = classes.map(c =>
    `<option value="${c.id}">${c.name} (Lvl ${c.system.levels})</option>`
  ).join("");

  const content = `
    <form>
      <div class="form-group">
        <label>Choose a class to level up:</label>
        <select name="classId" id="mezz-class-select">
          ${classOptions}
          <option value="__new__">➕ Add New Class…</option>
        </select>
      </div>
    </form>`;

  return new Promise((resolve) => {
    new Dialog({
      title: "Level Up — Choose Class",
      content,
      buttons: {
        confirm: {
          icon: `<i class="fa-solid fa-arrow-trend-up"></i>`,
          label: "Level Up",
          callback: (html) => resolve(html.find("#mezz-class-select").val())
        },
        cancel: {
          icon: `<i class="fa-solid fa-times"></i>`,
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "confirm",
      close: () => resolve(null)
    }).render(true);
  });
}

async function addClassDialog(actor) {
  const pack = game.packs.get("mezz-comp.classes");
  if (!pack) {
    ui.notifications.error("mezz-comp.classes compendium not found.");
    return null;
  }

  const index = await pack.getIndex({ fields: ["type", "name", "img"] });
  let classItems = index.filter(e => e.type === "class").map(e => ({ ...e, packId: pack.metadata.id }));

  // Filter out classes the actor already has
  classItems = classItems.filter(c => !actor.items.some(a => a.type === "class" && a.name === c.name));
  classItems.sort((a, b) => a.name.localeCompare(b.name));

  if (!classItems.length) {
    ui.notifications.warn("No new classes available in mezz-comp.classes.");
    return null;
  }

  const options = classItems.map(c =>
    `<option value="${c._id}">${c.name}</option>`
  ).join("");

  const content = `
    <form>
      <div class="form-group">
        <label>Select a class to add:</label>
        <select name="classEntry" id="mezz-new-class-select">
          ${options}
        </select>
      </div>
    </form>`;

  return new Promise((resolve) => {
    new Dialog({
      title: "Add New Class",
      content,
      buttons: {
        add: {
          icon: `<i class="fa-solid fa-plus"></i>`,
          label: "Add Class",
          callback: async (html) => {
            const itemId = html.find("#mezz-new-class-select").val();
            const doc = await pack.getDocument(itemId);
            const itemData = doc?.toObject();

            if (!itemData) {
              ui.notifications.error("Could not load class item.");
              return resolve(null);
            }

            // Add at level 0 so AdvancementManager handles the first level
            foundry.utils.setProperty(itemData, "system.levels", 0);
            const [created] = await actor.createEmbeddedDocuments("Item", [itemData]);
            log(`Added class ${created.name} to ${actor.name}, handing off to AdvancementManager`);

            // Fire AdvancementManager for level 0 → 1
            try {
              const AdvMgr = game.dnd5e.applications.advancement.AdvancementManager;
              const mgr = AdvMgr.forLevelChange(actor, created.id, +1);
              if (mgr?.steps?.length > 0) {
                resolve(created);
                return mgr.render({ force: true });
              }
            } catch (e) {
              log(`AdvancementManager unavailable on class add, falling back: ${e}`);
            }

            // Fallback: just set level 1 manually
            await created.update({ "system.levels": 1 });
            ui.notifications.info(`${actor.name} gained their first level in ${created.name}!`);
            resolve(created);
          }
        },
        cancel: {
          icon: `<i class="fa-solid fa-times"></i>`,
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "add",
      close: () => resolve(null)
    }).render(true);
  });
}

async function mezzLevelUp(actor) {
  log(`Level Up clicked for ${actor.name}`);
  const classes = actor.items.filter(i => i.type === "class");

  let cls;

  if (classes.length === 0) {
    // No classes at all — go straight to add
    ui.notifications.info("No class found. Add a class first.");
    const added = await addClassDialog(actor);
    if (!added) return;
    // Adding already set the level, so we're done — just run advancement if possible
    cls = added;
  } else if (classes.length === 1) {
    // Single class: offer level-up or add new
    const choice = await pickClassDialog(actor);
    if (!choice) return;
    if (choice === "__new__") {
      await addClassDialog(actor);
      return;
    }
    cls = actor.items.get(choice);
  } else {
    // Multiple classes: always show picker
    const choice = await pickClassDialog(actor);
    if (!choice) return;
    if (choice === "__new__") {
      await addClassDialog(actor);
      return;
    }
    cls = actor.items.get(choice);
  }

  if (!cls) return ui.notifications.warn("Class not found on actor.");

  // Attempt AdvancementManager first
  try {
    const AdvMgr = game.dnd5e.applications.advancement.AdvancementManager;
    const mgr = AdvMgr.forLevelChange(actor, cls.id, +1);
    if (mgr?.steps?.length > 0) return mgr.render({ force: true });
  } catch (e) {
    log(`AdvancementManager unavailable, falling back: ${e}`);
  }

  // Fallback: manual level increment
  const newLevel = cls.system.levels + 1;
  await cls.update({ "system.levels": newLevel });
  ui.notifications.info(`${actor.name} advanced ${cls.name} to level ${newLevel}!`);
}