/******************************************************
 * Settings — Mezz's Comp
 ******************************************************/
import { MODULE_ID } from "./utils.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, "debug", {
    name: "Enable Debug Logging",
    hint: "Show detailed console output for all Mezz's Comp features.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  const features = [
    ["adaptive",        "Enable Adaptive Evolution feat system"],
    ["projectileEmbed", "Enable Projectile Embed system"],
    ["dsnFix",          "Enable Dice So Nice fix"],
    ["inventory",       "Enable Container Break system"],
    ["levelUp",         "Enable Level Up button"],
    ["lockpick",        "Enable Lockpick Mini-game"],
  ];

  for (const [key, label] of features) {
    game.settings.register(MODULE_ID, key, {
      name: label,
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
  }

  // ── Lockpick mini-game options ───────────────────────────
  // Only shown when the lockpick feature is enabled.

  game.settings.register(MODULE_ID, "lockpickAlwaysUse", {
    name: "Lockpick: Always Trigger Mini-game",
    hint: "If disabled, the mini-game only fires when the targeted token has the mezz-comp.isLock flag set.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "lockpickDefaultDC", {
    name: "Lockpick: Default Lock DC",
    hint: "DC used when no mezz-comp.lockDC flag is set on the targeted token. Maps to difficulty: <10 easy, 10-14 normal, 15-19 hard, 20+ deadly.",
    scope: "world",
    config: true,
    type: Number,
    default: 15,
    range: { min: 5, max: 30, step: 1 }
  });

  game.settings.register(MODULE_ID, "lockpickConsumeOnFail", {
    name: "Lockpick: Consume Tools on Failure",
    hint: "Deducts one use from the actor's Thieves' Tools when the lock-pick attempt fails.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}
