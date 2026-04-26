/**
 * paperdoll-config.mjs
 * Slot layout matches color-coded diagram.
 * small: true = renders at 32px instead of 44px
 * bgHud: 'main'|'off' = syncs to/from bg3-hud-core (hand slots)
 */

export const PAPERDOLL_SLOTS = {
  // HEAD — small, top center
  head:      { label:'Head',       x:50,  y:7,   side:'center', icon:'fa-solid fa-helmet-battle',  acceptTypes:['armor','equipment'],                    small:true  },
  // NECK — small, upper left of chest
  neck:      { label:'Neck',       x:35,  y:14,  side:'left',   icon:'fa-solid fa-gem',             acceptTypes:['equipment'],                            small:true  },
  // BACK — upper right (pink in diagram)
  back:      { label:'Back/Cloak', x:72,  y:10,  side:'right',  icon:'fa-solid fa-vest',            acceptTypes:['equipment','armor'],                    small:false },
  // SHOULDERS — gray, flanking upper torso
  shoulderL: { label:'Shoulder L', x:20,  y:24,  side:'left',   icon:'fa-solid fa-shield',          acceptTypes:['armor','equipment'],                    small:false },
  shoulderR: { label:'Shoulder R', x:80,  y:24,  side:'right',  icon:'fa-solid fa-shield',          acceptTypes:['armor','equipment'],                    small:false },
  // CHEST — red, center
  chest:     { label:'Armor',      x:50,  y:30,  side:'center', icon:'fa-solid fa-shirt',           acceptTypes:['armor','equipment'],                    small:false },
  // BELT — orange, small, center
  waist:     { label:'Belt',       x:50,  y:48,  side:'center', icon:'fa-solid fa-ring-diamond',    acceptTypes:['armor','equipment'],                    small:true  },
  // ON-BELT — yellow-light, flanking belt
  beltItemL: { label:'On Belt L',  x:30,  y:52,  side:'left',   icon:'fa-solid fa-sack',            acceptTypes:['equipment','container','weapon'],        small:false },
  beltItemR: { label:'On Belt R',  x:70,  y:52,  side:'right',  icon:'fa-solid fa-sack',            acceptTypes:['equipment','container','weapon'],        small:false },
  // HANDS — yellow, syncs with BG3 HUD (3 sets each)
  handL:     { label:'Main Hand',  x:15,  y:57,  side:'left',   icon:'fa-solid fa-hand',            acceptTypes:['weapon','equipment','shield','consumable','tool'],  small:false, bgHud:'main' },
  handR:     { label:'Off Hand',   x:85,  y:57,  side:'right',  icon:'fa-solid fa-shield-halved',   acceptTypes:['weapon','equipment','shield','consumable','tool'],  small:false, bgHud:'off'  },
  // RINGS — lime, small
  ringL:     { label:'Ring L',     x:15,  y:70,  side:'left',   icon:'fa-solid fa-ring',            acceptTypes:['equipment'],                            small:true  },
  ringR:     { label:'Ring R',     x:85,  y:70,  side:'right',  icon:'fa-solid fa-ring',            acceptTypes:['equipment'],                            small:true  },
  // GLOVES — purple
  gloves:    { label:'Gloves',     x:10,  y:46,  side:'left',   icon:'fa-solid fa-hand',            acceptTypes:['armor','equipment'],                    small:false },
  // CLOTHES — green, center lower
  clothes:   { label:'Clothes',    x:50,  y:72,  side:'center', icon:'fa-solid fa-shirt',           acceptTypes:['armor','equipment'],                    small:false },
  // BOOTS — cyan, small, bottom center
  boots:     { label:'Boots',      x:50,  y:95,  side:'center', icon:'fa-solid fa-boot',            acceptTypes:['armor','equipment'],                    small:true  },
  // MISC — blue, corners
  misc1:     { label:'Misc',       x:8,   y:80,  side:'left',   icon:'fa-solid fa-star',            acceptTypes:['equipment','loot','tool','consumable'], small:false },
  misc2:     { label:'Misc',       x:92,  y:80,  side:'right',  icon:'fa-solid fa-star',            acceptTypes:['equipment','loot','tool','consumable'], small:false },
  misc3:     { label:'Misc',       x:8,   y:90,  side:'left',   icon:'fa-solid fa-star',            acceptTypes:['equipment','loot','tool','consumable'], small:false },
  misc4:     { label:'Misc',       x:92,  y:90,  side:'right',  icon:'fa-solid fa-star',            acceptTypes:['equipment','loot','tool','consumable'], small:false },
};

export function getSlotsForItem(item) {
  const subtype  = item.system?.type?.value ?? '';
  const isShield = subtype === 'shield';
  const isArmor  = ['light','medium','heavy','bonus'].includes(subtype);
  const isWeapon = item.type === 'weapon' && subtype !== 'natural';
  const isConsumable = item.type === 'consumable' || item.type === 'tool';

  return Object.entries(PAPERDOLL_SLOTS).filter(([, slot]) => {
    if (slot.acceptTypes.includes(item.type)) return true;
    if (isShield && slot.acceptTypes.includes('shield')) return true;
    if (isArmor  && slot.acceptTypes.includes('armor'))  return true;
    if (isWeapon     && slot.acceptTypes.includes('weapon'))     return true;
    if (isConsumable && slot.acceptTypes.includes('consumable')) return true;
    return false;
  }).map(([key]) => key);
}
