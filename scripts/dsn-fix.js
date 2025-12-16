Hooks.on("renderChatMessageHTML", (message, html, data) => {
    // ========== SAFETY GUARDS ==========
    if (!game.dice3d) return;
    if (game.dice3d.messageHookDisabled) return;
    if (!html) return;

    const immediate = game.settings.get("dice-so-nice", "immediatelyDisplayChatMessages");

    // Only hide messages while dice are animating
    if (!message._dice3danimating || immediate) return;

    // First render stage - no new rolls yet
    if (!message._dice3dCountNewRolls) {
        html.classList.add("dsn-hide");
        message._dice3dMessageHidden = true;
        return;
    }

    // =====================================
    // Handle accumulation of hidden rolls
    // =====================================
    if (!Array.isArray(message._dice3dRollsHidden))
        message._dice3dRollsHidden = [];

    message._dice3dRollsHidden.push(message._dice3dCountNewRolls);

    // Track rendering between sidebar <-> popout
    const popoutExists = Boolean(window?.ui?.sidebar?.popouts?.chat);

    if (popoutExists) {
        // Alternate true/false every render
        message._dice3dRenderedInPopout =
            typeof message._dice3dRenderedInPopout === "undefined"
                ? false
                : !message._dice3dRenderedInPopout;
    }

    // Compute how many rolls must be hidden
    const half = message._dice3dRenderedInPopout ? 2 : 1;
    const sumHidden = message._dice3dRollsHidden.reduce((a, b) => a + b, 0) / half;

    // =====================================
    // Hide dice-roll elements safely
    // =====================================
    const diceRolls = Array.from(html.querySelectorAll(".dice-roll") ?? []);

    if (diceRolls.length > 0 && sumHidden > 0) {
        const toHide = diceRolls.slice(-sumHidden);
        for (const el of toHide) {
            if (el?.classList) el.classList.add("dsn-hide");
        }
    }

    // =====================================
    // Hide entire message if original rolls aren’t finished
    // =====================================
    if (message._dice3dMessageHidden)
        html.classList.add("dsn-hide");
});
