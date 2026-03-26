const MODULE_ID = "mezz-comp";

const DEFAULT_PAPERDOLL = {
  head:     null,
  neck:     null,
  chest:    null,
  back:     null,
  shoulderL: null,
  shoulderR: null,
  handL:    null,
  handR:    null,
  ringL:    null,
  ringR:    null,
  gloves:   null,
  boots:    null
};

// FIX: removed the renderActorSheet init block entirely.
// Calling setFlag() inside renderActorSheet causes a re-render which
// re-fires the hook — a potential render loop. createActor is the
// correct and only place to seed default flags.

Hooks.on("createActor", async (actor) => {
  await actor.setFlag(
    MODULE_ID,
    "paperdoll",
    foundry.utils.deepClone(DEFAULT_PAPERDOLL)
  );
});

// FIX: also seed flags for actors that existed before this module was added.
// Runs once on ready; skips actors that already have the flag.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;

  for (const actor of game.actors) {
    const existing = actor.flags?.[MODULE_ID]?.paperdoll;
    if (!existing) {
      await actor.setFlag(
        MODULE_ID,
        "paperdoll",
        foundry.utils.deepClone(DEFAULT_PAPERDOLL)
      );
    }
  }
});
