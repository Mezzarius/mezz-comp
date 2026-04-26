const MODULE_ID = "mezz-comp";

// Seed empty slots flag for new actors
Hooks.on("createActor", async (actor) => {
  if (actor.type !== 'character') return;
  await actor.setFlag(MODULE_ID, "slots", {});
});

// Seed for existing actors that predate this module
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  for (const actor of game.actors) {
    if (actor.type !== 'character') continue;
    if (actor.flags?.[MODULE_ID]?.slots === undefined) {
      await actor.setFlag(MODULE_ID, "slots", {});
    }
  }
});
