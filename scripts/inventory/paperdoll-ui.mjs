/**
 * paperdoll-ui.mjs
 *
 * - All slots hidden until drag reveals them or an item is placed
 * - Dropping equips via dnd5e system.equipped (reflects in inventory)
 * - Hand slots sync bidirectionally with bg3-hud-core (all 3 sets)
 * - Container slots (backpack, quiver etc.) are dynamic, not hardcoded
 * - Popup uses highest z-index, stays on top
 */

import { PAPERDOLL_SLOTS, getSlotsForItem } from './paperdoll-config.mjs';
import { buildContainerPanel, refreshContainerPanel } from './paperdoll-containers.mjs';

const MODULE_ID = 'mezz-comp';
const DEFAULT_IMAGES = {
  male:   'modules/mezz-comp/assets/paperdoll/default_male.png',
  female: 'modules/mezz-comp/assets/paperdoll/default_female.png',
};

// ─── Image helpers ────────────────────────────────────────────────────────────

async function _setPaperdollImage(actor, path) {
  await actor.setFlag(MODULE_ID, 'paperdollImage', path);
}
function _getPaperdollImage(actor) {
  return actor.flags?.[MODULE_ID]?.paperdollImage ?? DEFAULT_IMAGES.male;
}

// ─── Slot flag helpers ────────────────────────────────────────────────────────

async function _setSlotItem(actor, slotKey, itemId) {
  const current = foundry.utils.deepClone(actor.flags?.[MODULE_ID]?.slots ?? {});
  if (itemId) current[slotKey] = itemId;
  else        delete current[slotKey];
  await actor.setFlag(MODULE_ID, 'slots', current);
}

function _getSlotItem(actor, slotKey) {
  const itemId = actor.flags?.[MODULE_ID]?.slots?.[slotKey];
  if (!itemId) return null;
  const item = actor.items.get(itemId);
  if (!item || !item.system?.equipped) return null;
  return item;
}

// ─── BG3 HUD reading ──────────────────────────────────────────────────────────

function _getBg3ActiveSet(actor) {
  return actor.flags?.['bg3-hud-core']?.hudState?.weaponSets?.activeSet ?? 0;
}

function _getBg3SetItem(actor, setIndex, hand) {
  const sets = actor.flags?.['bg3-hud-core']?.hudState?.weaponSets?.sets;
  if (!sets) return null;
  // BG3 HUD stores all weapon sets in sets[0].items with keys like '0-0','1-0','2-0'
  // Key format: '<setIndex>-<slot>' where slot 0=main, 1=off
  const handSlot = hand === 'main' ? '0' : '1';
  const key      = setIndex + '-' + handSlot;
  // Try sets[0].items first (primary storage), then sets[setIndex].items (fallback)
  const items    = sets[0]?.items ?? sets[setIndex]?.items;
  if (!items) return null;
  const entry = items[key];
  if (!entry) return null;
  const uuid   = typeof entry === 'string' ? entry : (entry.uuid ?? entry.id ?? null);
  if (!uuid) return null;
  const parts  = uuid.split('.');
  return actor.items.get(parts[parts.length - 1]) ?? null;
}

function _getBg3HandItem(actor, hand) {
  const active = _getBg3ActiveSet(actor);
  const item   = _getBg3SetItem(actor, active, hand);
  if (item) return item;
  // Fallback: fvtt-paper-doll-ui
  const pdSlots = actor.flags?.['fvtt-paper-doll-ui']?.slots;
  if (pdSlots) {
    const uuid = pdSlots[hand === 'main' ? 'MAIN_RIGHT.0' : 'OFFHAND_RIGHT.0'];
    if (uuid) {
      const parts = uuid.split('.');
      return actor.items.get(parts[parts.length - 1]) ?? null;
    }
  }
  return null;
}

// ─── BG3 HUD writing ─────────────────────────────────────────────────────────

async function _writeBg3HudHand(actor, hand, item) {
  const hudState  = foundry.utils.deepClone(actor.flags?.['bg3-hud-core']?.hudState ?? {});
  if (!hudState.weaponSets) hudState.weaponSets = { activeSet: 0, sets: [] };
  const active = hudState.weaponSets.activeSet ?? 0;
  while (hudState.weaponSets.sets.length <= active) {
    hudState.weaponSets.sets.push({ items: {} });
  }
  // Always write to sets[0].items with key '<setIndex>-<slot>'
  if (!hudState.weaponSets.sets[0]) hudState.weaponSets.sets[0] = { items: {} };
  const set = hudState.weaponSets.sets[0];
  if (!set.items) set.items = {};
  const handSlot = hand === 'main' ? '0' : '1';
  const key      = active + '-' + handSlot;
  if (item) set.items[key] = item.uuid;
  else      delete set.items[key];

  const pdSlots = foundry.utils.deepClone(actor.flags?.['fvtt-paper-doll-ui']?.slots ?? {});
  const pdKey   = hand === 'main' ? 'MAIN_RIGHT.0' : 'OFFHAND_RIGHT.0';
  if (item) pdSlots[pdKey] = item.uuid;
  else      delete pdSlots[pdKey];

  await actor.update({
    'flags.bg3-hud-core.hudState':    hudState,
    'flags.fvtt-paper-doll-ui.slots': pdSlots,
  });
}

async function _setBg3ActiveSet(actor, setIndex) {
  const hudState = foundry.utils.deepClone(actor.flags?.['bg3-hud-core']?.hudState ?? {});
  if (!hudState.weaponSets) hudState.weaponSets = { activeSet: 0, sets: [] };
  hudState.weaponSets.activeSet = setIndex;
  await actor.update({ 'flags.bg3-hud-core.hudState': hudState });
}

// ─── Equip sync ───────────────────────────────────────────────────────────────

async function _equipItem(actor, item, slotKey) {
  // Clear item from any other slot it was in
  const slots = actor.flags?.[MODULE_ID]?.slots ?? {};
  for (const [key, id] of Object.entries(slots)) {
    if (id === item.id && key !== slotKey) await _setSlotItem(actor, key, null);
  }
  await item.update({ 'system.equipped': true });
  await _setSlotItem(actor, slotKey, item.id);
}

async function _unequipItem(actor, item, slotKey) {
  await item.update({ 'system.equipped': false });
  await _setSlotItem(actor, slotKey, null);
}

// ─── Drop handler ─────────────────────────────────────────────────────────────

async function _onDrop(ev, actor, slotKey) {
  ev.preventDefault();
  ev.stopPropagation();
  let raw = ev.dataTransfer.getData('application/json') || ev.dataTransfer.getData('text/plain');
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  if (!data?.uuid) return;

  const item = await fromUuid(data.uuid);
  if (!item || item.parent?.id !== actor.id) {
    ui.notifications.warn('You can only equip items belonging to this character.');
    return;
  }

  // Containers cannot be placed in equipment slots — they live on the doll as dynamic slots
  if (item.type === 'container') {
    ui.notifications.warn('Containers are shown automatically on the paperdoll based on what you carry.');
    return;
  }

  const rule = PAPERDOLL_SLOTS[slotKey];
  if (!rule) return;

  const subtype       = item.system?.type?.value ?? '';
  const isShield      = subtype === 'shield';
  const isArmor       = ['light','medium','heavy','bonus'].includes(subtype);
  const effectiveType = isShield ? 'shield' : isArmor ? 'armor' : item.type;

  if (!rule.acceptTypes.includes(effectiveType) && !rule.acceptTypes.includes(item.type)) {
    ui.notifications.warn(`Cannot equip ${item.name} in ${rule.label} slot.`);
    return;
  }

  // Unequip previous occupant
  const prev = _getSlotItem(actor, slotKey);
  if (prev && prev.id !== item.id) await _unequipItem(actor, prev, slotKey);

  await _equipItem(actor, item, slotKey);

  // Sync hand slots to BG3 HUD
  if (rule.bgHud) await _writeBg3HudHand(actor, rule.bgHud, item);
}

// ─── Build equipment slot element ─────────────────────────────────────────────

function _buildSlotEl(slotKey, actor) {
  const rule = PAPERDOLL_SLOTS[slotKey];
  const size = rule.small ? 32 : 44;
  const el   = document.createElement('div');
  el.className    = 'mezz-pd-slot' + (rule.small ? ' mezz-pd-slot--sm' : '') + (rule.bgHud ? ' mezz-pd-slot--hand' : '');
  el.dataset.slot = slotKey;
  el.style.left   = rule.x + '%';
  el.style.top    = rule.y + '%';
  el.style.width  = size + 'px';
  el.style.height = size + 'px';
  el.style.display = 'none';
  if (rule.side === 'left')  el.classList.add('mezz-pd-slot--left');
  if (rule.side === 'right') el.classList.add('mezz-pd-slot--right');

  const tip = document.createElement('div');
  tip.className   = 'mezz-pd-slot-tip';
  tip.textContent = rule.label;
  el.appendChild(tip);

  _refreshSlotEl(el, slotKey, actor);

  el.addEventListener('dragover',  ev => { ev.preventDefault(); el.classList.add('dragover'); });
  el.addEventListener('dragleave', ()  => el.classList.remove('dragover'));
  el.addEventListener('drop',      ev  => { el.classList.remove('dragover'); _onDrop(ev, actor, slotKey); });
  el.addEventListener('click',     ()  => {
    const item = rule.bgHud
      ? (_getBg3HandItem(actor, rule.bgHud) ?? _getSlotItem(actor, slotKey))
      : _getSlotItem(actor, slotKey);
    if (item) item.sheet?.render(true);
  });

  return el;
}

function _refreshSlotEl(el, slotKey, actor) {
  const rule = PAPERDOLL_SLOTS[slotKey];
  const tip  = el.querySelector('.mezz-pd-slot-tip');
  el.innerHTML = '';
  if (tip) el.appendChild(tip);

  const item = rule.bgHud
    ? (_getBg3HandItem(actor, rule.bgHud) ?? _getSlotItem(actor, slotKey))
    : _getSlotItem(actor, slotKey);

  // Hand slots: hide when empty (no item in active BG3 set)
  if (rule.bgHud && !item) {
    el.style.display = 'none';
  }

  if (item) {
    el.classList.add('mezz-pd-slot--filled');
    const img = document.createElement('img');
    img.src   = item.img;
    img.title = item.name;
    el.appendChild(img);

    const unequip = document.createElement('button');
    unequip.className = 'mezz-pd-unequip';
    unequip.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    unequip.title     = 'Remove ' + item.name;
    unequip.addEventListener('click', async ev => {
      ev.stopPropagation();
      if (rule.bgHud) await _writeBg3HudHand(actor, rule.bgHud, null);
      await _unequipItem(actor, item, slotKey);
      el.classList.remove('mezz-pd-slot--filled');
      _refreshSlotEl(el, slotKey, actor);
      const still = rule.bgHud ? _getBg3HandItem(actor, rule.bgHud) : _getSlotItem(actor, slotKey);
      if (!still) el.style.display = 'none';
    });
    el.appendChild(unequip);
    el.style.display = '';
  } else {
    el.classList.remove('mezz-pd-slot--filled');
    const icon = document.createElement('i');
    icon.className = rule.icon + ' mezz-pd-empty-icon';
    el.appendChild(icon);
  }
}

// ─── BG3 weapon set tabs ──────────────────────────────────────────────────────

function _buildWeaponSetTabs(actor, bodyWrap) {
  const wrap = document.createElement('div');
  wrap.className = 'mezz-ws-tabs-row';

  const active = _getBg3ActiveSet(actor);
  ['I','II','III'].forEach((label, i) => {
    const btn = document.createElement('button');
    btn.className   = 'mezz-ws-tab' + (i === active ? ' mezz-ws-tab--active' : '');
    btn.textContent = label;
    btn.title       = 'Weapon Set ' + label;
    btn.addEventListener('click', async () => {
      await _setBg3ActiveSet(actor, i);
      // Refresh hand slots in all open paperdolls for this actor
      for (const root of document.querySelectorAll('[data-mezz-actor="' + actor.id + '"]')) {
        _refreshAllSlots(root, actor);
      }
    });
    wrap.appendChild(btn);
  });

  return wrap;
}

// ─── Drag reveal ──────────────────────────────────────────────────────────────

function _showSlotsForDrag(bodyWrap, actor, item) {
  const validKeys = getSlotsForItem(item);
  for (const slotEl of bodyWrap.querySelectorAll('.mezz-pd-slot[data-slot]')) {
    if (!validKeys.includes(slotEl.dataset.slot)) continue;
    slotEl.style.display = '';
    slotEl.classList.add('mezz-pd-slot--drag-target');
  }
}

function _hideDragSlots(bodyWrap, actor) {
  for (const slotEl of bodyWrap.querySelectorAll('.mezz-pd-slot--drag-target')) {
    slotEl.classList.remove('mezz-pd-slot--drag-target', 'dragover');
    const slotKey = slotEl.dataset.slot;
    const rule    = PAPERDOLL_SLOTS[slotKey];
    const item    = rule?.bgHud ? _getBg3HandItem(actor, rule.bgHud) : _getSlotItem(actor, slotKey);
    if (!item) slotEl.style.display = 'none';
  }
}

function _attachDragListener(actor, bodyWrap) {
  if (bodyWrap._mezzDragBound) return;
  bodyWrap._mezzDragBound = true;

  const onDragStart = async ev => {
    await Promise.resolve(); // let dataTransfer populate
    let itemId = ev.target?.dataset?.itemId
              ?? ev.target?.closest?.('[data-item-id]')?.dataset?.itemId
              ?? ev.target?.closest?.('.item')?.dataset?.itemId;

    if (!itemId) {
      try {
        const raw = ev.dataTransfer.getData('application/json');
        if (raw) {
          const d = JSON.parse(raw);
          if (d?.uuid) itemId = d.uuid.split('.').pop();
        }
      } catch {}
    }
    if (!itemId) return;
    const item = actor.items.get(itemId);
    if (!item || item.system?.type?.value === 'natural') return;
    if (item.name?.toLowerCase() === 'unarmed strike') return;
    _showSlotsForDrag(bodyWrap, actor, item);
  };

  const onDragEnd = () => setTimeout(() => _hideDragSlots(bodyWrap, actor), 150);

  document.addEventListener('dragstart', onDragStart);
  document.addEventListener('dragend',   onDragEnd);
  bodyWrap._mezzDragCleanup = () => {
    document.removeEventListener('dragstart', onDragStart);
    document.removeEventListener('dragend',   onDragEnd);
  };
}

// ─── Dynamic container slots ──────────────────────────────────────────────────

const _CT_POS = [
  { keys:['bag of holding'],              x:80, y:12, side:'right' },
  { keys:['quiver','bolt case','arrow'],  x:22, y:30, side:'left'  },
  { keys:['backpack','pack','rucksack'],  x:80, y:30, side:'right' },
  { keys:['satchel','messenger'],         x:22, y:12, side:'left'  },
  { keys:['pouch','purse','coin'],        x:80, y:52, side:'right' },
  { keys:['scroll','tube'],              x:22, y:52, side:'left'  },
  { keys:['case','box'],                 x:80, y:68, side:'right' },
  { keys:['bag','sack'],                 x:22, y:68, side:'left'  },
];
const _CT_FALLBACK = [{x:20,y:82,side:'left'},{x:80,y:82,side:'right'}];

function _getTopLevelContainers(actor) {
  const all = actor.items.filter(i => i.type === 'container');
  const ids = new Set(all.map(c => c.id));
  // system.container may be null, undefined, or empty string when not nested
  return all.filter(c => {
    const parent = c.system?.container;
    return !parent || parent === '' || !ids.has(parent);
  });
}

function _posForContainer(name, used) {
  const lc = name.toLowerCase();
  for (const p of _CT_POS) {
    if (p.keys.some(k => lc.includes(k))) {
      const key = p.x + ',' + p.y;
      if (!used.has(key)) { used.add(key); return p; }
    }
  }
  for (const fb of _CT_FALLBACK) {
    const key = fb.x + ',' + fb.y;
    if (!used.has(key)) { used.add(key); return fb; }
  }
  return null;
}

function _buildContainerDollSlots(actor, ctCol) {
  const used = new Set();
  const els  = [];
  for (const container of _getTopLevelContainers(actor)) {
    const pos = _posForContainer(container.name, used);
    if (!pos) continue;
    const el = document.createElement('div');
    el.className = 'mezz-pd-slot mezz-pd-slot--container mezz-pd-slot--sm';
    el.dataset.containerId = container.id;
    el.title     = container.name;
    el.style.left = pos.x + '%';
    el.style.top  = pos.y + '%';
    if (pos.side === 'left')  el.classList.add('mezz-pd-slot--left');
    if (pos.side === 'right') el.classList.add('mezz-pd-slot--right');

    const tip = document.createElement('div');
    tip.className   = 'mezz-pd-slot-tip';
    tip.textContent = container.name;
    el.appendChild(tip);

    const img = document.createElement('img');
    img.src = container.img;
    el.appendChild(img);

    el.addEventListener('click', () => {
      if (!ctCol) return;
      const card = ctCol.querySelector('.mezz-ct-card[data-container-id="' + container.id + '"]');
      if (!card) return;
      card.scrollIntoView({ behavior:'smooth', block:'nearest' });
      const body = card.querySelector('.mezz-ct-card-body');
      const chev = card.querySelector('.mezz-ct-chevron');
      if (body && !body.classList.contains('mezz-ct-card-body--open')) {
        body.classList.add('mezz-ct-card-body--open');
        chev?.classList.add('mezz-ct-chevron--open');
      }
      card.classList.add('mezz-ct-card--highlight');
      setTimeout(() => card.classList.remove('mezz-ct-card--highlight'), 1200);
    });
    els.push(el);
  }
  return els;
}

// ─── Build body wrap ──────────────────────────────────────────────────────────

function _buildBodyWrap(actor, ctCol) {
  const wrap = document.createElement('div');
  wrap.className = 'mezz-pd-body-wrap';
  wrap.dataset.mezzActor = actor.id;

  const bodyImg = document.createElement('img');
  bodyImg.className = 'mezz-pd-body';
  bodyImg.src       = _getPaperdollImage(actor);
  wrap.appendChild(bodyImg);

  // Equipment slots (all hidden initially)
  for (const slotKey of Object.keys(PAPERDOLL_SLOTS)) {
    wrap.appendChild(_buildSlotEl(slotKey, actor));
  }

  // Dynamic container slots (always visible)
  for (const el of _buildContainerDollSlots(actor, ctCol)) {
    wrap.appendChild(el);
  }

  // Photo button
  const photoBtn = document.createElement('button');
  photoBtn.className = 'mezz-pd-photo-btn';
  photoBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Photo';
  photoBtn.addEventListener('click', () => {
    new FilePicker({
      type: 'image', current: _getPaperdollImage(actor),
      callback: async path => { await _setPaperdollImage(actor, path); bodyImg.src = path; }
    }).render(true);
  });
  wrap.appendChild(photoBtn);

  _attachDragListener(actor, wrap);
  return wrap;
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

function _refreshAllSlots(root, actor) {
  for (const slotEl of root.querySelectorAll('.mezz-pd-slot[data-slot]')) {
    _refreshSlotEl(slotEl, slotEl.dataset.slot, actor);
  }
  const bodyImg = root.querySelector('.mezz-pd-body');
  if (bodyImg) bodyImg.src = _getPaperdollImage(actor);
  refreshContainerPanel(root, actor);
  // Refresh weapon set tab highlights
  const active = _getBg3ActiveSet(actor);
  root.querySelectorAll('.mezz-ws-tab').forEach((btn, i) => {
    btn.classList.toggle('mezz-ws-tab--active', i === active);
  });
}

// ─── Raw DOM popup ────────────────────────────────────────────────────────────

const _popups   = new Map();
let   _popupZ   = 10000; // start high to stay above Foundry UI

function _bringToTop(win) {
  win.style.zIndex = String(++_popupZ);
}

function _buildRawPopup(actor, anchorEl) {
  const WIN_W = 700, WIN_H = 580;
  const win = document.createElement('div');
  win.id        = 'mezz-paperdoll-win-' + actor.id;
  win.className = 'mezz-pd-win';
  win.style.width   = WIN_W + 'px';
  win.style.height  = WIN_H + 'px';
  win.style.zIndex  = String(++_popupZ);
  // Click anywhere on win to bring to front
  win.addEventListener('mousedown', () => _bringToTop(win));

  const rect = anchorEl?.closest('.app')?.getBoundingClientRect?.();
  const left = rect ? Math.min(rect.right + 8, window.innerWidth - WIN_W - 8)
                    : Math.round((window.innerWidth  - WIN_W) / 2);
  const top  = rect ? Math.max(8, rect.top)
                    : Math.round((window.innerHeight - WIN_H) / 2);
  win.style.left = Math.max(4, left) + 'px';
  win.style.top  = Math.max(4, top)  + 'px';

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.className = 'mezz-pd-win-title';
  const titleSpan = document.createElement('span');
  titleSpan.textContent = actor.name + ' — Paperdoll';
  titleBar.appendChild(titleSpan);
  const closeBtn = document.createElement('button');
  closeBtn.className   = 'mezz-pd-win-close';
  closeBtn.textContent = '✕ Close';
  closeBtn.addEventListener('click', () => _closePopup(actor.id));
  titleBar.appendChild(closeBtn);
  win.appendChild(titleBar);

  // Body
  const body = document.createElement('div');
  body.className = 'mezz-pd-win-body';

  const ctCol = document.createElement('div');
  ctCol.className = 'mezz-pd-ct-col';
  ctCol.appendChild(buildContainerPanel(actor));

  const dollCol = document.createElement('div');
  dollCol.className = 'mezz-pd-doll-col';
  dollCol.dataset.mezzActor = actor.id;

  const bodyWrap = _buildBodyWrap(actor, ctCol);
  dollCol.appendChild(bodyWrap);

  // Weapon set tabs below doll
  dollCol.appendChild(_buildWeaponSetTabs(actor, bodyWrap));

  body.appendChild(dollCol);
  body.appendChild(ctCol);
  win.appendChild(body);

  _makeDraggable(win, titleBar);
  document.body.appendChild(win);
  win._mezzCleanup = () => bodyWrap._mezzDragCleanup?.();
  return win;
}

function _makeDraggable(win, handle) {
  let ox = 0, oy = 0;
  handle.addEventListener('mousedown', ev => {
    if (ev.target.closest('button')) return;
    ev.preventDefault();
    _bringToTop(win);
    ox = ev.clientX - win.offsetLeft;
    oy = ev.clientY - win.offsetTop;
    const onMove = e => {
      win.style.left = Math.max(0, Math.min(window.innerWidth  - 80, e.clientX - ox)) + 'px';
      win.style.top  = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - oy)) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

function _closePopup(actorId) {
  const win = document.getElementById('mezz-paperdoll-win-' + actorId);
  win?._mezzCleanup?.();
  win?.remove();
  _popups.delete(actorId);
}

function _openPopup(actor, anchorEl) {
  const existing = document.getElementById('mezz-paperdoll-win-' + actor.id);
  if (existing) { _bringToTop(existing); return; }
  const win = _buildRawPopup(actor, anchorEl);
  _popups.set(actor.id, win);
}

// ─── In-sheet tab ─────────────────────────────────────────────────────────────

function _buildSheetPanel(actor) {
  const section = document.createElement('section');
  section.className               = 'tab mezz-pd-tab';
  section.dataset.tab             = 'paperdoll';
  section.dataset.group           = 'primary';
  section.dataset.applicationPart = 'paperdoll';
  section.style.display           = 'none';
  section.dataset.mezzActor       = actor.id;

  const ctCol = document.createElement('div');
  ctCol.className = 'mezz-pd-ct-col';
  ctCol.appendChild(buildContainerPanel(actor));

  const dollCol = document.createElement('div');
  dollCol.className = 'mezz-pd-doll-col';
  dollCol.dataset.mezzActor = actor.id;
  const bodyWrap = _buildBodyWrap(actor, ctCol);
  dollCol.appendChild(bodyWrap);
  dollCol.appendChild(_buildWeaponSetTabs(actor, bodyWrap));

  const row = document.createElement('div');
  row.className = 'mezz-pd-split-row';
  row.appendChild(dollCol);
  row.appendChild(ctCol);
  section.appendChild(row);
  return section;
}

// ─── Sheet injection ──────────────────────────────────────────────────────────

function injectPaperdoll(sheet, element) {
  const actor = sheet.actor;
  if (!actor || actor.type !== 'character') return;

  if (!element.querySelector('a[data-tab="paperdoll"]')) {
    const refBtn = element.querySelector('a.item.control[data-tab]');
    const nav    = refBtn?.closest('nav, .tab-list, .tabs') ?? refBtn?.parentElement;
    if (nav) {
      const btn = document.createElement('a');
      btn.className       = 'item control';
      btn.dataset.action  = 'tab';
      btn.dataset.group   = 'primary';
      btn.dataset.tab     = 'paperdoll';
      btn.dataset.tooltip = '';
      btn.setAttribute('aria-label', 'Paperdoll');
      btn.innerHTML       = '<i class="fa-solid fa-person"></i>';
      nav.appendChild(btn);
    }
  }

  const existing = element.querySelector('section[data-tab="paperdoll"]');
  if (existing) {
    _refreshAllSlots(existing, actor);
  } else {
    const refPanel = element.querySelector('section.tab[data-group="primary"]');
    if (refPanel) refPanel.parentElement.appendChild(_buildSheetPanel(actor));
  }

  const invBtn = element.querySelector('a[data-tab="inventory"]');
  if (invBtn && !invBtn._mezzPaperdollBound) {
    invBtn._mezzPaperdollBound = true;
    invBtn.addEventListener('click', () => _openPopup(actor, invBtn));
  }

  if (!element._mezzObserver) {
    element._mezzObserver = new MutationObserver(() => {
      if (!document.body.contains(element)) {
        _closePopup(actor.id);
        element._mezzObserver.disconnect();
      }
    });
    element._mezzObserver.observe(document.body, { childList: true, subtree: false });
  }
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

Hooks.on('renderActorSheetV2', (sheet, element) => injectPaperdoll(sheet, element));
Hooks.on('renderActorSheet',   (sheet, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (root) injectPaperdoll(sheet, root);
});

Hooks.on('updateActor', (actor) => {
  const win = document.getElementById('mezz-paperdoll-win-' + actor.id);
  if (win) _refreshAllSlots(win, actor);
});

Hooks.on('updateItem', (item) => {
  if (!item.actor) return;
  const win = document.getElementById('mezz-paperdoll-win-' + item.actor.id);
  if (win) _refreshAllSlots(win, item.actor);
});
