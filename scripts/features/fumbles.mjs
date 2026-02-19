// =====================================================
// MEZZ-COMP UNIFIED FUMBLE ENGINE
// dnd5e 5.2.4
// =====================================================

Hooks.on("dnd5e.rollAttack", async (workflow) => {

  if (!workflow?.actor || !workflow?.item || !workflow?.token) return;

  const actor = workflow.actor;
  const item = workflow.item;
  const token = workflow.token;

  const d20 = workflow.attackRoll?.dice?.[0]?.results?.[0]?.result;
  if (d20 !== 1) return;

  // Only once per turn (all attack types share same lock)
  const combat = game.combat;
  if (combat) {
    const turnKey = `${combat.id}-${combat.round}-${combat.turn}`;
    const flag = actor.getFlag("mezz-comp", "fumbleTurn");
    if (flag === turnKey) return;
    await actor.setFlag("mezz-comp", "fumbleTurn", turnKey);
  }

  const type = item.system.actionType;

  if (type === "mwak") {
    await handleMeleeFumble(actor, item, token, workflow);
  }

  else if (type === "rwak") {
    await handleRangedFumble(actor, item, token, workflow);
  }

  else if (["msak", "rsak"].includes(type)) {
    await handleSpellFumble(actor, item, token, workflow);
  }

});

async function handleMeleeFumble(actor, item, token, workflow) {

  const roll = await new Roll("1d10").roll({async:true});
  await roll.toMessage({flavor:`<strong>MELEE FUMBLE!</strong>`});

  switch (roll.total) {

    case 1:
      await dropWeaponScatter(actor, item, token);
      break;

    case 2:
      await actor.toggleStatusEffect("prone");
      break;

    case 3:
      await accidentalAdjacentAttack(actor, item, token, workflow);
      break;

    case 4:
      await selfDamageBaseDie(actor, item);
      break;

    case 7:
      await damageWeapon(item);
      break;
  }

  await applyTurnLock(actor);
}

async function handleRangedFumble(actor, item, token, workflow) {

  const roll = await new Roll("1d10").roll({async:true});
  await roll.toMessage({flavor:`<strong>RANGED FUMBLE!</strong>`});

  switch (roll.total) {

    case 1:
      await dropWeaponScatter(actor, item, token);
      break;

    case 3:
      await accidentalRandomAttack(actor, item, workflow);
      break;

    case 4:
      await selfDamageBaseDie(actor, item);
      break;

    case 7:
      await damageWeapon(item);
      break;

    case 8:
      await actor.toggleStatusEffect("prone");
      break;
  }

  await applyTurnLock(actor);
}

async function handleSpellFumble(actor, item, token, workflow) {

  const roll = await new Roll("1d10").roll({async:true});
  await roll.toMessage({flavor:`<strong>SPELL FUMBLE!</strong>`});

  switch (roll.total) {

    case 2:
      const level = item.system.level || 1;
      const dmg = await new Roll(`${level}d6`).roll({async:true});
      await dmg.toMessage({flavor:`Arcane Backlash!`});
      await actor.applyDamage(dmg.total);
      break;

    case 3:
      await accidentalRandomAttack(actor, item, workflow);
      break;

    case 4:
      await selfDamageBaseDie(actor, item);
      break;

    case 5:
      const conc = actor.effects.find(e => e.label === "Concentrating");
      if (conc) await conc.delete();
      break;
  }

  await applyTurnLock(actor);
}

async function dropWeaponScatter(actor, item, token) {

  if (!game.itempiles) return;

  const weaponData = item.toObject();
  await actor.deleteEmbeddedDocuments("Item", [item.id]);

  const angle = Math.random() * 360;
  const distance = 5 + Math.random() * 5;
  const radians = angle * (Math.PI / 180);

  const dropX = token.center.x + Math.cos(radians) * canvas.grid.size * (distance / 5);
  const dropY = token.center.y + Math.sin(radians) * canvas.grid.size * (distance / 5);

  await game.itempiles.API.createItemPile({
    position: { x: dropX, y: dropY },
    items: [weaponData]
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

async function applyTurnLock(actor) {

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    label: "Fumbled Turn",
    duration: { turns: 1 },
    changes: [
      { key: "flags.midi-qol.disadvantage.attack.all", mode: 0, value: "1" },
      { key: "flags.midi-qol.noReaction", mode: 0, value: "1" }
    ]
  }]);
}