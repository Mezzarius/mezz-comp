/**
 * paperdoll-containers.mjs
 * Renders a container panel (backpack, quiver, sack, etc.) alongside the
 * paperdoll, with drag-and-drop between containers and encumbrance tracking.
 */

const MODULE_ID = 'mezz-comp';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Round to 1 decimal, strip trailing .0 */
function _fmt(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Get all container items on the actor (type === 'container' in dnd5e) */
function _getAllContainers(actor) {
  return actor.items.filter(i => i.type === 'container');
}

/** Only top-level containers — not nested inside another container */
function _getContainers(actor) {
  const allContainerIds = new Set(_getAllContainers(actor).map(c => c.id));
  return _getAllContainers(actor).filter(c => {
    const parent = c.system?.container;
    return !parent || parent === '' || !allContainerIds.has(parent);
  });
}

/** Get items directly inside a container (non-container items only) */
function _getContainerContents(actor, containerId) {
  return actor.items.filter(i =>
    i.system?.container === containerId &&
    i.type !== 'container' &&
    _isListableItem(i)
  );
}

/** Get child containers nested directly inside a container */
function _getChildContainers(actor, containerId) {
  return actor.items.filter(i =>
    i.type === 'container' &&
    i.system?.container === containerId
  );
}

/**
 * Items that should never appear in the container panel:
 *  - Non-physical types (spell, feat, class, subclass, background, race)
 *  - Natural weapons (Unarmed Strike, claws, etc.)
 *  - Items currently slotted in the paperdoll
 *  - Container items themselves (they get their own card header)
 */
const _HIDDEN_TYPES = new Set([
  'spell', 'feat', 'class', 'subclass', 'background', 'race', 'container',
]);

function _isNaturalWeapon(item) {
  if (item.type !== 'weapon') return false;
  const subtype = item.system?.type?.value;
  if (subtype === 'natural' || subtype === 'mpak' || subtype === 'msak' || subtype === 'rsak') return true;
  // Catch Unarmed Strike by name (dnd5e adds it as simpleM in some versions)
  const name = item.name?.toLowerCase() ?? '';
  if (name === 'unarmed strike' || name.startsWith('unarmed')) return true;
  return false;
}

function _getPaperdollSlottedIds(actor) {
  // New flag structure: flags.mezz-comp.slots
  const newSlots = actor.flags?.[MODULE_ID]?.slots ?? {};
  const ids = new Set(Object.values(newSlots).filter(Boolean));

  // Also catch anything equipped in dnd5e that's in a paperdoll slot
  // (belt, shoulder, etc. — anything with system.equipped = true)
  for (const item of actor.items) {
    if (item.system?.equipped) ids.add(item.id);
  }

  return ids;
}

function _isListableItem(item) {
  if (_HIDDEN_TYPES.has(item.type)) return false;
  if (_isNaturalWeapon(item)) return false;
  return true;
}

/** Get items with no container (top-level inventory, not slotted in paperdoll) */
function _getLooseItems(actor) {
  const containerIds  = new Set(_getContainers(actor).map(c => c.id));
  const slottedIds    = _getPaperdollSlottedIds(actor);
  return actor.items.filter(i => {
    if (!_isListableItem(i)) return false;
    if (slottedIds.has(i.id)) return false;
    const inContainer = i.system?.container && containerIds.has(i.system.container);
    return !inContainer;
  });
}

/** Get encumbrance data from actor */
function _getEncumbrance(actor) {
  const enc = actor.system?.attributes?.encumbrance;
  if (!enc) return null;
  return {
    value: enc.value ?? 0,
    max:   enc.max ?? 150,
    pct:   Math.min(100, Math.round(((enc.value ?? 0) / (enc.max ?? 150)) * 100)),
    heavy: enc.heavilyEncumbered ?? false,
    over:  enc.exceeded ?? false,
  };
}

/** Item weight display */
function _itemWeight(item) {
  const qty = item.system?.quantity ?? 1;
  const w   = item.system?.weight?.value ?? item.system?.weight ?? 0;
  const total = w * qty;
  return _fmt(total) + ' lb';
}

/** Item type tag label */
function _typeTag(item) {
  const typeMap = {
    weapon: 'Weapon', armor: 'Armor', equipment: 'Equipment',
    consumable: 'Consumable', tool: 'Tool', loot: 'Loot',
    container: 'Container', backpack: 'Container',
  };
  const sub = item.system?.type?.value;
  if (sub === 'ammo') return 'Ammo';
  if (sub === 'shield') return 'Shield';
  if (sub === 'potion') return 'Potion';
  if (sub === 'scroll') return 'Scroll';
  return typeMap[item.type] ?? item.type;
}

function _tagClass(item) {
  const sub = item.system?.type?.value;
  if (sub === 'ammo') return 'mezz-ct-tag--ammo';
  if (sub === 'potion' || sub === 'scroll') return 'mezz-ct-tag--magic';
  const map = {
    weapon: 'mezz-ct-tag--weapon', armor: 'mezz-ct-tag--armor',
    equipment: 'mezz-ct-tag--armor', consumable: 'mezz-ct-tag--consumable',
    loot: 'mezz-ct-tag--misc', tool: 'mezz-ct-tag--misc',
    container: 'mezz-ct-tag--misc',
  };
  return map[item.type] ?? 'mezz-ct-tag--misc';
}

/** Icon for known container types */
function _containerIcon(item) {
  const name = item.name.toLowerCase();
  if (name.includes('quiver'))  return 'fa-solid fa-bow-arrow';
  if (name.includes('pouch') || name.includes('purse') || name.includes('coin')) return 'fa-solid fa-sack';
  if (name.includes('sack'))    return 'fa-solid fa-sack';
  if (name.includes('scroll'))  return 'fa-solid fa-scroll';
  if (name.includes('flask') || name.includes('bottle')) return 'fa-solid fa-flask';
  if (name.includes('chest') || name.includes('trunk')) return 'fa-solid fa-chest';
  return 'fa-solid fa-backpack';
}

// ─── Build encumbrance bar ─────────────────────────────────────────────────────

function _buildEncBar(actor) {
  const wrap = document.createElement('div');
  wrap.className = 'mezz-ct-encbar';
  wrap.dataset.mezzEnc = '1';

  const enc = _getEncumbrance(actor);
  if (!enc) return wrap;

  const fillClass = enc.over ? 'mezz-ct-encfill--over' : enc.heavy ? 'mezz-ct-encfill--warn' : '';

  wrap.innerHTML = `
    <div class="mezz-ct-enc-labels">
      <span>Carry weight</span>
      <span class="mezz-ct-enc-nums">${_fmt(enc.value)} / ${_fmt(enc.max)} lb</span>
    </div>
    <div class="mezz-ct-enc-track">
      <div class="mezz-ct-enc-fill ${fillClass}" style="width:${enc.pct}%"></div>
    </div>`;
  return wrap;
}

// ─── Build item row ────────────────────────────────────────────────────────────

function _buildItemRow(item, actor, containerId) {
  const row = document.createElement('div');
  row.className = 'mezz-ct-item-row';
  row.dataset.itemId     = item.id;
  row.dataset.fromContainer = containerId ?? '__loose__';
  row.draggable = true;

  const qty = item.system?.quantity ?? 1;

  row.innerHTML = `
    <img class="mezz-ct-item-img" src="${item.img}" title="${item.name}">
    <span class="mezz-ct-item-qty">${qty > 1 ? '×' + qty : ''}</span>
    <span class="mezz-ct-item-name">${item.name}</span>
    <span class="mezz-ct-tag ${_tagClass(item)}">${_typeTag(item)}</span>
    <span class="mezz-ct-item-wt">${_itemWeight(item)}</span>`;

  // Open item sheet on click
  row.addEventListener('click', () => item.sheet?.render(true));

  // Drag start — emit item uuid so paperdoll slots can also accept
  row.addEventListener('dragstart', ev => {
    ev.dataTransfer.setData('application/json', JSON.stringify({
      uuid: item.uuid,
      itemId: item.id,
      fromContainer: containerId ?? '__loose__',
    }));
    ev.dataTransfer.effectAllowed = 'move';
    row.classList.add('mezz-ct-dragging');
  });

  row.addEventListener('dragend', () => row.classList.remove('mezz-ct-dragging'));

  return row;
}

// ─── Build container card ──────────────────────────────────────────────────────

function _buildContainerCard(container, actor, startOpen, depth) {
  depth = depth ?? 0;
  const slottedIds  = _getPaperdollSlottedIds(actor);
  const contents    = _getContainerContents(actor, container.id).filter(i => !slottedIds.has(i.id));
  const children    = _getChildContainers(actor, container.id);
  const totalItems  = contents.length + children.reduce((s, c) => s + _getContainerContents(actor, c.id).length, 0);
  const totalWt     = contents.reduce((s, i) => s + ((i.system?.weight?.value ?? i.system?.weight ?? 0) * (i.system?.quantity ?? 1)), 0);
  const cap         = container.system?.capacity?.weight?.value;
  const capStr      = cap != null ? `${_fmt(totalWt)} / ${_fmt(cap)} lb` : `${_fmt(totalWt)} lb`;
  const icon        = _containerIcon(container);
  const isOpen      = startOpen ?? true;

  const card = document.createElement('div');
  card.className = 'mezz-ct-card' + (depth > 0 ? ' mezz-ct-card--nested' : '');
  card.dataset.containerId = container.id;
  if (depth > 0) card.style.marginLeft = (depth * 10) + 'px';

  const header = document.createElement('div');
  header.className = 'mezz-ct-card-header';
  header.innerHTML = `
    <i class="${icon} mezz-ct-container-icon"></i>
    <span class="mezz-ct-container-name">${container.name}</span>
    <span class="mezz-ct-container-meta">${capStr} · ${totalItems} item${totalItems !== 1 ? 's' : ''}</span>
    <i class="fa-solid fa-chevron-right mezz-ct-chevron ${isOpen ? 'mezz-ct-chevron--open' : ''}"></i>`;

  const body = document.createElement('div');
  body.className = 'mezz-ct-card-body' + (isOpen ? ' mezz-ct-card-body--open' : '');

  // Nested child containers first
  for (const child of children) {
    body.appendChild(_buildContainerCard(child, actor, true, depth + 1));
  }

  // Then items
  for (const item of contents) {
    body.appendChild(_buildItemRow(item, actor, container.id));
  }

  const addRow = document.createElement('div');
  addRow.className = 'mezz-ct-add-row';
  addRow.textContent = 'Drop items here';
  addRow.dataset.containerId = container.id;
  body.appendChild(addRow);

  header.addEventListener('click', () => {
    const open = body.classList.toggle('mezz-ct-card-body--open');
    header.querySelector('.mezz-ct-chevron').classList.toggle('mezz-ct-chevron--open', open);
  });

  _makeDrop(body, actor, container.id);
  _makeDrop(addRow, actor, container.id);

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

// ─── Build loose items section ─────────────────────────────────────────────────

function _buildLooseCard(actor) {
  const loose = _getLooseItems(actor);
  const card  = document.createElement('div');
  card.className = 'mezz-ct-card mezz-ct-card--loose';
  card.dataset.containerId = '__loose__';

  const header = document.createElement('div');
  header.className = 'mezz-ct-card-header';
  header.innerHTML = `
    <i class="fa-solid fa-layer-group mezz-ct-container-icon"></i>
    <span class="mezz-ct-container-name">Loose / uncontained</span>
    <span class="mezz-ct-container-meta">${loose.length} item${loose.length !== 1 ? 's' : ''}</span>
    <i class="fa-solid fa-chevron-right mezz-ct-chevron mezz-ct-chevron--open"></i>`;

  const body = document.createElement('div');
  body.className = 'mezz-ct-card-body mezz-ct-card-body--open';

  for (const item of loose) {
    body.appendChild(_buildItemRow(item, actor, null));
  }

  const addRow = document.createElement('div');
  addRow.className = 'mezz-ct-add-row';
  addRow.textContent = 'Drop items here to uncontain';
  addRow.dataset.containerId = '__loose__';
  body.appendChild(addRow);

  header.addEventListener('click', () => {
    const open = body.classList.toggle('mezz-ct-card-body--open');
    header.querySelector('.mezz-ct-chevron').classList.toggle('mezz-ct-chevron--open', open);
  });

  _makeDrop(body, actor, null);
  _makeDrop(addRow, actor, null);

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

// ─── Drop handler ──────────────────────────────────────────────────────────────

function _makeDrop(el, actor, targetContainerId) {
  el.addEventListener('dragover', ev => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    el.classList.add('mezz-ct-drop-hover');
  });

  el.addEventListener('dragleave', () => el.classList.remove('mezz-ct-drop-hover'));

  el.addEventListener('drop', async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    el.classList.remove('mezz-ct-drop-hover');

    let raw;
    try {
      raw = JSON.parse(ev.dataTransfer.getData('application/json') || ev.dataTransfer.getData('text/plain'));
    } catch { return; }

    const itemId = raw?.itemId;
    if (!itemId) return;

    const item = actor.items.get(itemId);
    if (!item) return;

    // Containers cannot go inside other containers
    if (item.type === 'container') {
      ui.notifications.warn('Containers cannot be placed inside other containers.');
      return;
    }

    const fromContainer = raw.fromContainer;
    const toContainer   = targetContainerId;

    // No-op if same location
    if (fromContainer === toContainer ||
       (fromContainer === '__loose__' && toContainer === null) ||
       (fromContainer === null && toContainer === '__loose__')) return;

    // Move item to new container (or remove from container if loose)
    const update = { 'system.container': toContainer ?? null };
    await item.update(update);

    ui.notifications.info(
      toContainer
        ? `${item.name} moved into ${actor.items.get(toContainer)?.name ?? 'container'}.`
        : `${item.name} removed from container.`
    );
  });
}

// ─── Build full container panel ────────────────────────────────────────────────

export function buildContainerPanel(actor) {
  const panel = document.createElement('div');
  panel.className = 'mezz-ct-panel';
  panel.dataset.mezzContainerPanel = actor.id;

  // Encumbrance bar
  panel.appendChild(_buildEncBar(actor));

  // Container cards
  const containers = _getContainers(actor);
  for (const c of containers) {
    panel.appendChild(_buildContainerCard(c, actor, true));
  }

  // Loose items
  panel.appendChild(_buildLooseCard(actor));

  return panel;
}

// ─── Refresh a rendered panel in-place ────────────────────────────────────────

export function refreshContainerPanel(root, actor) {
  const panel = root.querySelector(`[data-mezz-container-panel="${actor.id}"]`);
  if (!panel) return;

  // Rebuild enc bar
  const oldEnc = panel.querySelector('[data-mezz-enc]');
  const newEnc = _buildEncBar(actor);
  if (oldEnc) oldEnc.replaceWith(newEnc);
  else panel.prepend(newEnc);

  // Remember which containers are open
  const openState = {};
  for (const card of panel.querySelectorAll('.mezz-ct-card[data-container-id]')) {
    const id   = card.dataset.containerId;
    const body = card.querySelector('.mezz-ct-card-body');
    openState[id] = body?.classList.contains('mezz-ct-card-body--open') ?? true;
  }

  // Remove old cards
  for (const old of panel.querySelectorAll('.mezz-ct-card')) old.remove();

  // Rebuild
  const containers = _getContainers(actor);
  for (const c of containers) {
    panel.appendChild(_buildContainerCard(c, actor, openState[c.id] ?? true));
  }
  panel.appendChild(_buildLooseCard(actor));
}
