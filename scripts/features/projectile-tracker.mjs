import { getSetting, sendChat, safeRun } from "../utils.mjs";

Hooks.on("midi-qol.RollComplete", async (workflow) => {
  if (!getSetting("projectileEmbed")) return;

  safeRun("Projectile Embed", async () => {
    const weapon = workflow?.item;
    const attacker = workflow?.actor;
    if (!weapon || weapon.type !== "weapon" || !attacker) return;

    const isThrown = (workflow.activity?.name?.toLowerCase()?.includes("throw")||weapon.system.properties.has("thr"));
    let projectile = null;
    let type = null;

    if (isThrown) {
      projectile = weapon; type = "thrown";
    } else if (weapon.system.ammunition?.type && workflow.ammunition) {
      projectile = workflow.ammunition; type = weapon.system.ammunition.type;
    }

    if (!projectile || !workflow.hitTargets?.size) return;
    if (type === "thrown") {
      const activityName = workflow.activity?.name?.toLowerCase() ?? "";
      const isThrowActivity = activityName.includes("throw");
    
      if (isThrowActivity) {
        const qty = weapon.system.quantity ?? 1;
    
        if (qty > 1) {
          await weapon.update({ "system.quantity": qty - 1 });
        } else {
          await weapon.delete();
        }
      }
    }

    for (const t of workflow.hitTargets) {
      const target = t.actor;
      if (!target) continue;

      const embedded = foundry.utils.duplicate(projectile.toObject());
      embedded.system.quantity = 1;
      embedded.system.equipped = false;

      if (type === "ammo" && Math.random() < 0.5) {
        embedded.name += " (Broken)";
        embedded.system.price.value = 0;
      }

      await target.createEmbeddedDocuments("Item", [embedded]);
      sendChat(attacker, `<b>${embedded.name}</b> embedded in <b>${target.name}</b>.`);
    }
  });
});
