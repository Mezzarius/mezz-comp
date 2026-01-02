/**
 * Projectile Embed System (Midi-QOL, Foundry v12/v13)
 * Embeds the actual projectile (arrow, javelin, dagger, handaxe, etc.)
 * into the target that was hit.
 */

const PROJECTILE_EMBED_CONFIG = {
  AMMO_BREAK_CHANCE: 0.5,
  NOTIFY_PLAYERS: true,
  ENABLED: true
};

Hooks.on("midi-qol.RollComplete", async (workflow) => {
  if (!PROJECTILE_EMBED_CONFIG.ENABLED) return;

  console.warn("🏹 Projectile Embed | Fired");

  const weapon = workflow?.item;
  const attacker = workflow?.actor;
  if (!weapon || weapon.type !== "weapon" || !attacker) return;

  let projectile = null;
  let projectileType = null;

  /* -------------------------------------------- */
  /*  DETERMINE IF WEAPON IS THROWN                */
  /* -------------------------------------------- */
  const activityName = workflow.activity?.name?.toLowerCase() ?? "";
  const isThrown = activityName.includes("throw");


  /* -------------------------------------------- */
  /*  PROJECTILE RESOLUTION (PRIORITY MATTERS)    */
  /* -------------------------------------------- */

  // 1️⃣ Thrown weapons ALWAYS win
  if (isThrown) {
    projectile = weapon;
    projectileType = "thrown";
  }

  // 2️⃣ Ammo only if the weapon actually consumes ammo
  else if (
    weapon.system.ammunition?.type != null &&
    workflow.ammunition
  ) {
    projectile = workflow.ammunition;
    projectileType = weapon.system.ammunition.type;
  }

  console.log("Projectile resolved:", {
    projectile: projectile?.name,
    type: projectileType,
    weapon: weapon.name,
    isThrown
  });

  if (!projectile) return;
// Subtract thrown weapon ONLY when Throw activity is used
  if (projectileType === "thrown") {
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

  /* -------------------------------------------- */
  /*  TARGET RESOLUTION                           */
  /* -------------------------------------------- */
 // Embed ONLY on a confirmed hit
  if (!workflow.hitTargets || workflow.hitTargets.size === 0) {
    console.log("Projectile Embed | No hit — skipping embed");
    return;
  }
  
  const targets = workflow.hitTargets;

  for (const t of targets) {
    const targetActor = t.actor ?? t.object?.actor;
    if (!targetActor) continue;

    await embedProjectile(
      targetActor,
      projectile,
      projectileType,
      attacker
    );
  }
});

/* -------------------------------------------- */
/*  EMBED PROJECTILE INTO TARGET                */
/* -------------------------------------------- */
async function embedProjectile(targetActor, sourceItem, projectileType, attacker) {
  const embedded = foundry.utils.duplicate(sourceItem.toObject());

  // Force ONE physical object
  embedded.system.quantity = 1;
  embedded.system.equipped = false;

  // Make ammo singular (Arrows → Arrow)
  if (projectileType === "ammo") {
    embedded.name = embedded.name.replace(/s$/, "");
  }

  /* -------------------------------------------- */
  /*  AMMO BREAK CHECK                            */
  /* -------------------------------------------- */
  let broken = false;
  if (projectileType === "ammo") {
    broken = Math.random() < PROJECTILE_EMBED_CONFIG.AMMO_BREAK_CHANCE;
  }

  if (broken) {
    embedded.name += " (Broken)";
    embedded.system.price ??= {};
    embedded.system.price.value = 0;
    embedded.system.description ??= {};
    embedded.system.description.value =
      (embedded.system.description.value ?? "") +
      `<p><em>This ammunition shattered on impact and is unusable.</em></p>`;
  }

  await targetActor.createEmbeddedDocuments("Item", [embedded]);

  if (PROJECTILE_EMBED_CONFIG.NOTIFY_PLAYERS) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<p><strong>${embedded.name}</strong> is embedded in <strong>${targetActor.name}</strong>${broken ? " (shattered)" : ""}.</p>`
    });
  }
}

console.log("🏹 Projectile Embed System loaded.");
