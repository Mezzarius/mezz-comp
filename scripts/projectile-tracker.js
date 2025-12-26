/**
 * Projectile Recovery System for Foundry VTT - World Script Version
 * 
 * This script automatically handles transferring ammunition/thrown weapons to target's 
 * inventory after successful ranged attacks. The projectile embeds in the target and 
 * can be looted from their body when defeated.
 * 
 * Works with arrows, bolts, bullets, daggers, javelins, and other projectiles.
 * Can optionally break projectiles based on a chance roll.
 * 
 * SETUP:
 * 1. Add this script to your world's scripts folder or use a module like "Custom Code"
 * 2. Configure settings below
 * 3. Script will automatically hook into attacks and process hits
 */

// ============ CONFIGURATION ============
const PROJECTILE_RECOVERY_CONFIG = {
    BREAK_CHANCE: 0.5, // 50% chance projectile breaks (0.0 = never breaks, 1.0 = always breaks)
    NOTIFY_PLAYERS: true, // Show chat messages about recovered/broken ammo
    HALF_RECOVERY: false, // If true, only recover half of ammunition (rounded down)
    AUTO_PROCESS: true, // Automatically process on each attack (requires midi-qol)
    ENABLED: true // Master switch to enable/disable the system
};

// ============ HOOK: Listen for attacks ============
Hooks.on("midi-qol.RollComplete", async (workflow) => {
    if (!PROJECTILE_RECOVERY_CONFIG.ENABLED || !PROJECTILE_RECOVERY_CONFIG.AUTO_PROCESS) return;
    
    // Check if this was a weapon attack that hit
    if (!workflow.item || workflow.item.type !== "weapon") return;
    if (!workflow.hitTargets || workflow.hitTargets.size === 0) return;
    
    const weapon = workflow.item;
    const attacker = workflow.actor;
    
    // Check if weapon is thrown or uses ammunition
    const isThrown = weapon.system.properties?.thr || weapon.system.properties?.has?.("thr");
    const ammunition = weapon.system.consume?.target;
    
    if (!isThrown && !ammunition) return;
    
    let itemToRecover;
    
    if (isThrown) {
        itemToRecover = weapon;
    } else if (ammunition) {
        itemToRecover = attacker.items.get(ammunition);
        if (!itemToRecover) return;
    } else {
        return;
    }
    
    // Process each hit target
    for (let target of workflow.hitTargets) {
        await processProjectileRecovery(target.actor, itemToRecover, attacker, isThrown);
    }
});

// ============ RECOVERY LOGIC ============
async function processProjectileRecovery(targetActor, itemToRecover, attacker, isThrown = false) {
    if (!targetActor) return;
    
    const config = PROJECTILE_RECOVERY_CONFIG;
    
    // Determine how many projectiles to recover
    let projectileCount = 1;
    if (config.HALF_RECOVERY && projectileCount > 1) {
        projectileCount = Math.floor(projectileCount / 2);
    }
    
    if (projectileCount === 0) {
        if (config.NOTIFY_PLAYERS) {
            ChatMessage.create({
                content: `<p><strong>${itemToRecover.name}</strong> was not recovered from ${targetActor.name}.</p>`,
                speaker: ChatMessage.getSpeaker()
            });
        }
        return;
    }
    
    // Roll to see if projectile breaks
    const breakRoll = Math.random();
    const isBroken = breakRoll < config.BREAK_CHANCE;
    
    // Create the projectile/weapon item data
    let recoveredItem = duplicate(itemToRecover.toObject());
    
    // For thrown weapons, set quantity to 1; for ammo, use projectileCount
    if (isThrown) {
        recoveredItem.system.quantity = 1;
        // Unequip the recovered thrown weapon
        recoveredItem.system.equipped = false;
    } else {
        recoveredItem.system.quantity = projectileCount;
    }
    
    // If broken, add "Broken" to the name and make it worthless/unusable
    if (isBroken) {
        recoveredItem.name = `${recoveredItem.name} (Broken)`;
        recoveredItem.system.price.value = 0;
        
        if (isThrown) {
            // For thrown weapons, also mark as not proficient to prevent use
            recoveredItem.system.proficient = 0;
        }
        
        if (recoveredItem.system.description?.value) {
            recoveredItem.system.description.value += `<p><em>This ${isThrown ? 'weapon' : 'ammunition'} is broken and cannot be used.</em></p>`;
        }
    }
    
    // Add to target's inventory
    await targetActor.createEmbeddedDocuments("Item", [recoveredItem]);
    
    // Notify
    if (config.NOTIFY_PLAYERS) {
        const statusText = isBroken ? "broken" : "intact";
        const emoji = isBroken ? "💔" : "✅";
        const itemType = isThrown ? "weapon" : "ammunition";
        
        ChatMessage.create({
            content: `
                <div class="dnd5e chat-card">
                    <header class="card-header flexrow">
                        <img src="${itemToRecover.img}" width="36" height="36" />
                        <h3>${isThrown ? 'Thrown Weapon' : 'Projectile'} Recovery</h3>
                    </header>
                    <div class="card-content">
                        <p>${emoji} <strong>${isThrown ? '1x' : projectileCount + 'x'} ${itemToRecover.name}</strong> ${statusText} was ${isBroken ? 'found broken' : 'recovered'} from <strong>${targetActor.name}</strong>.</p>
                        ${isBroken ? `<p><em>The ${itemType} is damaged and cannot be reused.</em></p>` : ''}
                    </div>
                </div>
            `,
            speaker: ChatMessage.getSpeaker({actor: attacker})
        });
    }
}

// ============ MANUAL TRIGGER FUNCTION (Optional) ============
// You can still manually trigger recovery with: game.projectileRecovery.recover()
window.projectileRecovery = {
    config: PROJECTILE_RECOVERY_CONFIG,
    
    async recover() {
        const selectedTokens = canvas.tokens.controlled;
        if (selectedTokens.length === 0) {
            ui.notifications.warn("Please select the attacking token!");
            return;
        }
        const attacker = selectedTokens[0].actor;
        
        const targetedTokens = Array.from(game.user.targets);
        if (targetedTokens.length === 0) {
            ui.notifications.warn("Please target at least one creature that was hit!");
            return;
        }
        
        // Ask for confirmation that attack hit
        const confirmHit = await Dialog.confirm({
            title: "Confirm Hit",
            content: "<p>Did the attack successfully hit the target(s)?</p>",
            yes: () => true,
            no: () => false,
            defaultYes: true
        });
        
        if (!confirmHit) {
            ui.notifications.info("Attack missed - no projectiles embedded.");
            return;
        }
        
        // Get weapon selection
        const rangedWeapons = attacker.items.filter(i => 
            i.type === "weapon" && 
            (i.system.actionType === "rwak" || i.system.properties?.thr || i.system.properties?.has?.("thr"))
        );
        
        if (rangedWeapons.length === 0) {
            ui.notifications.warn("No ranged or thrown weapons found!");
            return;
        }
        
        let weapon;
        if (rangedWeapons.length === 1) {
            weapon = rangedWeapons[0];
        } else {
            const weaponChoice = await Dialog.prompt({
                title: "Select Weapon",
                content: `
                    <form>
                        <div class="form-group">
                            <label>Which weapon was used?</label>
                            <select id="weapon-select" style="width: 100%">
                                ${rangedWeapons.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
                            </select>
                        </div>
                    </form>
                `,
                callback: (html) => html.find("#weapon-select").val(),
                rejectClose: false
            });
            
            if (!weaponChoice) return;
            weapon = attacker.items.get(weaponChoice);
        }
        
        const isThrown = weapon.system.properties?.thr || weapon.system.properties?.has?.("thr");
        const ammunition = weapon.system.consume?.target;
        
        let itemToRecover;
        
        if (isThrown) {
            itemToRecover = weapon;
        } else if (ammunition) {
            itemToRecover = attacker.items.get(ammunition);
            if (!itemToRecover) {
                ui.notifications.warn("Ammunition item not found!");
                return;
            }
        } else {
            ui.notifications.info(`${weapon.name} does not use ammunition or is not a thrown weapon.`);
            return;
        }
        
        for (let target of targetedTokens) {
            await processProjectileRecovery(target.actor, itemToRecover, attacker, isThrown);
        }
    },
    
    enable() {
        this.config.ENABLED = true;
        ui.notifications.info("Projectile Recovery System enabled");
    },
    
    disable() {
        this.config.ENABLED = false;
        ui.notifications.info("Projectile Recovery System disabled");
    }
};

console.log("Projectile Recovery System loaded. Use game.projectileRecovery.recover() to manually trigger.");