// =====================================================
// MEZZ-COMP UNIFIED FUMBLE ENGINE
// dnd5e 5.2.4 / Foundry v13
// =====================================================

const DEBUG = false;
function debugLog(...args) {
  if (DEBUG) console.log("[mezz-comp|fumble]", ...args);
}

export async function handleFumble(workflow) {
  debugLog("HandleFumble called", workflow);

  if (!workflow?.actor || !workflow?.item || !workflow?.token) return;
  if (!workflow.isFumble) return;
  if (!workflow.attackRoll) return;

  const actor = workflow.actor;
  const item  = workflow.item;
  const token = workflow.token;

  const isSpell   = workflow.activity?.attack?.type?.classification === "spell";
  const rangeType = workflow.activity?.attack?.type?.value;

  let type;
  if      (isSpell  && rangeType === "melee")  type = "msak";
  else if (isSpell  && rangeType === "ranged") type = "rsak";
  else if (!isSpell && rangeType === "melee")  type = "mwak";
  else if (!isSpell && rangeType === "ranged") type = "rwak";

  debugLog("Resolved attack type:", type);

  if (!type) {
    console.warn("[mezz-comp|fumble] Could not resolve attack type — skipping fumble handling.");
    return;
  }

  if      (type === "mwak")                  await handleMeleeFumble(actor, item, token, workflow);
  else if (type === "rwak")                  await handleRangedFumble(actor, item, token, workflow);
  else if (["msak","rsak"].includes(type))   await handleSpellFumble(actor, item, token, workflow);
}

// ─────────────────────────────────────────────────────────
//  Shared helper
// ─────────────────────────────────────────────────────────

async function rollFumbleTable() {
  return new Roll("1d10").roll({ async: true });
}

// ─────────────────────────────────────────────────────────
//  Attack-type handlers
// ─────────────────────────────────────────────────────────

async function handleMeleeFumble(actor, item, token, workflow) {
  const roll = await rollFumbleTable();
  await roll.toMessage({ flavor: meleeFlavor(roll.total) });

  try {
    switch (roll.total) {
      case 1:  await dropWeaponScatter(actor, item, token); break;
      case 2:  await actor.toggleStatusEffect("prone", { active: true }); break;  // FIX: v13 needs { active: true }
      case 3:  await accidentalAdjacentAttack(actor, item, token, workflow); break;
      case 4:  await selfDamageBaseDie(actor, item); break;
      case 5:  await applyDisarm(actor, item); break;
      case 6:  await applyTurnSlow(actor); break;
      case 7:  await damageWeapon(item); break;
      case 8:  await shoveSelfBack(token); break;
      case 9:  await applyDistracted(actor); break;
      case 10: break;
    }
  } catch (err) {
    console.error("[mezz-comp|fumble] Melee fumble effect error:", err);
  }

  await applyTurnLock(actor);
}

function meleeFlavor(n) {
  return ["",
    "<strong>You lose your grip!</strong>",
    "<strong>You slip and fall prone!</strong>",
    "<strong>You strike the wrong target!</strong>",
    "<strong>You cut yourself!</strong>",
    "<strong>Your footing falters!</strong>",
    "<strong>You overextend your swing!</strong>",
    "<strong>Your weapon is damaged!</strong>",
    "<strong>The recoil pushes you backward!</strong>",
    "<strong>You are left off balance!</strong>",
    "<strong>Your turn ends abruptly!</strong>",
  ][n] ?? "";
}

async function handleRangedFumble(actor, item, token, workflow) {
  const roll = await rollFumbleTable();
  await roll.toMessage({ flavor: rangedFlavor(roll.total) });

  try {
    switch (roll.total) {
      case 1:  await dropWeaponScatter(actor, item, token); break;
      case 2:  await actor.toggleStatusEffect("prone", { active: true }); break;  // FIX: v13 needs { active: true }
      case 3:  await accidentalRandomAttack(actor, item, workflow); break;
      case 4:  await selfDamageBaseDie(actor, item); break;
      case 5:  await breakAmmo(workflow); break;
      case 6:  await applyDistracted(actor); break;
      case 7:  await damageWeapon(item); break;
      case 8:  await applyTurnSlow(actor); break;
      case 9:  await dropProjectileScatter(token, workflow); break;
      case 10: break;
    }
  } catch (err) {
    console.error("[mezz-comp|fumble] Ranged fumble effect error:", err);
  }

  await applyTurnLock(actor);
}

function rangedFlavor(n) {
  return ["",
    "<strong>You fumble your weapon!</strong>",
    "<strong>You trip while firing!</strong>",
    "<strong>Your shot goes wildly astray!</strong>",
    "<strong>The weapon misfires painfully!</strong>",
    "<strong>Your ammunition is ruined!</strong>",
    "<strong>You lose focus!</strong>",
    "<strong>Your weapon mechanism jams!</strong>",
    "<strong>You must recover your stance!</strong>",
    "<strong>Your projectile lands far off target!</strong>",
    "<strong>Your turn ends in embarrassment!</strong>",
  ][n] ?? "";
}

async function handleSpellFumble(actor, item, token, workflow) {
  const roll = await rollFumbleTable();
  await roll.toMessage({ flavor: spellFlavor(roll.total) });

  try {
    switch (roll.total) {
      case 1:  await selfDamageBaseDie(actor, item); break;
      case 2:  await accidentalRandomAttack(actor, item, workflow); break;
      case 3:  await removeConcentration(actor); break;
      case 4:  await applyTurnSlow(actor); break;
      case 5:  await expendSpellSlot(item); break;
      case 6:  await applyDistracted(actor); break;
      case 7:  await randomSpellEffect(actor); break;
      case 8:  await actor.toggleStatusEffect("prone", { active: true }); break;  // FIX: v13 needs { active: true }
      case 9:  break;
      case 10: await silenceCaster(actor); break;
    }
  } catch (err) {
    console.error("[mezz-comp|fumble] Spell fumble effect error:", err);
  }

  await applyTurnLock(actor);
}

function spellFlavor(n) {
  return ["",
    "<strong>Arcane backlash!</strong>",
    "<strong>The spell lashes out unpredictably!</strong>",
    "<strong>You lose concentration!</strong>",
    "<strong>You struggle to regain control!</strong>",
    "<strong>The spell slot is wasted!</strong>",
    "<strong>Your mind reels!</strong>",
    "<strong>Wild magical surge!</strong>",
    "<strong>The spell explodes beneath you!</strong>",
    "<strong>Your turn collapses into chaos!</strong>",
    "<strong>Your voice fails you!</strong>",
  ][n] ?? "";
}

// ─────────────────────────────────────────────────────────
//  Effect helpers
// ─────────────────────────────────────────────────────────

async function dropWeaponScatter(actor, item, token) {
  if (!game.itempiles) return;

  const weaponData = item.toObject();
  await actor.deleteEmbeddedDocuments("Item", [item.id]);

  const angle    = Math.random() * 2 * Math.PI;
  const distance = (1 + Math.random()) * canvas.grid.size;

  await game.itempiles.API.createItemPile({
    position: {
      x: token.center.x + Math.cos(angle) * distance,
      y: token.center.y + Math.sin(angle) * distance,
    },
    items: [weaponData],
  });
}

async function selfDamageBaseDie(actor, item) {
  // FIX: dnd5e v5.x moved damage parts into activities; fall back gracefully
  const die =
    item.system.damage?.base?.formula
    ?? item.system.activities?.contents?.[0]?.damage?.parts?.[0]?.formula
    ?? item.system.damage?.parts?.[0]?.[0]
    ?? "1d4";

  const roll = await new Roll(die).roll({ async: true });
  await roll.toMessage({ flavor: "Self-inflicted damage!" });

  // FIX: dnd5e v5.x applyDamage now takes an array of damage objects
  await actor.applyDamage([{ value: roll.total, type: "piercing" }]);
}

async function damageWeapon(item) {
  if (item.system.properties?.mgc) return;

  const current  = item.getFlag("mezz-comp", "damageLevel") ?? 0;
  const newLevel = Math.min(current + 1, 2);

  await item.setFlag("mezz-comp", "damageLevel", newLevel);

  const label = newLevel === 1 ? `${item.name} is damaged.` : `${item.name} is broken!`;
  ChatMessage.create({ content: label });
}

async function accidentalAdjacentAttack(actor, item, token, workflow) {
  const adjacent = canvas.tokens.placeables.filter(t => {
    if (t.id === token.id) return false;
    const dist = canvas.grid.measureDistance(token.center, t.center, { gridSpaces: true });
    return dist <= 1;
  });

  if (!adjacent.length) return;

  const target      = adjacent[Math.floor(Math.random() * adjacent.length)];
  const attackBonus = (workflow.attackRoll?.total ?? 0) - (workflow.d20AttackRoll?.total ?? 0);
  const roll        = await new Roll(`1d20 + ${attackBonus}`).roll({ async: true });
  await roll.toMessage({ flavor: `Accidental attack vs ${target.name}` });

  if (roll.total >= (target.actor?.system?.attributes?.ac?.value ?? Infinity)) {
    // FIX: item.rollDamage() removed in dnd5e v5.x — use activity instead
    const activity = item.system.activities?.contents?.[0];
    if (activity) {
      await activity.rollDamage({}, { event: new Event("click") });
    }
  }
}

async function accidentalRandomAttack(actor, item, workflow) {
  const attackerToken = workflow.token;
  if (!attackerToken) return;

  const possibleTargets = canvas.tokens.placeables.filter(t => {
    if (!t.actor) return false;
    if (t.id === attackerToken.id) return false;
    if (!t.actor.system?.attributes?.ac?.value) return false;
    return true;
  });

  if (!possibleTargets.length) return;

  const target      = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
  const attackBonus = (workflow.attackRoll?.total ?? 0) - (workflow.d20AttackRoll?.total ?? 0);
  const roll        = await new Roll(`1d20 + ${attackBonus}`).roll({ async: true });
  await roll.toMessage({ flavor: `Accidental attack vs ${target.name}` });

  if (roll.total >= (target.actor?.system?.attributes?.ac?.value ?? Infinity)) {
    // FIX: item.rollDamage() removed in dnd5e v5.x — use activity instead
    const activity = item.system.activities?.contents?.[0];
    if (activity) {
      await activity.rollDamage({}, { event: new Event("click") });
    }
  }
}

async function applyTurnLock(actor) {
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name:   "Fumbled Turn",
    icon:   "icons/svg/stoned.svg",
    origin: actor.uuid,
    duration: { rounds: 0, turns: 1 },
    changes: [
      { key: "flags.midi-qol.disadvantage.attack.all", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: 1 },
      { key: "flags.midi-qol.noReaction",              mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: 1 },
    ],
  }]);
}

async function applyTurnSlow(actor) {
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name:   "Off Balance",
    icon:   "icons/svg/falling.svg",
    origin: actor.uuid,
    duration: { rounds: 0, turns: 1 },
    changes: [{
      key:   "system.attributes.movement.all",
      mode:  CONST.ACTIVE_EFFECT_MODES.ADD,
      value: -10,
    }],
  }]);
}

async function applyDistracted(actor) {
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name:   "Distracted",
    icon:   "icons/svg/eye.svg",
    origin: actor.uuid,
    duration: { rounds: 0, turns: 1 },
    changes: [{
      key:   "flags.midi-qol.disadvantage.attack.all",
      mode:  CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
      value: 1,
    }],
  }]);
}

async function removeConcentration(actor) {
  // FIX: dnd5e v5.x has a dedicated endConcentration() method — use it first,
  // fall back to effect search for edge cases.
  if (typeof actor.endConcentration === "function") {
    await actor.endConcentration();
    return;
  }
  // Fallback: search by status ID (v5 uses "concentration", older used "concentrating")
  const conc = actor.effects.find(e =>
    e.statuses?.has("concentration") ||
    e.statuses?.has("concentrating") ||
    e.name?.toLowerCase().includes("concentrat")
  );
  if (conc) await conc.delete();
}

async function breakAmmo(workflow) {
  const ammo = workflow.ammunition;
  if (!ammo) return;
  const qty = ammo.system.quantity ?? 1;
  if (qty > 0) await ammo.update({ "system.quantity": qty - 1 });
}

async function shoveSelfBack(token) {
  const angle    = Math.random() * 2 * Math.PI;
  const distance = canvas.grid.size;

  const newX = Math.clamped(token.x + Math.cos(angle) * distance, 0, canvas.dimensions.width  - token.w);
  const newY = Math.clamped(token.y + Math.sin(angle) * distance, 0, canvas.dimensions.height - token.h);

  await token.document.update({ x: newX, y: newY });
}

async function applyDisarm(actor, item) {
  if (!item) return;
  await item.update({ "system.equipped": false });
  ChatMessage.create({ content: `<strong>${actor.name} is disarmed of ${item.name}!</strong>` });
}

async function dropProjectileScatter(token, workflow) {
  if (!game.itempiles) return;

  const ammo  = workflow?.ammunition;
  const items = ammo ? [ammo.toObject()] : [];

  const angle    = Math.random() * 2 * Math.PI;
  const distance = canvas.grid.size * 2;

  await game.itempiles.API.createItemPile({
    position: {
      x: token.center.x + Math.cos(angle) * distance,
      y: token.center.y + Math.sin(angle) * distance,
    },
    items,
  });
}

async function silenceCaster(actor) {
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name:   "Spell Disrupted",
    icon:   "icons/svg/silenced.svg",
    origin: actor.uuid,
    duration: { rounds: 0, turns: 1 },
    changes: [{
      key:   "flags.midi-qol.noSpell",
      mode:  CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
      value: 1,
    }],
  }]);
}

async function expendSpellSlot(item) {
  if (item.type !== "spell") return;

  const level = item.system.level;
  const actor = item.actor;
  if (!actor) return;

  const slotPath = `system.spells.spell${level}.value`;
  const current  = foundry.utils.getProperty(actor, slotPath);
  if (current > 0) await actor.update({ [slotPath]: current - 1 });
}

async function randomSpellEffect(actor) {
  ChatMessage.create({ content: `<strong>${actor.name} triggers a wild magic surge!</strong>` });
}
