/******************************************************
 * Mezz's Comp (v13) — Main Entry
 ******************************************************/
import { registerSettings } from "./settings.mjs";
import { log, safeRun } from "./utils.mjs";
import { handleProjectile, handleProjectileDropAsGM, embedProjectileOnTargetAsGM } from "./features/projectile-tracker.mjs";
import { handleFumble } from "./features/fumbles.mjs";
import { registerLockpickHooks, registerLockpickSocket } from "./features/lockpick-hooks.mjs";
import { appendToAuditLog } from "./features/inventory-logic.mjs";

// Submodules
import "./features/adaptive.mjs";
import "./features/dsn-fix.mjs";
import "./features/inventory-logic.mjs";
import "./features/level-up.mjs";

// Paperdoll — single entry point
import "./inventory/paperdoll-init.mjs";
import "./inventory/paperdoll-containers.mjs";
import "./inventory/paperdoll-ui.mjs";

import { MezzCharacterCreator } from "./character-creator.mjs";

Handlebars.registerHelper("capitalize", s => s.charAt(0).toUpperCase() + s.slice(1));
Handlebars.registerHelper("uppercase",  s => s.toUpperCase());
Handlebars.registerHelper("signedInt",  n => n >= 0 ? `+${n}` : `${n}`);
Handlebars.registerHelper("isDefined",  v => v !== undefined && v !== null);
Handlebars.registerHelper("add",  (a, b) => a + b);
Handlebars.registerHelper("sum",  arr => arr.reduce((a, b) => a + b, 0));
Handlebars.registerHelper("gt",   (a, b) => a > b);
Handlebars.registerHelper("lt",   (a, b) => a < b);
Handlebars.registerHelper("eq",   (a, b) => a === b);

Hooks.on("renderActorDirectory", (app, html) => {
  if (!game.user.can("ACTOR_CREATE")) return;
  const $html = html instanceof jQuery ? html : $(html);
  const $actions = $html.find(".directory-header .header-actions");
  if (!$actions.length) return;
  if ($actions.find(".mezz-create-char-btn").length) return;
  const $btn = $(`<button class="mezz-create-char-btn">
    <i class="fa-solid fa-user-plus"></i> New Character
  </button>`);
  $btn.on("click", () => new MezzCharacterCreator().render(true));
  $actions.prepend($btn);
});

Hooks.once("init", () => {
  console.log("🧩 Mezz's Comp | Initializing...");
  registerSettings();
});

Hooks.once("socketlib.ready", () => {
  registerLockpickSocket();
});

Hooks.once("ready", async () => {
  log("🧩 Mezz's Comp | Module Ready.");
  const version = game.modules.get("mezz-comp")?.version ?? "unknown";
  ui.notifications.info(`Mezz's Comp v${version} loaded.`);

  if (game.settings.get("mezz-comp", "lockpick")) {
    registerLockpickHooks();
  }
});

Hooks.once("ready", () => {
  game.socket.on("module.mezz-comp", async (payload) => {
    if (!game.user.isGM) return;

    switch (payload?.type) {
      case "DROP_PROJECTILE":
        await handleProjectileDropAsGM(payload.data);
        break;
      case "EMBED_PROJECTILE":
        await embedProjectileOnTargetAsGM(payload.data);
        break;
      case "GM_NOTIFY":
        ui.notifications.warn(payload.data);
        await appendToAuditLog(payload.data);
        break;
    }
  });
});

Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
  console.log("AttackRollComplete fired", workflow);
  if (!workflow) return;
  const fumbleResult = await handleFumble(workflow);
  if (fumbleResult?.cancelProjectile) return;
  await handleProjectile(workflow);
});
