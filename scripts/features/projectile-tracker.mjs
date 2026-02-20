import { getSetting, sendChat, safeRun } from "../utils.mjs";

const PROJECTILE_MISS_CONFIG = {
  WALL_EMBED_CHANCE: 0.75,
  WALL_BREAK_CHANCE: 0.4,
  GROUND_BREAK_CHANCE: 0.15,
  DROP_DISTANCE_MULTIPLIER: 1.2
};

function getDirectionVector(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function offsetPosition(pos, dir, dist) {
  return {
    x: pos.x + dir.x * dist,
    y: pos.y + dir.y * dist
  };
}

function hasItemPiles() {
  return game.modules.get("item-piles")?.active && game.itempiles;
}

function findWallCollision(origin, target) {
  if (!canvas?.scene?.walls?.contents?.length) return null;

  const ray = new Ray(origin, target);
  let closest = null;
  let closestT = Infinity;

  for (const wall of canvas.scene.walls.contents) {
    if (!wall.document?.sense) continue;

    const [a, b] = wall.object.segment;
    const hit = ray.intersectSegment(a, b);

    if (!hit) continue;

    if (hit.t < closestT) {
      closestT = hit.t;
      closest = {
        point: hit,
        wall
      };
    }
  }

  return closest;
}

async function dropProjectileLoot({ position, projectile, label }) {
  if (!hasItemPiles()) {
    console.warn("Projectile Embed | Item Piles not active");
    return;
  }

  // GM can execute directly
  if (game.user.isGM) {
    return handleProjectileDropAsGM({ position, projectile, label });
  }

  // Players request GM to execute
  game.socket.emit("module.mezz-comp", {
    type: "DROP_PROJECTILE",
    data: {
      position,
      projectile,
      label
    }
  });
}

async function handleProjectileDropAsGM({ position, projectile, label }) {
  if (!game.itempiles) return;

  await game.itempiles.API.createItemPile({
    position,
    items: [{
      name: projectile.name,
      type: projectile.type,
      img: projectile.img,
      system: projectile.system,
      flags: projectile.flags
    }],
    pileSettings: {
      locked: false,
      mergeItems: true,
      canStackItems: true
    }
  });

  if (label) {
    ChatMessage.create({
      content: `<em>A projectile ${label}.</em>`
    });
  }
}

async function embedProjectileOnTarget({ targetActorId, embedded, attackerId }) {
  // GM can execute directly
  if (game.user.isGM) {
    return embedProjectileOnTargetAsGM({ targetActorId, embedded, attackerId });
  }

  // Players request GM execution
  game.socket.emit("module.mezz-comp", {
    type: "EMBED_PROJECTILE",
    data: {
      targetActorId,
      embedded,
      attackerId
    }
  });
}

async function embedProjectileOnTargetAsGM({ targetActorId, embedded, attackerId }) {
  const target = game.actors.get(targetActorId);
  if (!target) return;

  await target.createEmbeddedDocuments("Item", [embedded]);

  const attacker = game.actors.get(attackerId);
  if (attacker) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<p><strong>${embedded.name}</strong> is embedded in <strong>${target.name}</strong>.</p>`
    });
  }
}

Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
  if (!getSetting("projectileEmbed")) return;

  safeRun("Projectile Embed", async () => {
    const weapon = workflow?.item;
    const attacker = workflow?.actor;
    if (!weapon || weapon.type !== "weapon" || !attacker) return;
    const hitTargets = workflow.hitTargets ?? new Set();

    const isThrown = (workflow.activity?.name?.toLowerCase()?.includes("throw") || weapon.system.properties?.thr);
    let projectile = null;
    let type = null;

    if (isThrown) {
      projectile = weapon;
	  type = "thrown";
    } else if (weapon.system.ammunition?.type && workflow.ammunition) {
      projectile = workflow.ammunition; type = weapon.system.ammunition.type;
    }
	if (!projectile) return;

	if (type === "thrown") {
		const qty = weapon.system.quantity ?? 1;
		if (qty > 1) {
          await weapon.update({ "system.quantity": qty - 1 });
		} else {
    	  await weapon.delete();
	    }
      }
    });
 
    if (hitTargets.size === 0) {
      const attackerToken = workflow.token;
      const targetToken = workflow.targets?.first() ?? attackerToken;
      if (!attackerToken || !targetToken) return;
    
      const from = attackerToken.object?.center ?? attackerToken.center;
      const to = targetToken.object?.center ?? targetToken.center;
    
      const grid = canvas.grid.size;
      const dir = getDirectionVector(from, to);
    
      let behindTarget = offsetPosition(
        to,
        dir,
        grid * PROJECTILE_MISS_CONFIG.DROP_DISTANCE_MULTIPLIER
      );
    
      // small spread
      behindTarget.x += (Math.random() - 0.5) * grid * 0.3;
      behindTarget.y += (Math.random() - 0.5) * grid * 0.3;
    
      const collision = findWallCollision(from, behindTarget);
      const wallPoint = collision?.point;
    
      const dropped = foundry.utils.duplicate(projectile.toObject());
      dropped.system.quantity = 1;
      dropped.system.equipped = false;
    
      // WALL
      if (wallPoint && Math.random() < PROJECTILE_MISS_CONFIG.WALL_EMBED_CHANCE) {
        const broken = Math.random() < PROJECTILE_MISS_CONFIG.WALL_BREAK_CHANCE;
        if (broken) {
          dropped.name += " (Broken)";
          dropped.system.price.value = 0;
        }
    
        await dropProjectileLoot({
          position: wallPoint,
          projectile: dropped,
          label: broken ? "shatters against the wall" : "is embedded in the wall"
        });
        return;
      }
    
      // GROUND
      const broken = Math.random() < PROJECTILE_MISS_CONFIG.GROUND_BREAK_CHANCE;
      if (broken) {
        dropped.name += " (Broken)";
        dropped.system.price.value = 0;
      }
    
      await dropProjectileLoot({
        position: behindTarget,
        projectile: dropped,
        label: broken ? "breaks on impact" : "lands on the ground"
      });
    
      return;
    }

    for (const t of hitTargets) {
      const target = t.actor;
      if (!target) continue;

      const embedded = foundry.utils.duplicate(projectile.toObject());
      embedded.system.quantity = 1;
      embedded.system.equipped = false;

      if (type === "ammo" && Math.random() < 0.5) {
        embedded.name += " (Broken)";
        embedded.system.price.value = 0;
      }

	  await embedProjectileOnTarget({	targetActorId: target.id, embedded,	attackerId: attacker.id	});
      sendChat(attacker, `<b>${embedded.name}</b> embedded in <b>${target.name}</b>.`);
    }
  });
});
