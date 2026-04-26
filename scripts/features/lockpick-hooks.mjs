// =====================================================
// MEZZ-COMP LOCKPICK HOOKS
// scripts/features/lockpick-hooks.mjs
// =====================================================

import { MODULE_ID, log, warn, safeRun, getSetting, sendChat } from "../utils.mjs";
import { openLockpickMinigame } from "./lockpick-app.mjs";

// Module-level socketlib socket — set by registerLockpickSocket() called from main.mjs
// on the socketlib.ready hook, which fires before our ready handler.
export let mezzSocket = null;

export function registerLockpickSocket() {
  mezzSocket = socketlib.registerModule(MODULE_ID);
  mezzSocket.register("runLockpickMinigame", _runMinigameAsPlayer);
  console.log("🧩 [mezz-comp] Lockpick socketlib socket registered.");
}

export function registerLockpickHooks() {
  log("Lockpick hooks registered.");

  // ── Lock & Key module (Saibot393) ─────────────────────
  // LocknKey.LockUse fires GM-side only via socketlib.
  // The GM intercepts it, resolves DC + roll, then uses socketlib to
  // execute the minigame on the acting player's client and await the result.

  // Debounce keyed by LockID+CharacterID — Lock & Key fires 3 times per attempt.
  // Using a Map with timestamps so it self-expires after 60s if something goes wrong.
  const _lockuseInProgress = new Map();

  Hooks.on("LocknKey.LockUse", async (lockToken, characterToken, payload) => {
    if (!game.user.isGM) return;

    const data = payload?.useData;
    if (data?.useType !== "LockusePick") return;

    const debounceKey = `${data.LockID}-${data.CharacterID}`;
    const now = Date.now();
    const last = _lockuseInProgress.get(debounceKey) ?? 0;
    if (now - last < 60_000) { log("Lock & Key: ignoring duplicate hook fire for " + debounceKey); return; }
    _lockuseInProgress.set(debounceKey, now);

    try {
      const actor = characterToken?.actor ?? game.actors.get(data.CharacterID);
      if (!actor) {
        warn(`Lock & Key: could not resolve actor (CharacterID=${data.CharacterID})`);
        return;
      }

      let dc = getSetting("lockpickDefaultDC") ?? 15;
      if (lockToken) {
        // LocknKey stores the DC as flags.LocknKey.LockDCFlag on the token document.
        // Fall back to other possible scopes/keys defensively, then to the module setting.
        const flagCandidates = [
          ["LocknKey", "LockDCFlag"],   // confirmed from token flags inspection
          ["LocknKey", "lockDC"],
          [MODULE_ID,  "lockDC"],
        ];
        let flagDC = null;
        for (const [scope, key] of flagCandidates) {
          try {
            const val = lockToken.getFlag(scope, key);
            if (val != null) { flagDC = val; break; }
          } catch { /* scope not active */ }
        }
        if (flagDC != null) { dc = Number(flagDC); log(`Lock DC from token flag (LocknKey.LockDCFlag): ${dc}`); }
      }

      const rollTotal  = Number(data.Rollresult) || dc;
      const skillBonus = _getSleightOfHandBonus(actor);

      log(`Lock & Key GM intercept | actor=${actor.name} DC=${dc} roll=${rollTotal} SoH=${skillBonus} userId=${data.userID}`);

      let result;

      if (mezzSocket && data.userID) {
        // Execute minigame on the player's client and await their result
        await safeRun("lockpick minigame (Lock & Key)", async () => {
          result = await mezzSocket.executeAsUser("runLockpickMinigame", data.userID, {
            actorId:    actor.id,
            toolItemId: data.UsedItemID ?? null,
            dc,
            skillBonus,
            rollTotal,
          });
        });
      } else {
        // Fallback: socketlib unavailable — open on GM client
        warn("Lock & Key: socketlib unavailable, opening minigame on GM client");
        const toolItem = actor.items.get(data.UsedItemID) ?? actor.items.find(i => _isThievesTools(i));
        await safeRun("lockpick minigame (Lock & Key fallback)", async () => {
          result = await openLockpickMinigame(actor, toolItem ?? null, { dc, skillBonus, rollTotal });
        });
      }

      if (!result || result.aborted) return;

      // Apply the minigame outcome to the lock — Lock & Key stores lock state in
      // LocknKey.LockedFlag and item-piles mirrors it in item-piles.data.locked.
      // The GM sets these directly since Lock & Key won't honour our result automatically.
      if (lockToken) {
        await safeRun("apply lock state", async () => {
          if (result.success) {
            // Unlock: clear LocknKey locked flag and item-piles locked state
            await lockToken.setFlag("LocknKey", "LockedFlag", false);
            const pilesData = lockToken.getFlag("item-piles", "data");
            if (pilesData) {
              await lockToken.setFlag("item-piles", "data", { ...pilesData, locked: false, closed: false });
            }
            log(`Lock & Key: unlocked ${lockToken.name}`);
          } else {
            // Failed — ensure it stays locked (Lock & Key may have already unlocked it)
            await lockToken.setFlag("LocknKey", "LockedFlag", true);
            const pilesData = lockToken.getFlag("item-piles", "data");
            if (pilesData) {
              await lockToken.setFlag("item-piles", "data", { ...pilesData, locked: true });
            }
            log(`Lock & Key: keeping ${lockToken.name} locked after failed minigame`);
          }
        });
      }

      await _postResult(actor, result, dc, skillBonus, rollTotal, result.skipped ?? false);

      if (!result.success && getSetting("lockpickConsumeOnFail")) {
        const toolItem = actor.items.get(data.UsedItemID) ?? actor.items.find(i => _isThievesTools(i));
        if (toolItem) await safeRun("consume tools", () => _consumeThievesTools(actor, toolItem));
      }
    } finally {
      _lockuseInProgress.delete(debounceKey);
    }
  });

  // ── midi-qol path ─────────────────────────────────────
  Hooks.on("midi-qol.preItemRoll", async (workflow) => {
    if (!_isThievesTools(workflow.item)) return true;
    if (!_isLockpickAttempt(workflow))   return true;

    const dc         = _getLockDC(workflow);
    const skillBonus = _getSleightOfHandBonus(workflow.actor);
    const rollTotal  = workflow.attackRollTotal ?? workflow.roll?.total ?? dc;

    log(`Lockpick triggered | actor=${workflow.actor.name} DC=${dc} SoH=${skillBonus} roll=${rollTotal}`);

    let result;
    await safeRun("lockpick minigame", async () => {
      result = await openLockpickMinigame(workflow.actor, workflow.item, { dc, skillBonus, rollTotal });
    });

    if (!result || result.aborted) {
      workflow.aborted = true;
      return false;
    }

    // Skipped via ESC — accept raw roll result
    if (result.skipped) {
      const skippedSuccess = rollTotal >= dc;
      workflow.attackRollTotal = skippedSuccess ? dc + 1 : dc - 1;
      await _postResult(workflow.actor, result, dc, skillBonus, rollTotal, /* skipped */ true);
      if (!skippedSuccess && getSetting("lockpickConsumeOnFail")) {
        await safeRun("consume thieves tools", () => _consumeThievesTools(workflow.actor, workflow.item));
      }
      return skippedSuccess;
    }

    if (result.success) {
      workflow.attackRollTotal = dc + 1;
      await _postResult(workflow.actor, result, dc, skillBonus, rollTotal);
      return true;
    } else {
      workflow.attackRollTotal = dc - 1;
      await _postResult(workflow.actor, result, dc, skillBonus, rollTotal);
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

    const rollTotal  = options?.rollTotal ?? dc;

    let result;
    await safeRun("lockpick minigame", async () => {
      result = await openLockpickMinigame(actor, item, { dc, skillBonus, rollTotal });
    });

    if (!result || result.aborted) return;

    await _postResult(actor, result, dc, skillBonus, rollTotal, result.skipped ?? false);

    if (!result.success && getSetting("lockpickConsumeOnFail")) {
      await safeRun("consume thieves tools", () => _consumeThievesTools(actor, item));
    }
  });
}

// ─────────────────────────────────────────────────────────
//  Socketlib handler — runs on the player's client
// ─────────────────────────────────────────────────────────

/**
 * Called via socketlib.executeAsUser on the acting player's client.
 * Opens the minigame locally and returns the result to the GM.
 */
async function _runMinigameAsPlayer({ actorId, toolItemId, dc, skillBonus, rollTotal }) {
  const actor    = game.actors.get(actorId);
  const toolItem = actor?.items.get(toolItemId) ?? actor?.items.find(i => _isThievesTools(i)) ?? null;

  if (!actor) {
    warn(`runLockpickMinigame: actor ${actorId} not found on player client`);
    return { success: false, locksCleared: 0, picksLeft: 0, aborted: true };
  }

  log(`Running minigame on player client | actor=${actor.name} DC=${dc} roll=${rollTotal}`);

  let result = { success: false, locksCleared: 0, picksLeft: 0, aborted: true };
  await safeRun("lockpick minigame (player client)", async () => {
    result = await openLockpickMinigame(actor, toolItem, { dc, skillBonus, rollTotal });
  });
  return result;
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

async function _postResult(actor, result, dc, skillBonus, rollTotal = 0, skipped = false) {
  const { success, locksCleared, picksLeft } = result;
  const icon    = success ? "🔓" : "🔒";
  const outcome = success
    ? `<span style="color:limegreen"><strong>Success!</strong></span> The lock yields.`
    : `<span style="color:tomato"><strong>Failed.</strong></span> The lock holds.`;
  const skipNote = skipped
    ? `<br><span style="color:#aaa;font-size:0.8em;font-style:italic;">⏭ Minigame skipped — roll result accepted (${rollTotal} vs DC ${dc})</span>`
    : "";

  await sendChat(actor,
    `<div class="mezz-comp lockpick-result" style="padding:4px">
      <p>${icon} ${outcome}${skipNote}</p>
      <p style="font-size:0.85em;color:#888">
        Roll: <strong>${rollTotal}</strong> vs DC <strong>${dc}</strong> &nbsp;|&nbsp;
        Locks cleared: <strong>${locksCleared}</strong> &nbsp;|&nbsp;
        Picks left: <strong>${picksLeft}</strong> &nbsp;|&nbsp;
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
