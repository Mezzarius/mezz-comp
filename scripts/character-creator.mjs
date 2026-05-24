import { log } from "./utils.mjs";

const STEPS = ["name", "abilities", "race", "background", "class", "equipment", "confirm"];

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_MAX = 27;
const POINT_BUY_COSTS = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_LABELS = {
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma"
};

function mergedCurrency(a, b) {
  const out = { ...a };
  for (const [den, amt] of Object.entries(b)) out[den] = (out[den] ?? 0) + amt;
  return out;
}

export class MezzCharacterCreator extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "mezz-character-creator",
    tag: "div",
    window: { title: "Character Creator", resizable: true },
    position: { width: 720, height: 620 },
    classes: ["mezz-creator"],
  };

  static PARTS = { main: { template: "modules/mezz-comp/templates/character-creator.hbs" } };

  // ── State ──────────────────────────────────────────────────────────
  #step = 0;
  #data = {
    name: "",
    race: null,
    cls: null,
    background: null,
    abilityMethod: null,
    abilities: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
    rolledScores: [],
    allRolls: [],
    selectedRollIdx: 0,
    rollCount: 0,
    assignments: {},
    equipmentGrants: [],
    equipmentChoices: [],
    equipmentCurrency: {},
    _equipmentLoaded: false,
  };
  #compendiumCache = {};

  get step() { return STEPS[this.#step]; }

  // ── Compendium helpers ─────────────────────────────────────────────
  async #getPack(suffix) {
    const key = `mezz-comp.${suffix}`;
    if (this.#compendiumCache[key]) return this.#compendiumCache[key];
    const pack = game.packs.get(key);
    if (!pack) {
      ui.notifications.error(`mezz-comp.${suffix} compendium not found.`);
      return [];
    }
    const index = await pack.getIndex({ fields: ["type", "name", "img"] });
    const items = [...index].map(e => ({ ...e, packId: key }));
    this.#compendiumCache[key] = items;
    return items;
  }

  async #getPackByType(suffix, filterType) {
    const items = await this.#getPack(suffix);
    return filterType ? items.filter(i => i.type === filterType) : items;
  }

  async #getRaces()       { return this.#getPackByType("races", "race"); }
  async #getClasses()     { return this.#getPackByType("classes", "class"); }
  async #getBackgrounds() { return this.#getPackByType("backgrounds", "background"); }

  async #getDoc(packId, itemId) {
    const pack = game.packs.get(packId);
    return pack?.getDocument(itemId);
  }

  // ── Point buy helpers ──────────────────────────────────────────────
  #pointsSpent() {
    return ABILITY_KEYS.reduce((t, k) => t + (POINT_BUY_COSTS[this.#data.abilities[k]] ?? 0), 0);
  }
  #pointsLeft() { return POINT_BUY_MAX - this.#pointsSpent(); }

  // ── Roll 4d6 drop lowest ───────────────────────────────────────────
  #rollScores() {
    const roll = () => {
      const dice = Array.from({ length: 4 }, () => Math.ceil(Math.random() * 6));
      dice.sort((a, b) => a - b);
      return dice.slice(1).reduce((a, b) => a + b, 0);
    };
    const set = Array.from({ length: 6 }, roll).sort((a, b) => b - a);
    this.#data.rollCount = (this.#data.rollCount || 0) + 1;
    this.#data.allRolls.push(set);
    this.#data.selectedRollIdx = this.#data.allRolls.length - 1;
    this.#data.rolledScores = set;
    this.#data.assignments = {};
    this.#data.abilities = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  }

  #selectRoll(idx) {
    this.#data.selectedRollIdx = idx;
    this.#data.rolledScores = this.#data.allRolls[idx];
    this.#data.assignments = {};
    this.#data.abilities = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  }

  // ── Equipment from class ───────────────────────────────────────────
  // ── Container contents (system.contents is a Promise in dnd5e v4) ──
  async #getContainerContents(containerDoc) {
    if (!containerDoc) return [];
    try {
      let contents = containerDoc.system?.contents;
      // dnd5e v4 system.contents is a Promise
      if (contents != null && (contents instanceof Promise || contents?.constructor?.name === "Promise")) {
        contents = await contents;
      }
      if (!contents) return [];
      // Iterate — may be a Set, Collection, or array
      const out = [];
      for (const item of contents) {
        out.push(typeof item?.toObject === "function" ? item.toObject() : item);
      }
      return out;
    } catch (e) {
      log(`Container contents failed: ${e}`);
      return [];
    }
  }

  // Parse startingEquipment from a single document (class or background)
  async #parseStartingEquipment(doc) {
    const equipment = doc?.system?.startingEquipment ?? [];
    const grants = [];
    const choices = [];
    const currency = {};

    // Build parent→children map using the group field
    const childrenOf = {};
    for (const entry of equipment) {
      const parentId = entry.group ?? "";
      if (!childrenOf[parentId]) childrenOf[parentId] = [];
      childrenOf[parentId].push(entry);
    }

    // Resolve a linked entry into an item descriptor (or null)
    const resolveLinked = async (entry) => {
      if (!entry.key) return null;
      try {
        const item = await fromUuid(entry.key);
        if (!item) return null;
        if (item.type === "container") {
          const pack = item.pack ? game.packs.get(item.pack) : null;
          const fullItem = pack ? await pack.getDocument(item.id) : item;
          const contents = await this.#getContainerContents(fullItem);
          return { uuid: entry.key, name: item.name, img: item.img, count: entry.count ?? 1, isContainer: true, contents };
        }
        return { uuid: entry.key, name: item.name, img: item.img, count: entry.count ?? 1 };
      } catch { return null; }
    };

    // Process an AND group: returns { items, currency }
    const processAnd = async (andEntry) => {
      const children = childrenOf[andEntry._id] ?? [];
      const items = [];
      const cur = {};
      for (const child of children) {
        if (child.type === "linked") {
          const r = await resolveLinked(child);
          if (r) items.push(r);
        } else if (child.type === "currency") {
          // key = denomination ("gp"), count = amount
          const den = child.key ?? "gp";
          cur[den] = (cur[den] ?? 0) + (child.count ?? 0);
        }
      }
      return { items, currency: cur };
    };

    // Build a human-readable label for an option
    const optionLabel = ({ items, currency: cur }) => {
      const parts = [];
      for (const item of items) parts.push(`${item.count > 1 ? item.count + "× " : ""}${item.name}`);
      for (const [den, amt] of Object.entries(cur)) parts.push(`${amt} ${den}`);
      return parts.join(", ") || "Option";
    };

    // Walk root entries (group === "" or missing)
    for (const root of childrenOf[""] ?? []) {
      if (root.type === "AND") {
        // Always-granted bundle
        const { items, currency: cur } = await processAnd(root);
        grants.push(...items);
        for (const [den, amt] of Object.entries(cur)) currency[den] = (currency[den] ?? 0) + amt;

      } else if (root.type === "OR") {
        // Player chooses one child
        const orChildren = childrenOf[root._id] ?? [];
        const options = [];
        for (const orChild of orChildren) {
          if (orChild.type === "AND") {
            const bundle = await processAnd(orChild);
            options.push({ label: optionLabel(bundle), items: bundle.items, currency: bundle.currency });
          } else if (orChild.type === "linked") {
            const r = await resolveLinked(orChild);
            if (r) options.push({ label: optionLabel({ items: [r], currency: {} }), items: [r], currency: {} });
          } else if (orChild.type === "currency") {
            const den = orChild.key ?? "gp";
            const amt = orChild.count ?? 0;
            options.push({ label: `${amt} ${den}`, items: [], currency: { [den]: amt } });
          }
        }
        if (options.length > 1) choices.push({ options, selected: null });
        else if (options.length === 1) {
          grants.push(...options[0].items);
          for (const [den, amt] of Object.entries(options[0].currency)) currency[den] = (currency[den] ?? 0) + amt;
        }

      } else if (root.type === "linked") {
        const r = await resolveLinked(root);
        if (r) grants.push(r);
      } else if (root.type === "currency") {
        const den = root.key ?? "gp";
        currency[den] = (currency[den] ?? 0) + (root.count ?? 0);
      }
    }

    return { grants, choices, currency };
  }

  // Load and merge equipment from both the class and the background
  async #getAllEquipment() {
    const d = this.#data;
    const empty = { grants: [], choices: [], currency: {} };

    const clsDoc = d.cls ? await this.#getDoc(d.cls.packId, d.cls.id) : null;
    const bgDoc  = d.background ? await this.#getDoc(d.background.packId, d.background.id) : null;

    const [clsEq, bgEq] = await Promise.all([
      clsDoc ? this.#parseStartingEquipment(clsDoc) : empty,
      bgDoc  ? this.#parseStartingEquipment(bgDoc)  : empty,
    ]);

    return {
      grants: [...clsEq.grants, ...bgEq.grants],
      choices: [...clsEq.choices, ...bgEq.choices],
      currency: mergedCurrency(clsEq.currency, bgEq.currency),
    };
  }

  // ── Context for Handlebars ─────────────────────────────────────────
  async _prepareContext() {
    const d = this.#data;
    const ctx = {
      step: this.step,
      stepIndex: this.#step,
      steps: STEPS,
      data: d,
      abilityKeys: ABILITY_KEYS,
      abilityLabels: ABILITY_LABELS,
    };

    if (this.step === "race")       ctx.races       = await this.#getRaces();
    if (this.step === "class")      ctx.classes     = await this.#getClasses();
    if (this.step === "background") ctx.backgrounds = await this.#getBackgrounds();

    if (this.step === "abilities") {
      ctx.pointsLeft    = this.#pointsLeft();
      ctx.pointBuyCosts = POINT_BUY_COSTS;
      ctx.standardArray = STANDARD_ARRAY;
      ctx.allRolls      = d.allRolls;
      ctx.selectedRollIdx = d.selectedRollIdx;
      ctx.rollCount     = d.rollCount;
      ctx.rollsRemaining = 3 - (d.rollCount || 0);
    }

    if (this.step === "equipment") {
      if (!d._equipmentLoaded) {
        const { grants, choices, currency } = await this.#getAllEquipment();
        this.#data.equipmentGrants   = grants;
        this.#data.equipmentChoices  = choices.map(c => ({ ...c, selected: null }));
        this.#data.equipmentCurrency = currency;
        this.#data._equipmentLoaded  = true;
      }
      ctx.equipmentGrants   = this.#data.equipmentGrants;
      ctx.equipmentChoices  = this.#data.equipmentChoices;
      ctx.equipmentCurrency = this.#data.equipmentCurrency;
      ctx.hasCurrency = Object.keys(this.#data.equipmentCurrency).length > 0;
    }

    if (this.step === "confirm") {
      ctx.abilityMods = Object.fromEntries(
        ABILITY_KEYS.map(k => [k, Math.floor((d.abilities[k] - 10) / 2)])
      );
      ctx.equipmentNames = [
        ...d.equipmentGrants.map(g => g.isContainer
          ? `${g.name} (${(g.contents ?? []).map(c => c.name).join(", ")})`
          : `${g.count > 1 ? g.count + "× " : ""}${g.name}`
        ),
        ...d.equipmentChoices
          .filter(c => c.selected !== null && c.selected !== undefined)
          .map(c => c.options[c.selected]?.label ?? ""),
      ].filter(Boolean);
      // Combine always-granted currency with any selected choice currency
      const allCurrency = { ...d.equipmentCurrency };
      for (const c of d.equipmentChoices) {
        if (c.selected === null || c.selected === undefined) continue;
        for (const [den, amt] of Object.entries(c.options[c.selected]?.currency ?? {})) {
          allCurrency[den] = (allCurrency[den] ?? 0) + amt;
        }
      }
      ctx.currencyEntries = Object.entries(allCurrency);
    }

    return ctx;
  }

  // ── Event wiring ───────────────────────────────────────────────────
  _onRender(context, options) {
    const el = this.element;

    // Navigation
    el.querySelector(".mezz-creator-next")?.addEventListener("click", () => this.#advance());
    el.querySelector(".mezz-creator-back")?.addEventListener("click", () => this.#retreat());
    el.querySelector(".mezz-creator-finish")?.addEventListener("click", () => this.#finish());

    // Name input
    el.querySelector("#creator-name")?.addEventListener("input", e => {
      this.#data.name = e.target.value.trim();
      this.#updateNextButton();
    });

    // Card selections (race / class / background)
    el.querySelectorAll(".mezz-creator-card").forEach(card => {
      card.addEventListener("click", () => {
        el.querySelectorAll(".mezz-creator-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        const field = card.dataset.field;
        this.#data[field] = { id: card.dataset.id, name: card.dataset.name, packId: card.dataset.pack };
        if (field === "cls" || field === "background") {
          this.#data.equipmentGrants   = [];
          this.#data.equipmentChoices  = [];
          this.#data.equipmentCurrency = {};
          this.#data._equipmentLoaded  = false;
        }
        this.#updateNextButton();
      });
    });

    // Ability method buttons
    el.querySelectorAll(".mezz-method-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const method = btn.dataset.method;
        if (method === "roll") {
          if (this.#data.rollCount >= 3) return ui.notifications.warn("Maximum 3 rolls reached.");
          this.#data.abilityMethod = "roll";
          this.#rollScores();
        } else {
          this.#data.abilityMethod = method;
        }
        this.render();
      });
    });

    // Change method button
    el.querySelector(".mezz-method-change")?.addEventListener("click", () => {
      this.#data.abilityMethod = null;
      this.#data.abilities = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
      this.#data.rolledScores = [];
      this.#data.allRolls = [];
      this.#data.rollCount = 0;
      this.#data.selectedRollIdx = 0;
      this.#data.assignments = {};
      this.render();
    });

    // Roll set selector
    el.querySelectorAll(".mezz-roll-set-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.#selectRoll(parseInt(btn.dataset.idx));
        this.render();
      });
    });

    // Point buy controls
    el.querySelectorAll(".mezz-pb-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        const dir = parseInt(btn.dataset.dir);
        const cur = this.#data.abilities[key];
        const next = cur + dir;
        if (next < 8 || next > 15) return;
        if (dir > 0 && this.#pointsLeft() < (POINT_BUY_COSTS[next] - POINT_BUY_COSTS[cur])) return;
        this.#data.abilities[key] = next;
        this.render();
      });
    });

    // Standard array assignment
    el.querySelectorAll(".mezz-std-select:not(.mezz-equip-choice)").forEach(sel => {
      sel.addEventListener("change", e => {
        const key = sel.dataset.key;
        const val = parseInt(e.target.value);
        for (const k of ABILITY_KEYS) {
          if (k !== key && this.#data.abilities[k] === val) this.#data.abilities[k] = 8;
        }
        this.#data.abilities[key] = val;
        this.render();
      });
    });

    // Rolled score assignment
    el.querySelectorAll(".mezz-roll-select").forEach(sel => {
      sel.addEventListener("change", e => {
        const key = sel.dataset.key;
        const idx = e.target.value === "" ? null : parseInt(e.target.value);
        for (const k of ABILITY_KEYS) {
          if (this.#data.assignments[k] === idx && k !== key) delete this.#data.assignments[k];
        }
        if (idx === null) delete this.#data.assignments[key];
        else this.#data.assignments[key] = idx;
        for (const k of ABILITY_KEYS) {
          const i = this.#data.assignments[k];
          this.#data.abilities[k] = i !== undefined ? this.#data.rolledScores[i] : 8;
        }
        this.render();
      });
    });

    // Equipment choice dropdowns — value is option index
    el.querySelectorAll(".mezz-equip-choice").forEach(sel => {
      sel.addEventListener("change", e => {
        const choiceIdx = parseInt(sel.dataset.idx);
        const val = e.target.value;
        this.#data.equipmentChoices[choiceIdx].selected = val === "" ? null : parseInt(val);
        this.#updateNextButton();
      });
    });

    // Initial button state
    this.#updateNextButton();
  }

  // ── Next button disabled state ─────────────────────────────────────
  #updateNextButton() {
    const btn = this.element?.querySelector(".mezz-creator-next");
    if (!btn) return;
    const err = this.#validate();
    btn.disabled = !!err;
    btn.title = err ?? "";
  }

  // ── Step navigation ────────────────────────────────────────────────
  #validate() {
    const d = this.#data;
    if (this.step === "name"       && !d.name)          return "Enter a character name.";
    if (this.step === "race"       && !d.race)          return "Select a race.";
    if (this.step === "class"      && !d.cls)           return "Select a class.";
    if (this.step === "background" && !d.background)    return "Select a background.";
    if (this.step === "abilities"  && !d.abilityMethod) return "Choose an ability score method.";
    if (this.step === "abilities"  && d.abilityMethod === "standard") {
      const unset = ABILITY_KEYS.filter(k => !STANDARD_ARRAY.includes(d.abilities[k]));
      if (unset.length) return "Assign all ability scores.";
    }
    if (this.step === "abilities"  && d.abilityMethod === "roll") {
      const assigned = ABILITY_KEYS.filter(k => d.assignments[k] !== undefined).length;
      if (assigned < 6) return "Assign all rolled scores before continuing.";
    }
    if (this.step === "equipment") {
      const unresolved = d.equipmentChoices.filter(c => c.selected === null || c.selected === undefined);
      if (unresolved.length) return "Make all equipment choices before continuing.";
    }
    return null;
  }

  #advance() {
    const err = this.#validate();
    if (err) return ui.notifications.warn(err);
    if (this.#step < STEPS.length - 1) { this.#step++; this.render(); }
  }

  #retreat() {
    if (this.#step > 0) { this.#step--; this.render(); }
  }

  // ── Sequential advancement queue ───────────────────────────────────
  async #runAdvancementQueue(actor, AdvMgr, queue) {
    for (const entry of queue) {
      await this.#openAdvancement(actor, AdvMgr, entry);
      // Verify the item actually landed on the actor; re-add directly if not.
      if (entry.verifyType && !actor.items.some(i => i.type === entry.verifyType)) {
        log(`${entry.label} missing after advancement — embedding directly`);
        await actor.createEmbeddedDocuments("Item", [entry.itemData]).catch(() => {});
      }
    }
  }

  async #openAdvancement(actor, AdvMgr, { itemData, label }) {
    return new Promise((resolve) => {
      let mgr;
      try {
        mgr = AdvMgr.forNewItem(actor, itemData);
      } catch (e) {
        log(`AdvancementManager failed for ${label}: ${e}`);
        actor.createEmbeddedDocuments("Item", [itemData]).catch(() => {});
        resolve();
        return;
      }

      if (!mgr?.steps?.length) {
        log(`No steps for ${label} — embedding directly`);
        actor.createEmbeddedDocuments("Item", [itemData])
          .then(() => resolve()).catch(() => resolve());
        return;
      }

      const mgrId = mgr.id;
      let completed = false;
      let resolved = false;

      const done = (withDelay) => {
        if (resolved) return;
        resolved = true;
        Hooks.off("dnd5e.advancementManagerComplete", completeHookId);
        Hooks.off("closeAdvancementManager", closeHookId);
        // After a real completion, wait 200 ms for the DB write to settle before
        // the next advancement creates its actor clone (prevents stale-clone overwrites).
        if (withDelay) setTimeout(() => resolve(), 200);
        else resolve();
      };

      const completeHookId = Hooks.on("dnd5e.advancementManagerComplete", (completedMgr) => {
        if (completedMgr.id === mgrId) { completed = true; done(true); }
      });

      const closeHookId = Hooks.on("closeAdvancementManager", (closedApp) => {
        if (closedApp.id === mgrId && !completed) done(false);
      });

      mgr.render({ force: true });
      log(`Advancement opened for ${label} (${mgr.steps.length} steps)`);
    });
  }

  // ── Actor creation ─────────────────────────────────────────────────
  async #finish() {
    const d = this.#data;
    ui.notifications.info(`Creating ${d.name}…`);

    try {
      // 1. Create blank actor with ability scores
      const actor = await Actor.create({
        name: d.name,
        type: "character",
        system: {
          abilities: Object.fromEntries(
            ABILITY_KEYS.map(k => [k, { value: d.abilities[k] }])
          ),
        },
      });
      if (!actor) throw new Error("Actor creation returned null.");

      const AdvMgr = game.dnd5e.applications.advancement.AdvancementManager;
      const advancementQueue = [];

      // Class runs first (actor is level 0, so forNewItem processes only 0→1 advancements).
      if (d.cls) {
        const doc = await this.#getDoc(d.cls.packId, d.cls.id);
        if (doc) {
          const obj = doc.toObject();
          obj.system.levels = 1;
          advancementQueue.push({ itemData: obj, label: "class", verifyType: "class", mode: "newItem" });
        }
      }

      if (d.race) {
        const doc = await this.#getDoc(d.race.packId, d.race.id);
        if (doc) advancementQueue.push({ itemData: doc.toObject(), label: "race", verifyType: "race", mode: "newItem" });
      }

      if (d.background) {
        const doc = await this.#getDoc(d.background.packId, d.background.id);
        if (doc) advancementQueue.push({ itemData: doc.toObject(), label: "background", verifyType: "background", mode: "newItem" });
      }

      // 5. Equipment — embed items, placing container contents inside their container
      const embedItem = async (itemDesc) => {
        if (itemDesc.isContainer && itemDesc.contents?.length) {
          // Embed the container shell first to get its actor item ID
          const containerDoc = await fromUuid(itemDesc.uuid);
          if (!containerDoc) return;
          const [containerItem] = await actor.createEmbeddedDocuments("Item", [containerDoc.toObject()]);
          if (!containerItem) return;
          // Embed contents with system.container pointing at the new container
          const contentData = itemDesc.contents.map(c => ({
            ...c,
            system: { ...(c.system ?? {}), container: containerItem.id },
          }));
          await actor.createEmbeddedDocuments("Item", contentData);
        } else if (itemDesc.uuid) {
          const doc = await fromUuid(itemDesc.uuid);
          if (doc) await actor.createEmbeddedDocuments("Item", [doc.toObject()]);
        }
      };

      for (const g of d.equipmentGrants) {
        try { await embedItem(g); } catch {}
      }

      // Equipment choices — selected is now an option index
      const choiceCurrency = {};
      for (const c of d.equipmentChoices) {
        if (c.selected === null || c.selected === undefined) continue;
        const opt = c.options[c.selected];
        if (!opt) continue;
        for (const item of opt.items ?? []) {
          try { await embedItem(item); } catch {}
        }
        for (const [den, amt] of Object.entries(opt.currency ?? {})) {
          choiceCurrency[den] = (choiceCurrency[den] ?? 0) + amt;
        }
      }

      // Starting currency (grants + choices combined)
      const allCurrency = { ...d.equipmentCurrency };
      for (const [den, amt] of Object.entries(choiceCurrency)) {
        allCurrency[den] = (allCurrency[den] ?? 0) + amt;
      }
      if (Object.keys(allCurrency).length) {
        const currencyUpdate = {};
        for (const [den, amt] of Object.entries(allCurrency)) {
          currencyUpdate[`system.currency.${den}`] = amt;
        }
        await actor.update(currencyUpdate);
      }

      // 6. Open sheet, then run class advancement
      this.close();
      actor.sheet.render(true);
      this.#runAdvancementQueue(actor, AdvMgr, advancementQueue);

      log(`Character ${d.name} created successfully.`);
    } catch (e) {
      ui.notifications.error(`Character creation failed: ${e.message}`);
      console.error(e);
    }
  }
}
