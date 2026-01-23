import { getSetting } from "../utils.mjs";

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!getSetting("dsnFix")) return;
  if (!game.dice3d || game.dice3d.messageHookDisabled) return;
  const immediate = game.settings.get("dice-so-nice", "immediatelyDisplayChatMessages");
  if (!message._dice3danimating || immediate) return;
  html.classList.add("dsn-hide");
});
