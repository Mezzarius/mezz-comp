/**
 * paperdoll-hands.mjs
 * BG3-style weapon set cycler: 3 sets (I, II, III), each with main + off hand.
 * Active set is highlighted. Click set number to activate. Click slot to pick item.
 * Also enforces spellcasting focus requirement.
 */

const MODULE_ID = 'mezz-comp';

const FOCUS_SUBTYPES = new Set([
  'focusDruidic','focusArcane','focusHoly','focusDivine',
  'focusWand','focus','wand','rod','staff','orb','crystal',
]);
const FOCUS_NAME_KW = ['arcane focus','holy symbol','druidic focus','wand','staff','orb','crystal','rod','component pouch'];

function _isFocus(item) {
  if (!item) return false;
  if (item.system?.properties?.has?.('foc')) return true;
  if (FOCUS_SUBTYPES.has(item.system?.type?.value ?? '')) return true;
  const name = item.name.toLowerCase();
  return FOCUS_NAME_KW.some(k => name.includes(k));
}

// ─── Flag helpers ─────────────────────────────────────────────────────────────

function _getHandsFlags(actor) {
  const base = foundry.utils.deepClone(actor.flags?.[MODULE_ID]?.weaponSets ?? {
    active: 0,
    sets: [
      { main: null, off: null },
      { main: null, off: null },
      { main: null, off: null },
    ]
  });
  // Sync active set from bg3-hud-core if available
  const bg3Active = actor.flags?.['bg3-hud-core']?.hudState?.weaponSets?.activeSet;
  if (bg3Active != null) base.active = bg3Active;
  return base;
}

// Read item from bg3-hud-core for a given set index and hand
function _getBg3SetItem(actor, setIndex, hand) {
  const sets = actor.flags?.['bg3-hud-core']?.hudState?.weaponSets?.sets;
  if (!sets?.[setIndex]?.items) return null;
  const slotKey = hand === 'main' ? setIndex + '-0' : setIndex + '-1';
  const entry   = sets[setIndex].items[slotKey];
  if (!entry) return null;
  const uuid   = typeof entry === 'string' ? entry : (entry.uuid ?? entry.id);
  if (!uuid) return null;
  const parts  = uuid.split('.');
  const itemId = parts[parts.length - 1];
  return actor.items.get(itemId) ?? null;
}

async function _saveHandsFlags(actor, data) {
  await actor.setFlag(MODULE_ID, 'weaponSets', data);
}

// ─── Candidates ───────────────────────────────────────────────────────────────

const HAND_EXCLUDE = new Set(['spell','feat','class','subclass','background','race','container']);

function _handCandidates(actor) {
  return actor.items.filter(i => {
    if (HAND_EXCLUDE.has(i.type)) return false;
    const sub  = i.system?.type?.value ?? '';
    if (sub === 'natural') return false;
    const name = i.name.toLowerCase();
    if (name === 'unarmed strike' || name.startsWith('unarmed')) return false;
    return true;
  }).sort((a,b) => a.name.localeCompare(b.name));
}

// ─── Build weapon set panel ───────────────────────────────────────────────────

export function buildHandPanel(actor) {
  const data       = _getHandsFlags(actor);
  const candidates = _handCandidates(actor);

  const panel = document.createElement('div');
  panel.className = 'mezz-ws-panel';

  // ── Set tabs (I, II, III) ──
  const tabs = document.createElement('div');
  tabs.className = 'mezz-ws-tabs';

  const NUMERALS = ['I', 'II', 'III'];

  for (let s = 0; s < 3; s++) {
    const tab = document.createElement('button');
    tab.className   = 'mezz-ws-tab' + (s === data.active ? ' mezz-ws-tab--active' : '');
    tab.textContent = NUMERALS[s];
    tab.dataset.set = s;
    tab.addEventListener('click', async () => {
      const d = _getHandsFlags(actor);
      d.active = s;
      await _saveHandsFlags(actor, d);
      refreshHandPanels(panel.closest('.mezz-pd-doll-col') ?? panel.parentElement, actor);
    });
    tabs.appendChild(tab);
  }
  panel.appendChild(tabs);

  // ── Active set slots ──
  const activeSet  = data.sets[data.active] ?? { main: null, off: null };
  const slots = document.createElement('div');
  slots.className = 'mezz-ws-slots';

  slots.appendChild(_buildWeaponSlot(actor, data, candidates, 'main', 'Main Hand'));
  slots.appendChild(_buildWeaponSlot(actor, data, candidates, 'off',  'Off Hand'));

  panel.appendChild(slots);
  return panel;
}

function _buildWeaponSlot(actor, data, candidates, hand, label) {
  const activeSet = data.sets[data.active] ?? {};
  const itemId    = activeSet[hand] ?? null;
  // Prefer bg3-hud-core item if available, fall back to our own flags
  const item      = _getBg3SetItem(actor, data.active, hand) 
                 ?? (itemId ? actor.items.get(itemId) : null);

  const wrap = document.createElement('div');
  wrap.className = 'mezz-ws-slot-wrap';

  // Slot box — click to open picker
  const slot = document.createElement('div');
  slot.className = 'mezz-ws-slot' + (item ? ' mezz-ws-slot--filled' : '');
  slot.title     = label;

  if (item) {
    const img = document.createElement('img');
    img.src   = item.img;
    img.title = item.name;
    slot.appendChild(img);
  } else {
    const icon = document.createElement('i');
    icon.className = hand === 'main'
      ? 'fa-solid fa-hand-fist mezz-ws-empty-icon'
      : 'fa-solid fa-shield-halved mezz-ws-empty-icon';
    slot.appendChild(icon);
  }

  // Clear button
  if (item) {
    const clr = document.createElement('button');
    clr.className = 'mezz-ws-clear';
    clr.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    clr.title     = 'Clear slot';
    clr.addEventListener('click', async ev => {
      ev.stopPropagation();
      const d = _getHandsFlags(actor);
      d.sets[d.active][hand] = null;
      await _saveHandsFlags(actor, d);
      refreshHandPanels(wrap.closest('.mezz-pd-doll-col') ?? wrap.parentElement, actor);
    });
    slot.appendChild(clr);
  }

  // Click slot → show inline picker
  slot.addEventListener('click', () => _showPicker(actor, data, candidates, hand, wrap));

  wrap.appendChild(slot);

  // Label
  const lbl = document.createElement('div');
  lbl.className   = 'mezz-ws-slot-label';
  lbl.textContent = item ? _truncate(item.name, 14) : label;
  wrap.appendChild(lbl);

  return wrap;
}

function _truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function _showPicker(actor, data, candidates, hand, anchor) {
  // Remove any existing picker
  document.querySelectorAll('.mezz-ws-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'mezz-ws-picker';

  const search = document.createElement('input');
  search.type        = 'text';
  search.placeholder = 'Search…';
  search.className   = 'mezz-ws-search';
  picker.appendChild(search);

  const list = document.createElement('div');
  list.className = 'mezz-ws-list';

  const none = document.createElement('div');
  none.className   = 'mezz-ws-option';
  none.textContent = '— empty —';
  none.addEventListener('click', async () => {
    const d = _getHandsFlags(actor);
    d.sets[d.active][hand] = null;
    await _saveHandsFlags(actor, d);
    picker.remove();
    refreshHandPanels(anchor.closest('.mezz-pd-doll-col') ?? anchor.parentElement, actor);
  });
  list.appendChild(none);

  function renderList(filter) {
    list.querySelectorAll('.mezz-ws-option:not(:first-child)').forEach(e => e.remove());
    const filtered = filter
      ? candidates.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()))
      : candidates;
    for (const item of filtered) {
      const row = document.createElement('div');
      row.className = 'mezz-ws-option';

      const img = document.createElement('img');
      img.src   = item.img;
      img.className = 'mezz-ws-opt-img';
      row.appendChild(img);

      const name = document.createElement('span');
      name.textContent = item.name;
      row.appendChild(name);

      row.addEventListener('click', async () => {
        const d = _getHandsFlags(actor);
        d.sets[d.active][hand] = item.id;
        await _saveHandsFlags(actor, d);
        picker.remove();
        refreshHandPanels(anchor.closest('.mezz-pd-doll-col') ?? anchor.parentElement, actor);
      });
      list.appendChild(row);
    }
  }

  renderList('');
  search.addEventListener('input', () => renderList(search.value));
  picker.appendChild(list);

  // Position picker above/below anchor
  anchor.style.position = 'relative';
  anchor.appendChild(picker);
  search.focus();

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!picker.contains(e.target) && !anchor.contains(e.target)) {
        picker.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 0);
}

// ─── Focus check ──────────────────────────────────────────────────────────────

export function hasFocusInHand(actor) {
  const data = _getHandsFlags(actor);
  const set  = data.sets[data.active] ?? {};
  const main = set.main ? actor.items.get(set.main) : null;
  const off  = set.off  ? actor.items.get(set.off)  : null;
  return _isFocus(main) || _isFocus(off);
}

Hooks.on('dnd5e.preUseItem', (item, config, options) => {
  if (item.type !== 'spell') return true;
  const actor = item.actor;
  if (!actor) return true;
  const data = actor.flags?.[MODULE_ID]?.weaponSets;
  if (!data) return true;
  const set = data.sets?.[data.active ?? 0];
  if (!set?.main && !set?.off) return true; // hands not configured, don't enforce
  if (!hasFocusInHand(actor)) {
    ui.notifications.warn(`${actor.name} needs a spellcasting focus in hand to cast ${item.name}.`);
    return false;
  }
  return true;
});

// ─── Refresh ──────────────────────────────────────────────────────────────────

export function refreshHandPanels(root, actor) {
  const existing = root.querySelector('.mezz-ws-panel');
  if (!existing) return;
  const fresh = buildHandPanel(actor);
  existing.replaceWith(fresh);
}
