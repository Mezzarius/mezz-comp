/******************************************************
 * Mezz’s Comp (v13) — Main Entry
 ******************************************************/
import { registerSettings } from "./settings.mjs";
import { log, safeRun } from "./utils.mjs";

// Submodules
import "./features/adaptive.mjs";
import "./features/dsn-fix.mjs";
import "./features/inventory-logic.mjs";
import "./features/level-up.mjs";
import "./features/projectile-tracker.mjs";
import "./features/fumbles.mjs";

Hooks.once("init", () => {
  console.log("🧩 Mezz’s Comp | Initializing...");
  registerSettings();
});

Hooks.once("ready", async () => {
  log("🧩 Mezz’s Comp | Module Ready.");
  const version = game.modules.get("mezz-comp")?.version ?? "unknown";
  ui.notifications.info(`Mezz’s Comp v${version} loaded.`);
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
    }
  });
});


