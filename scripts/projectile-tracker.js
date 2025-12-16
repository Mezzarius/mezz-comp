/*******************************************************
 * MEZZ-COMP : Projectile & Thrown Weapon Tracker
 * Foundry VTT v12.x
 *
 * Requires:
 *  - midi-qol
 *  - item-piles
 *
 * Rules:
 *  - Thrown weapons never break
 *  - Ammo (arrows/bolts) have 25% break chance
 *******************************************************/

const MEZZ_PROJECTILE_DEBUG = false;
const BREAK_CHANCE_AMMO = 0.25;

/* -------------------------------------------- */
/* Utility Debug                                */
/* -------------------------------------------- */
function debug(...args) {
  if (MEZZ_PROJECTILE_DEBUG) console.log("MEZZ | Projectile:", ...args);
}

/* -------------------------------------------- */
/* Hook: After Attack Resolution                 */
/* -------------------------------------------- */
Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
  try {
    if (!workflow?.item || !workflow.token) return;

    const item = workflow.item;
    const actor = workflow.actor;
    const sourceToken = workflow.token;

    const isThrown = isThrownWeapon(item);
    const ammoItem = getConsumedAmmo(workflow);

    // Nothing to track
    if (!isThrown && !ammoItem) return;

    debug("Processing attack:", item.name);

    /* ---------- HIT TARGETS ---------- */
    for (const target of workflow.hitTargets) {
      await handleHit({
        projectile: isThrown ? item : ammoItem,
        isThrown,
        targetToken: target
      });
    }

    /* ---------- MISSES ---------- */
    for (const target of workflow.targets) {
      if (workflow.hitTargets.has(target)) continue;

      await handleMiss({
        projectile: isThrown ? item : ammoItem,
        isThrown,
        sourceToken
      });
    }

  } catch (err) {
    console.error("MEZZ | Projectile Tracker Error:", err);
  }
});

/* -------------------------------------------- */
/* Determine Ammo                               */
/* -------------------------------------------- */
function getConsumedAmmo(workflow) {
  const ammo = workflow.consumedAmmo;
  if (!ammo?.itemId) return null;
  return workflow.actor.items.get(ammo.itemId);
}

/* -------------------------------------------- */
/* Determine Thrown Weapon                      */
/* -------------------------------------------- */
function isThrownWeapon(item) {
  return (
    item.system?.properties?.thr === true ||
    (
      item.system.actionType === "rwak" &&
      item.system.range?.value > 5 &&
      !item.system.consume?.type
    )
  );
}

/* -------------------------------------------- */
/* Handle HIT                                   */
/* -------------------------------------------- */
async function handleHit({ projectile, isThrown, targetToken }) {
  if (!projectile || !targetToken?.actor) return;

  const breaks = !isThrown && rollAmmoBreak();
  const itemData = breaks
    ? makeBrokenItem(projectile)
    : projectile.toObject();

  itemData.system.quantity = 1;

  debug("Hit → added to target:", itemData.name);

  await targetToken.actor.createEmbeddedDocuments("Item", [itemData]);
}

/* -------------------------------------------- */
/* Handle MISS                                  */
/* -------------------------------------------- */
async function handleMiss({ projectile, isThrown, sourceToken }) {
  if (!projectile || !sourceToken) return;

  const breaks = !isThrown && rollAmmoBreak();
  const itemData = breaks
    ? makeBrokenItem(projectile)
    : projectile.toObject();

  itemData.system.quantity = 1;

  const pos = scatterPosition(sourceToken);

  debug("Miss → dropped:", itemData.name);

  await game.itempiles.API.createItemPile(pos, {
    items: [itemData]
  });
}

/* -------------------------------------------- */
/* Ammo Break Roll                              */
/* -------------------------------------------- */
function rollAmmoBreak() {
  return Math.random() < BREAK_CHANCE_AMMO;
}

/* -------------------------------------------- */
/* Broken Item Builder                          */
/* -------------------------------------------- */
function makeBrokenItem(item) {
  const data = item.toObject();

  data.name = `Broken ${data.name}`;
  data.system.description = {
    value: `<p><em>This item is broken and unusable.</em></p>`
  };

  data.system.equipped = false;
  data.system.attunement = 0;

  return data;
}

/* -------------------------------------------- */
/* Scatter Position                             */
/* -------------------------------------------- */
function scatterPosition(token) {
  const gridSize = canvas.grid.size;
  const radius = 1.5 * gridSize;
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * radius;

  return {
    x: token.center.x + Math.cos(angle) * distance,
    y: token.center.y + Math.sin(angle) * distance
  };
}
