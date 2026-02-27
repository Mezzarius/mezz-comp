// =====================================================
// MEZZ-COMP UNIFIED FUMBLE ENGINE
// dnd5e 5.2.4
// =====================================================

export async function handleFumble(workflow) {
	console.log("HandleFumble called", workflow);

  if (!workflow?.actor || !workflow?.item || !workflow?.token) return;
  if (!workflow.isFumble) return;
  const actor = workflow.actor;
  const item = workflow.item;
  const token = workflow.token;
  
  const isSpell = workflow.activity?.attack.type.classification === "spell";
  const rangeType = workflow.activity?.attack.type.value;
  console.log(workflow.isFumble);
  // Only once per turn (all attack types share same lock)

  let type;

  if (isSpell && rangeType === "melee") type = "msak";
  else if (isSpell && rangeType === "ranged") type = "rsak";
  else if (!isSpell && rangeType === "melee") type = "mwak";
  else if (!isSpell && rangeType === "ranged") type = "rwak";

  console.log("Resolved attack type:", type);console.log(type);
  if (type === "mwak") {
    await handleMeleeFumble(actor, item, token, workflow);
  }

  else if (type === "rwak") {
    await handleRangedFumble(actor, item, token, workflow);
  }

  else if (["msak", "rsak"].includes(type)) {
    await handleSpellFumble(actor, item, token, workflow);
  }

};

async function handleMeleeFumble(actor, item, token, workflow) {

  const roll = await new Roll("1d10").roll({async:true});

  switch (roll.total) {

  case 1:
    await dropWeaponScatter(actor, item, token);
    await roll.toMessage({ flavor: "<strong>You lose your grip!</strong>" });
    break;

  case 2:
    await actor.toggleStatusEffect("prone");
    await roll.toMessage({ flavor: "<strong>You slip and fall prone!</strong>" });
    break;

  case 3:
    await accidentalAdjacentAttack(actor, item, token, workflow);
    await roll.toMessage({ flavor: "<strong>You strike the wrong target!</strong>" });
    break;

  case 4:
    await selfDamageBaseDie(actor, item);
    await roll.toMessage({ flavor: "<strong>You cut yourself!</strong>" });
    break;

  case 5:
    await applyDisarm(actor);
    await roll.toMessage({ flavor: "<strong>Your footing falters!</strong>" });
    break;

  case 6:
    await applyTurnSlow(actor);
    await roll.toMessage({ flavor: "<strong>You overextend your swing!</strong>" });
    break;

  case 7:
    await damageWeapon(item);
    await roll.toMessage({ flavor: "<strong>Your weapon is damaged!</strong>" });
    break;

  case 8:
    await shoveSelfBack(token);
    await roll.toMessage({ flavor: "<strong>The recoil pushes you backward!</strong>" });
    break;

  case 9:
    await applyDistracted(actor);
    await roll.toMessage({ flavor: "<strong>You are left off balance!</strong>" });
    break;

  case 10:
    await applyTurnLock(actor);
    await roll.toMessage({ flavor: "<strong>Your turn ends abruptly!</strong>" });
    break;
}

  await applyTurnLock(actor);
}

async function handleRangedFumble(actor, item, token, workflow) {

  const roll = await new Roll("1d10").roll({async:true});

  switch (roll.total) {

  case 1:
    await dropWeaponScatter(actor, item, token);
    await roll.toMessage({ flavor: "<strong>You fumble your weapon!</strong>" });
    break;

  case 2:
    await actor.toggleStatusEffect("prone");
    await roll.toMessage({ flavor: "<strong>You trip while firing!</strong>" });
    break;

  case 3:
    await accidentalRandomAttack(actor, item, workflow);
    await roll.toMessage({ flavor: "<strong>Your shot goes wildly astray!</strong>" });
    break;

  case 4:
    await selfDamageBaseDie(actor, item);
    await roll.toMessage({ flavor: "<strong>The weapon misfires painfully!</strong>" });
    break;

  case 5:
    await breakAmmo(workflow);
    await roll.toMessage({ flavor: "<strong>Your ammunition is ruined!</strong>" });
    break;

  case 6:
    await applyDistracted(actor);
    await roll.toMessage({ flavor: "<strong>You lose focus!</strong>" });
    break;

  case 7:
    await damageWeapon(item);
    await roll.toMessage({ flavor: "<strong>Your weapon mechanism jams!</strong>" });
    break;

  case 8:
    await applyTurnSlow(actor);
    await roll.toMessage({ flavor: "<strong>You must recover your stance!</strong>" });
    break;

  case 9:
    await dropProjectileScatter(token);
    await roll.toMessage({ flavor: "<strong>Your projectile lands far off target!</strong>" });
    break;

  case 10:
    await applyTurnLock(actor);
    await roll.toMessage({ flavor: "<strong>Your turn ends in embarrassment!</strong>" });
    break;
}

  await applyTurnLock(actor);
}

async function handleSpellFumble(actor, item, token, workflow) {

  const roll = await new Roll("1d10").roll({async:true});

switch (roll.total) {

  case 1:
    await selfDamageBaseDie(actor, item);
    await roll.toMessage({ flavor: "<strong>Arcane backlash!</strong>" });
    break;

  case 2:
    await accidentalRandomAttack(actor, item, workflow);
    await roll.toMessage({ flavor: "<strong>The spell lashes out unpredictably!</strong>" });
    break;

  case 3:
    await removeConcentration(actor);
    await roll.toMessage({ flavor: "<strong>You lose concentration!</strong>" });
    break;

  case 4:
    await applyTurnSlow(actor);
    await roll.toMessage({ flavor: "<strong>You struggle to regain control!</strong>" });
    break;

  case 5:
    await expendSpellSlot(item);
    await roll.toMessage({ flavor: "<strong>The spell slot is wasted!</strong>" });
    break;

  case 6:
    await applyDistracted(actor);
    await roll.toMessage({ flavor: "<strong>Your mind reels!</strong>" });
    break;

  case 7:
    await randomSpellEffect(actor);
    await roll.toMessage({ flavor: "<strong>Wild magical surge!</strong>" });
    break;

  case 8:
    await actor.toggleStatusEffect("prone");
    await roll.toMessage({ flavor: "<strong>The spell explodes beneath you!</strong>" });
    break;

  case 9:
    await applyTurnLock(actor);
    await roll.toMessage({ flavor: "<strong>Your turn collapses into chaos!</strong>" });
    break;

  case 10:
    await silenceCaster(actor);
    await roll.toMessage({ flavor: "<strong>Your voice fails you!</strong>" });
    break;
}
  await applyTurnLock(actor);
}

async function dropWeaponScatter(actor, item, token) {

  if (!game.itempiles) return;

  const weapon = item;
  await actor.deleteEmbeddedDocuments("Item", [item.id]);

  const angle = Math.random() * 360;
  const distance = 5 + Math.random() * 5;
  const radians = angle * (Math.PI / 180);

  const dropX = token.center.x + Math.cos(radians) * canvas.grid.size * (distance / 5);
  const dropY = token.center.y + Math.sin(radians) * canvas.grid.size * (distance / 5);

  await game.itempiles.API.createItemPile({
    position: { x: dropX, y: dropY },
    items: [weapon]
  });
}

async function selfDamageBaseDie(actor, item) {
  const die = item.system.damage.parts?.[0]?.[0] || "1d4";
  const roll = await new Roll(die).roll({async:true});
  await roll.toMessage({flavor:`Self-inflicted damage!`});
  await actor.applyDamage(roll.total);
}

async function damageWeapon(item) {

  if (item.system.properties?.mgc) return;

  const current = item.getFlag("mezz-comp", "damageLevel") || 0;
  const newLevel = current + 1;

  await item.setFlag("mezz-comp", "damageLevel", newLevel);

  if (newLevel === 1)
    ChatMessage.create({content:`${item.name} is damaged.`});

  if (newLevel >= 2)
    ChatMessage.create({content:`${item.name} is broken.`});
}

async function accidentalAdjacentAttack(actor, item, token, workflow) {

  const adjacent = canvas.tokens.placeables.filter(t => {
    if (t.id === token.id) return false;
    return canvas.grid.measureDistance(token.center, t.center) <= 5;
  });

  if (!adjacent.length) return;

  const target = adjacent[Math.floor(Math.random() * adjacent.length)];

  const attackBonus = workflow.attackRoll.total - 1;
  const roll = await new Roll(`1d20 + ${attackBonus}`).roll({async:true});
  await roll.toMessage({flavor:`Accidental attack vs ${target.name}`});

  if (roll.total >= target.actor.system.attributes.ac.value)
    await item.rollDamage();
}

async function accidentalRandomAttack(actor, item, workflow) {

  const attackerToken = workflow.token;
  if (!attackerToken) return;

  // Find valid nearby targets (excluding self)
  const possibleTargets = canvas.tokens.placeables.filter(t => {
    if (!t.actor) return false;
    if (t.id === attackerToken.id) return false;
    if (!t.actor.system?.attributes?.ac?.value) return false;
    return true;
  });

  if (!possibleTargets.length) return;

  const target = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

  // Re-roll attack using original attack bonus
  const attackBonus = workflow.attackRoll?.total - workflow.d20AttackRoll;

  const roll = await new Roll(`1d20 + ${attackBonus}`).roll({ async: true });

  await roll.toMessage({
    flavor: `Accidental attack vs ${target.name}`
  });

  if (roll.total >= target.actor.system.attributes.ac.value) {
    await item.rollDamage({ workflowOptions: { targetUuids: [target.document.uuid] } });
  }
}

async function applyTurnLock(actor) {

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Fumbled Turn",
    icon: "icons/svg/daze.svg",
    origin: actor.uuid,
    duration: { rounds: 0, turns: 1 },
    changes: [
      {
        key: "flags.midi-qol.disadvantage.attack.all",
        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
        value: 1
      },
      {
        key: "flags.midi-qol.noReaction",
        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
        value: 1
      }
    ]
  }]);
}

async function applyTurnSlow(actor) {
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Off Balance",
    icon: "icons/svg/daze.svg",
    duration: { rounds: 0, turns: 1 },
    changes: [{
      key: "system.attributes.movement.all",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: -10
    }]
  }]);
}

async function applyDistracted(actor) {
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Distracted",
    icon: "icons/svg/daze.svg",
    duration: { rounds: 0, turns: 1 },
    changes: [{
      key: "flags.midi-qol.disadvantage.attack.all",
      mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
      value: 1
    }]
  }]);
}

async function removeConcentration(actor) {
  const conc = actor.effects.find(e => e.name === "Concentrating");
  if (conc) await conc.delete();
}

async function breakAmmo(workflow) {
  const ammo = workflow.ammunition;
  if (!ammo) return;
  const qty = ammo.system.quantity ?? 1;
  if (qty > 0) await ammo.update({ "system.quantity": qty - 1 });
}

async function shoveSelfBack(token) {
  const angle = Math.random() * 2 * Math.PI;
  const distance = canvas.grid.size;
  await token.document.update({
    x: token.x + Math.cos(angle) * distance,
    y: token.y + Math.sin(angle) * distance
  });
}

async function applyDisarm(actor, item) {
  if (!item) return;

  await item.update({ "system.equipped": false });

  ChatMessage.create({
    content: `<strong>${actor.name} is disarmed!</strong>`
  });
}

async function dropProjectileScatter(token) {
  if (!game.itempiles) return;

  const angle = Math.random() * 2 * Math.PI;
  const distance = canvas.grid.size * 2;

  const dropX = token.center.x + Math.cos(angle) * distance;
  const dropY = token.center.y + Math.sin(angle) * distance;

  await game.itempiles.API.createItemPile({
    position: { x: dropX, y: dropY },
    items: []
  });
}

async function silenceCaster(actor) {
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Spell Disrupted",
    icon: "icons/svg/silenced.svg",
    duration: { rounds: 0, turns: 1 },
    changes: [{
      key: "flags.midi-qol.noSpell",
      mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
      value: 1
    }]
  }]);
}

async function expendSpellSlot(item) {
  if (item.type !== "spell") return;

  const level = item.system.level;
  const actor = item.actor;
  if (!actor) return;

  const slotPath = `system.spells.spell${level}.value`;
  const maxPath  = `system.spells.spell${level}.max`;

  const current = foundry.utils.getProperty(actor, slotPath);
  if (current > 0) {
    await actor.update({ [slotPath]: current - 1 });
  }
}