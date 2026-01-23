import { getSetting, log, sendChat, safeRun } from "../utils.mjs";

Hooks.on("midi-qol.DamageApplied", async (workflow) => {
  if (!getSetting("adaptive")) return;

  safeRun("Adaptive Evolution", async () => {
    if (!workflow?.damageDetail?.length || !workflow.hitTargets?.size) return;

    const damageType = [...workflow.damageDetail].sort((a, b) => b.damage - a.damage)[0]?.type;
    if (!damageType) return;

    for (const token of workflow.hitTargets) {
      const actor = token.actor;
      if (!actor || !actor.items.some(i => i.name === "Adaptive Combatant")) continue;

      const dr = new Set(actor.system.traits.dr.value);
      const di = new Set(actor.system.traits.di.value);
      let newState = null;

      if (!dr.has(damageType) && !di.has(damageType)) {
        dr.add(damageType); newState = "resistant";
      } else if (dr.has(damageType)) {
        dr.delete(damageType); di.add(damageType); newState = "immune";
      }

      if (!newState) return;

      await actor.update({
        "system.traits.dr.value": [...dr],
        "system.traits.di.value": [...di]
      });

      for (const w of actor.items.filter(i => i.type === "weapon")) {
        if (!w.system?.damage?.parts?.length) continue;
        await w.update({
          "system.damage.parts": w.system.damage.parts.map(p => [p[0], damageType])
        });
      }

      if (game.modules.get("sequencer")?.active) {
        new Sequence()
          .effect()
          .file(`jb2a.elemental.${damageType}.ring.01`)
          .atLocation(token)
          .scale(newState === "immune" ? 1.4 : 1.1)
          .fadeIn(250).fadeOut(400).play();
      }

      sendChat(actor, `<b>${actor.name}</b> adapts to <b>${damageType}</b> → <b>${newState.toUpperCase()}</b>`);
    }
  });
});

Hooks.on("deleteCombat", async (combat) => {
  if (!getSetting("adaptive")) return;
  for (const c of combat.combatants) {
    const actor = c.actor;
    if (actor?.items.some(i => i.name === "Adaptive Combatant")) {
      await actor.update({ "system.traits.dr.value": [], "system.traits.di.value": [] });
      log(`🧬 Reset Adaptive | ${actor.name}`);
    }
  }
});
