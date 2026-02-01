/******************************************************
 * Adaptive Evolution – FINAL FIXED FILE
 * Foundry VTT v12.331+
 * Requires: Midi-QOL, socketlib
 * Optional: Sequencer + JB2A
 ******************************************************/

Hooks.once("ready", () => {

  // --------------------------------------------------
  // DEPENDENCY CHECKS
  // --------------------------------------------------
  if (!game.modules?.get("socketlib")?.active) {
    ui.notifications.error("Adaptive Evolution requires socketlib");
    return;
  }
  if (!game.modules?.get("midi-qol")?.active) {
    ui.notifications.error("Adaptive Evolution requires Midi-QOL");
    return;
  }

  // --------------------------------------------------
  // CONFIG
  // --------------------------------------------------
  const EXCLUDED_DAMAGE_TYPES = ["necrotic", "lightning"];

  const DAMAGE_COLOR_MAP = {
    cold: "blue",
    bludgeoning: "blue",

    acid: "green",
    poison: "green",

    fire: "red",
    slashing: "red",

    radiant: "yellow",
    piercing: "yellow",

    psychic: "purple",

    force: "white",
    thunder: "white"
  };

  const ALL_ADAPTIVE_TYPES = [
    "acid","bludgeoning","cold","fire","force",
    "piercing","poison","psychic","radiant",
    "slashing","thunder"
  ];

  // --------------------------------------------------
  // SOCKETLIB (GM AUTHORITY)
  // --------------------------------------------------
  const AdaptiveSocket = socketlib.registerModule("mezz-comp");

  AdaptiveSocket.register("applyAdaptation", async ({
    sceneId,
    tokenId,
    damageType,
    newState
  }) => {

    const scene = game.scenes.get(sceneId);
    if (!scene) return;

    const tokenDoc = scene.tokens.get(tokenId);
    if (!tokenDoc) return;

    const actor = tokenDoc.actor;
    if (!actor) return;

    // ---- REMOVE PREVIOUS ADAPTATION ----
    const dr = new Set(actor.system.traits.dr.value);
    const di = new Set(actor.system.traits.di.value);

    for (const t of ALL_ADAPTIVE_TYPES) {
      dr.delete(t);
      di.delete(t);
    }

    // ---- APPLY NEW STATE ----
    if (newState === "resistant") dr.add(damageType);
    if (newState === "immune") di.add(damageType);

    await actor.update({
      "system.traits.dr.value": [...dr],
      "system.traits.di.value": [...di]
    });

    // ---- ADAPT ARCANITE SWORD (TOKEN ACTOR) ----
    const sword = actor.items.find(i =>
      i.type === "weapon" && i.name === "Arcanite Sword"
    );

    if (sword?.system?.damage?.parts?.length) {
      await sword.update({
        "system.damage.parts": sword.system.damage.parts.map(p => [p[0], damageType])
      });
    }

    return true;
  });

  // --------------------------------------------------
  // MIDI-QOL DAMAGE HOOK
  // --------------------------------------------------
  Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
    console.log(workflow.damageDetail);
    if (!workflow?.damageDetail?.length) return;
    if (!workflow.hitTargets?.size) return;

    // Pick dominant damage type
    const damageType = [...workflow.damageDetail]
      .sort((a, b) => b.damage - a.damage)[0]?.type;
    console.log(damageType);
    if (!damageType) return;
    if (EXCLUDED_DAMAGE_TYPES.includes(damageType)) return;

    for (const token of workflow.hitTargets) {
      const actor = token.actor;
      if (!actor) continue;

      // Require feat
      if (!actor.items.some(i => i.name === "Adaptive Combatant")) continue;

      const dr = new Set(actor.system.traits.dr?.value);
      const di = new Set(actor.system.traits.di?.value);

      let newState = null;

      if (!dr.has(damageType) && !di.has(damageType)) {
        newState = "resistant";
      }
      else if (dr.has(damageType)) {
        newState = "immune";
      }

      if (!newState) continue;

      // ---- GM SOCKET APPLY ----
      await AdaptiveSocket.executeAsGM("applyAdaptation", {
        sceneId: token.scene.id,
        tokenId: token.id,
        damageType,
        newState
      });

      // --------------------------------------------------
      // VISUALS (LOCAL ONLY)
      // --------------------------------------------------
      if (game.modules.get("sequencer")?.active) {

        // Remove previous adaptive shields
        Sequencer.EffectManager.endEffects({
          origin: `AdaptiveEvolution.${token.id}`
        });

        const color = DAMAGE_COLOR_MAP[damageType];
        if (color) {
          const tier = (newState === "immune") ? "02" : "01";

          new Sequence()
            .effect()
            .file(`jb2a.shield.${tier}.loop.${color}`)
            .atLocation(token)
            .scale(1.0)
            .opacity(0.85)
            .persist()
            .origin(`AdaptiveEvolution.${token.id}`)
            .fadeIn(250)
            .play();
        }
      }

      // --------------------------------------------------
      // CHAT FEEDBACK
      // --------------------------------------------------
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token }),
        content: `<b>${actor.name}</b> adapts to <b>${damageType}</b> → <b>${newState.toUpperCase()}</b><br>
                  <i>The Arcanite Sword recalibrates its energy.</i>`
      });
    }
  });

  console.log("🧬 Adaptive Evolution | Loaded successfully");
});
