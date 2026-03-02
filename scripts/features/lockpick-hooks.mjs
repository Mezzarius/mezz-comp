// =====================================================
// MEZZ-COMP LOCKPICK HOOKS
// scripts/features/lockpick-hooks.mjs
// =====================================================

import { MODULE_ID, log, warn, safeRun, getSetting, sendChat } from "../utils.mjs";
import { openLockpickMinigame } from "./lockpick-app.mjs";

export function registerLockpickHooks() {
  log("Lockpick hooks registered.");

  // ── Lock & Key module (Saibot393) ─────────────────────
  // Lock & Key fires preCreateChatMessage with flavor "X tried to pick a lock:"
  // Returning false from this hook suppresses the message AND runs our minigame.
  Hooks.on("preCreateChatMessage", async (message, options, userId) => {
    const flavor = message.flavor ?? message._source?.flavor ?? "";
    if (!flavor.includes("tried to pick a lock")) return;

    // Find actor — try speaker first, then current user's character
    const speaker = message.speaker ?? message._source?.speaker ?? {};
    let actor = null;
    if (speaker.actor)  actor = game.actors.get(speaker.actor);
    if (!actor && speaker.token) actor = canvas.tokens.get(speaker.token)?.actor;
    if (!actor) actor = game.user.character;

    if (!actor) {
      warn("Lock & Key hook: could not resolve actor.");
      return;
    }

    const dc         = getSetting("lockpickDefaultDC") ?? 15;
    const skillBonus = _getSleightOfHandBonus(actor);
    log(`Lock & Key intercept | actor=${actor.name} DC=${dc} SoH=${skillBonus}`);

    let result;
    await safeRun("lockpick minigame (Lock & Key)", async () => {
      result = await openLockpickMinigame(actor, null, { dc, skillBonus });
    });

    if (!result || result.aborted) return;
    await _postResult(actor, result, dc, skillBonus);

    if (!result.success && getSetting("lockpickConsumeOnFail")) {
      const tools = actor.items.find(i => _isThievesTools(i));
      if (tools) await safeRun("consume tools", () => _consumeThievesTools(actor, tools));
    }
  });

  // ── midi-qol path ─────────────────────────────────────
  Hooks.on("midi-qol.preItemRoll", async (workflow) => {
    if (!_isThievesTools(workflow.item)) return true;
    if (!_isLockpickAttempt(workflow))   return true;

    const dc         = _getLockDC(workflow);
    const skillBonus = _getSleightOfHandBonus(workflow.actor);

    log(`Lockpick triggered | actor=${workflow.actor.name} DC=${dc} SoH=${skillBonus}`);

    let result;
    await safeRun("lockpick minigame", async () => {
      result = await openLockpickMinigame(workflow.actor, workflow.item, { dc, skillBonus });
    });

    if (!result || result.aborted) {
      workflow.aborted = true;
      return false;
    }

    if (result.success) {
      workflow.attackRollTotal = dc + 1;
      await _postResult(workflow.actor, result, dc, skillBonus);
      return true;
    } else {
      workflow.attackRollTotal = dc - 1;
      await _postResult(workflow.actor, result, dc, skillBonus);
      if (getSetting("lockpickConsumeOnFail")) {
        await safeRun("consume thieves tools", () => _consumeThievesTools(workflow.actor, workflow.item));
      }
      return false;
    }
  });

  // ── dnd5e fallback (no midi-qol) ──────────────────────
  Hooks.on("dnd5e.useItem", async (item, config, options) => {
    if (game.modules.get("midi-qol")?.active) return;
    if (!_isThievesTools(item)) return;

    const actor = item.actor;
    if (!actor) return;

    const dc         = options?.dc ?? getSetting("lockpickDefaultDC");
    const skillBonus = _getSleightOfHandBonus(actor);

    log(`Lockpick triggered (fallback) | actor=${actor.name} DC=${dc} SoH=${skillBonus}`);

    let result;
    await safeRun("lockpick minigame", async () => {
      result = await openLockpickMinigame(actor, item, { dc, skillBonus });
    });

    if (!result || result.aborted) return;

    await _postResult(actor, result, dc, skillBonus);

    if (!result.success && getSetting("lockpickConsumeOnFail")) {
      await safeRun("consume thieves tools", () => _consumeThievesTools(actor, item));
    }
  });
}

// ─────────────────────────────────────────────────────────
//  Skill bonus
// ─────────────────────────────────────────────────────────

/**
 * Returns the actor's full Sleight of Hand modifier.
 * dnd5e 5.x: actor.system.skills.slt.total already includes
 * dex mod + proficiency + any active effect bonuses.
 */
function _getSleightOfHandBonus(actor) {
  const bonus = actor?.system?.skills?.slt?.total ?? 0;
  return bonus;
}

// ─────────────────────────────────────────────────────────
//  Detection helpers
// ─────────────────────────────────────────────────────────

function _isThievesTools(item) {
  if (!item || item.type !== "tool") return false;
  const name       = item.name?.toLowerCase() ?? "";
  const identifier = item.system?.type?.baseItem ?? item.system?.toolType ?? "";
  return (
    name.includes("thieves") ||
    identifier === "thievesTool" ||
    identifier === "thieves-tools"
  );
}

function _isLockpickAttempt(workflow) {
  if (getSetting("lockpickAlwaysUse")) return true;
  const targets = Array.from(game.user.targets);
  if (targets.some(t => t.document.getFlag(MODULE_ID, "isLock"))) return true;
  if (workflow.item?.getFlag(MODULE_ID, "forceLockpick"))          return true;
  return false;
}

function _getLockDC(workflow) {
  const targets = Array.from(game.user.targets);
  for (const t of targets) {
    const dc = t.document.getFlag(MODULE_ID, "lockDC");
    if (dc != null) return Number(dc);
  }
  return getSetting("lockpickDefaultDC") ?? 15;
}

// ─────────────────────────────────────────────────────────
//  Chat output
// ─────────────────────────────────────────────────────────

async function _postResult(actor, result, dc, skillBonus) {
  const { success, locksCleared, picksLeft } = result;
  const icon    = success ? "🔓" : "🔒";
  const outcome = success
    ? `<span style="color:limegreen"><strong>Success!</strong></span> The lock yields.`
    : `<span style="color:tomato"><strong>Failed.</strong></span> The lock holds.`;

  await sendChat(actor,
    `<div class="mezz-comp lockpick-result" style="padding:4px">
      <p>${icon} ${outcome}</p>
      <p style="font-size:0.85em;color:#888">
        Locks cleared: <strong>${locksCleared}</strong> &nbsp;|&nbsp;
        Picks left: <strong>${picksLeft}</strong> &nbsp;|&nbsp;
        DC: <strong>${dc}</strong> &nbsp;|&nbsp;
        SoH: <strong>+${skillBonus}</strong>
      </p>
    </div>`
  );
}

async function _consumeThievesTools(actor, item) {
  const qty    = item.system?.quantity ?? 1;
  const newQty = Math.max(0, qty - 1);
  await item.update({ "system.quantity": newQty });

  await sendChat(actor,
    newQty > 0
      ? `<em>One set of Thieves' Tools is worn out. (${newQty} remaining)</em>`
      : `<em>${actor.name}'s last set of Thieves' Tools is used up!</em>`
  );
}
