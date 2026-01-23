/******************************************************
 * Settings — Mezz’s Comp
 ******************************************************/
import { MODULE_ID } from "./utils.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, "debug", {
    name: "Enable Debug Logging",
    hint: "Show detailed console output for all Mezz’s Comp features.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  const features = [
    ["adaptive", "Enable Adaptive Evolution feat system"],
    ["projectileEmbed", "Enable Projectile Embed system"],
    ["dsnFix", "Enable Dice So Nice fix"],
    ["inventory", "Enable Container Break system"],
    ["levelUp", "Enable Level Up button"]
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
}
