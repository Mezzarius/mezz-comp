/******************************************************
 * Utility Functions — Mezz’s Comp
 ******************************************************/

export const MODULE_ID = "mezz-comp";

export function log(...args) {
  const enabled = getSetting("debug") ?? true;
  if (enabled) console.log(`🧩 [${MODULE_ID}]`, ...args);
}

export function warn(...args) {
  console.warn(`⚠️ [${MODULE_ID}]`, ...args);
}

export async function safeRun(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`❌ [${MODULE_ID}] ${label}`, err);
  }
}

export function getModuleAsset(path) {
  return `modules/mezz-comp/${path}`;
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}

export async function sendChat(actor, content) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}
