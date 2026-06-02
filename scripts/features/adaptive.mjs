/******************************************************
 * Adaptive Evolution
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
  const MODULE_ID     = "mezz-comp";
  /** Flag key — stores { [damageType]: "resistant" | "immune" } for this actor */
  const ADAPTIVE_FLAG = "adaptiveGranted";

  const EXCLUDED_DAMAGE_TYPES = ["necrotic", "lightning"];

  const DAMAGE_COLOR_MAP = {
    cold:         "blue",
    bludgeoning:  "blue",
    acid:         "green",
    poison:       "green",
    fire:         "red",
    slashing:     "red",
    radiant:      "yellow",
    piercing:     "yellow",
    psychic:      "purple",
    force:        "white",
    thunder:      "white",
  };

  // --------------------------------------------------
  // SOCKETLIB (GM AUTHORITY)
  // --------------------------------------------------
  const AdaptiveSocket = socketlib.registerModule("mezz-comp");

  // ── Apply / upgrade resistance or immunity for one damage type ─────────────
  AdaptiveSocket.register("applyAdaptation", async ({ sceneId, tokenId, damageType, newState }) => {
    const scene    = game.scenes.get(sceneId);
    const tokenDoc = scene?.tokens.get(tokenId);
    const actor    = tokenDoc?.actor;
    if (!actor) return;

    const dr = new Set(actor.system.traits.dr.value);
    const di = new Set(actor.system.traits.di.value);

    // Only remove what Adaptive itself previously granted for THIS damage type.
    // Resistances / immunities from race, class, items etc. are left untouched.
    const granted  = actor.getFlag(MODULE_ID, ADAPTIVE_FLAG) ?? {};
    const prevState = granted[damageType];
    if (prevState === "resistant") dr.delete(damageType);
    if (prevState === "immune")    di.delete(damageType);

    if (newState === "resistant") dr.add(damageType);
    if (newState === "immune")    di.add(damageType);

    await actor.update({
      "system.traits.dr.value": [...dr],
      "system.traits.di.value": [...di],
    });

    // Track exactly what Adaptive has granted so future calls only undo their own work
    await actor.setFlag(MODULE_ID, ADAPTIVE_FLAG, { ...granted, [damageType]: newState });

    // Recalibrate Arcanite Sword to latest damage type
    const sword = actor.items.find(i => i.type === "weapon" && i.name === "Arcanite Sword");
    if (sword?.system?.damage?.parts?.length) {
      await sword.update({
        "system.damage.parts": sword.system.damage.parts.map(p => [p[0], damageType]),
      });
    }

    return true;
  });

  // ── Energy release — triggered when an immune-via-Adaptive type hits again ──
  //
  //  Rolls 4d8 [damageType] in a 5ft emanation; each creature in range makes a
  //  Dex save (DC supplied by caller) for half damage.
  // ─────────────────────────────────────────────────────────────────────────────
  AdaptiveSocket.register("triggerEnergyRelease", async ({ sceneId, tokenId, damageType, savedc }) => {
    const scene    = game.scenes.get(sceneId);
    const tokenDoc = scene?.tokens.get(tokenId);
    if (!scene || !tokenDoc) return;

    const gridPx = scene.grid.size;
    const srcX   = tokenDoc.x + (tokenDoc.width  * gridPx) / 2;
    const srcY   = tokenDoc.y + (tokenDoc.height * gridPx) / 2;

    // 5ft emanation: centre-to-centre ≤ 1.5 grid squares catches orthogonal
    // and diagonal adjacency regardless of token size.
    const nearby = scene.tokens.contents.filter(t => {
      if (t.id === tokenId || !t.actor) return false;
      const tx = t.x + (t.width  * gridPx) / 2;
      const ty = t.y + (t.height * gridPx) / 2;
      return Math.hypot(tx - srcX, ty - srcY) <= gridPx * 1.5;
    });

    // Roll 4d8 damage
    const dmgRoll = await new Roll("4d8").evaluate();
    await dmgRoll.toMessage({
      flavor: `⚡ Energy Release — ${damageType} (4d8) — Dex DC ${savedc} for half`,
    });
    const baseDamage = dmgRoll.total;

    if (!nearby.length) {
      ChatMessage.create({ content: `<em>The energy burst finds no creatures within 5ft.</em>` });
      return;
    }

    for (const t of nearby) {
      const target = t.actor;
      let saveTotal = 0;

      // Dex saving throw
      try {
        const saveRoll = await target.rollAbilitySave("dex", { chatMessage: true, fastForward: true });
        saveTotal = saveRoll?.total ?? 0;
      } catch {
        // Fallback: bare d20 + dex save modifier
        const r = await new Roll("1d20").evaluate();
        saveTotal = r.total + (target.system.abilities?.dex?.save ?? 0);
        await r.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: target }),
          flavor: `${target.name} — Dex Save`,
        });
      }

      const passed   = saveTotal >= savedc;
      const finalDmg = passed ? Math.floor(baseDamage / 2) : baseDamage;

      // Apply damage — prefer MidiQOL so immunities / resistances are respected
      if (typeof MidiQOL !== "undefined") {
        await MidiQOL.applyTokenDamage(
          [{ type: damageType, damage: finalDmg }],
          finalDmg,
          new Set([t]),
          null,
          new Set(),
        );
      } else {
        await target.applyDamage?.(finalDmg);
      }

      ChatMessage.create({
        content: `<b>${target.name}</b> — DEX Save <b>${passed ? "SUCCESS" : "FAIL"}</b> `
               + `(${saveTotal} vs DC ${savedc}): <b>${finalDmg}</b> ${damageType} damage.`,
      });
    }
  });

  // --------------------------------------------------
  // MIDI-QOL DAMAGE HOOK
  // --------------------------------------------------
  Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
    if (!workflow?.damageDetail?.length) return;
    if (!workflow.hitTargets?.size)      return;

    // Pick dominant damage type (highest damage value in the roll)
    const damageType = [...workflow.damageDetail]
      .sort((a, b) => b.damage - a.damage)[0]?.type;
    if (!damageType) return;
    if (EXCLUDED_DAMAGE_TYPES.includes(damageType)) return;

    for (const token of workflow.hitTargets) {
      const actor = token.actor;
      if (!actor) continue;
      if (!actor.items.some(i => i.name === "Adaptive Combatant")) continue;

      // Use Adaptive's own flag as source of truth so we ignore native traits
      const granted      = actor.getFlag(MODULE_ID, ADAPTIVE_FLAG) ?? {};
      const currentState = granted[damageType]; // undefined | "resistant" | "immune"

      // ── Already immune via Adaptive → energy release ──────────────────────
      if (currentState === "immune") {
        const savedc = 8
          + (actor.system.attributes.prof ?? 2)
          + Math.floor(((actor.system.abilities?.con?.value ?? 10) - 10) / 2);

        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ token }),
          content: `<b>${actor.name}</b>'s ${damageType} immunity overloads — `
                 + `releasing a burst of energy in a 5ft emanation! (Dex DC ${savedc})`,
        });

        await AdaptiveSocket.executeAsGM("triggerEnergyRelease", {
          sceneId:    token.scene.id,
          tokenId:    token.id,
          damageType,
          savedc,
        });

        // Sequencer burst visual
        if (game.modules.get("sequencer")?.active) {
          Sequencer.EffectManager.endEffects({ origin: `AdaptiveEvolution.${token.id}` });
          const color = DAMAGE_COLOR_MAP[damageType] ?? "white";
          new Sequence()
            .effect()
            .file(`jb2a.energy_strands.complete.${color}.01`)
            .atLocation(token)
            .scale(1.5)
            .opacity(0.9)
            .play();
        }

        continue; // immunity persists; no re-adaptation this hit
      }

      // ── Determine next adaptation state ───────────────────────────────────
      let newState = null;
      if (!currentState)                newState = "resistant";
      else if (currentState === "resistant") newState = "immune";

      if (!newState) continue;

      // ── Apply via GM socket ───────────────────────────────────────────────
      await AdaptiveSocket.executeAsGM("applyAdaptation", {
        sceneId:    token.scene.id,
        tokenId:    token.id,
        damageType,
        newState,
      });

      // Sequencer shield visual
      if (game.modules.get("sequencer")?.active) {
        Sequencer.EffectManager.endEffects({ origin: `AdaptiveEvolution.${token.id}` });
        const color = DAMAGE_COLOR_MAP[damageType];
        if (color) {
          const tier = newState === "immune" ? "02" : "01";
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

      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token }),
        content: `<b>${actor.name}</b> adapts to <b>${damageType}</b> → <b>${newState.toUpperCase()}</b><br>
                  <i>The Arcanite Sword recalibrates its energy.</i>`,
      });
    }
  });

  console.log("🧬 Adaptive Evolution | Loaded successfully");
});
