import { log } from "./utils.mjs";

const STEPS = ["name", "abilities", "race", "background", "class", "equipment", "confirm"];

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_MAX = 27;
const POINT_BUY_COSTS = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_LABELS = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

export class MezzCharacterCreator extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mezz-character-creator",
    tag: "div",
    window: { title: "Character Creator", resizable: true },
    position: { width: 720, height: 620 },
    classes: ["mezz-creator"],
  };

  static PARTS = { main: { template: "modules/mezz-comp/scripts/templates/character-creator.hbs" } };

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

  // ── Class starting equipment ───────────────────────────────────────
  async #getClassEquipment() {
    const cls = this.#data.cls;
    if (!cls) return { grants: [], choices: [], currency: {} };

    const doc = await this.#getDoc(cls.packId, cls.id);
    if (!doc) return { grants: [], choices: [], currency: {} };

    const equipment = doc.system.startingEquipment ?? [];
    const grants = [];
    const choices = [];
    const currency = {};

    const resolveEntry = async (entry) => {
      if (entry.type === "currency") {
        const den = entry.denomination ?? "gp";
        const amt = entry.currency ?? entry.amount ?? 0;
        currency[den] = (currency[den] ?? 0) + amt;
        return null;
      }
      if (!entry.key) return null;
      try {
        const item = await fromUuid(entry.key);
        if (!item) return null;

        if (item.type === "container") {
          // Load the full document from its compendium to get embedded contents
          const packId = item.pack;
          const pack = packId ? game.packs.get(packId) : null;
          const fullItem = pack ? await pack.getDocument(item.id) : item;
          const contentItems = [];
          if (fullItem?.system?.contents) {
            for (const content of fullItem.system.contents) {
              contentItems.push(content.toObject());
            }
          }
          return {
            uuid: entry.key,
            name: item.name,
            img: item.img,
            count: entry.count ?? 1,
            isContainer: true,
            contents: contentItems,
          };
        }

        return { uuid: entry.key, name: item.name, img: item.img, count: entry.count ?? 1 };
      } catch { return null; }
    };

    for (const entry of equipment) {
      if (entry.type === "linked") {
        const resolved = await resolveEntry(entry);
        if (resolved) grants.push(resolved);
      } else if (entry.type === "or") {
        const options = [];
        for (const opt of entry.pool ?? []) {
          const resolved = await resolveEntry(opt);
          if (resolved) options.push(resolved);
        }
        if (options.length) choices.push({ options, selected: null });
      } else if (entry.type === "currency") {
        await resolveEntry(entry);
      }
    }

    return { grants, choices, currency };
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
  }

  #selectRoll(idx) {
    this.#data.selectedRollIdx = idx;
    this.#data.rolledScores = this.#data.allRolls[idx];
    this.#data.assignments = {};
    this.#data.abilities = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
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

    if (this.step === "equipment") {
      if (!d.equipmentGrants.length && !d.equipmentChoices.length && !Object.keys(d.equipmentCurrency).length) {
        const { grants, choices, currency } = await this.#getClassEquipment();
        this.#data.equipmentGrants   = grants;
        this.#data.equipmentChoices  = choices.map(c => ({ ...c, selected: null }));
        this.#data.equipmentCurrency = currency;
      }
      ctx.equipmentGrants   = this.#data.equipmentGrants;
      ctx.equipmentChoices  = this.#data.equipmentChoices;
      ctx.equipmentCurrency = this.#data.equipmentCurrency;
      ctx.hasCurrency = Object.keys(this.#data.equipmentCurrency).length > 0;
    }

    if (this.step === "abilities") {
      ctx.pointsLeft      = this.#pointsLeft();
      ctx.pointBuyCosts   = POINT_BUY_COSTS;
      ctx.standardArray   = STANDARD_ARRAY;
      ctx.allRolls        = this.#data.allRolls;
      ctx.selectedRollIdx = this.#data.selectedRollIdx;
      ctx.rollCount       = this.#data.rollCount;
      ctx.rollsRemaining  = 3 - (this.#data.rollCount || 0);
    }

    if (this.step === "confirm") {
      ctx.abilityMods = Object.fromEntries(
        ABILITY_KEYS.map(k => [k, Math.floor((d.abilities[k] - 10) / 2)])
      );
      ctx.equipmentNames = [
        ...d.equipmentGrants.map(g => g.isContainer
          ? `${g.name} (contents)`
          : (g.count > 1 ? `${g.count}× ${g.name}` : g.name)
        ),
        ...d.equipmentChoices
          .filter(c => c.selected)
          .map(c => {
            const opt = c.options.find(o => o.uuid === c.selected);
            if (!opt) return "";
            return opt.isContainer
              ? `${opt.name} (contents)`
              : (opt.count > 1 ? `${opt.count}× ${opt.name}` : opt.name);
          })
          .filter(Boolean),
        ...Object.entries(d.equipmentCurrency).map(([den, amt]) => `${amt} ${den}`),
      ];
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
        if (field === "cls") {
          this.#data.equipmentGrants   = [];
          this.#data.equipmentChoices  = [];
          this.#data.equipmentCurrency = {};
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

    // Roll set selector
    el.querySelectorAll(".mezz-roll-set-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.#selectRoll(parseInt(btn.dataset.idx));
        this.render();
      });
    });

    // Change method button
    el.querySelector(".mezz-method-change")?.addEventListener("click", () => {
      this.#data.abilityMethod   = null;
      this.#data.abilities       = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
      this.#data.rolledScores    = [];
      this.#data.allRolls        = [];
      this.#data.rollCount       = 0;
      this.#data.selectedRollIdx = 0;
      this.#data.assignments     = {};
      this.render();
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
    el.querySelectorAll(".mezz-std-select").forEach(sel => {
      if (sel.classList.contains("mezz-equip-choice")) return;
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

    // Equipment choice dropdowns
    el.querySelectorAll(".mezz-equip-choice").forEach(sel => {
      sel.addEventListener("change", e => {
        const idx = parseInt(sel.dataset.idx);
        this.#data.equipmentChoices[idx].selected = e.target.value || null;
      });
    });

    // Set initial next button state
    this.#updateNextButton();
  }

  // ── Step navigation ────────────────────────────────────────────────
  #validate() {
    const d = this.#data;
    if (this.step === "name"       && !d.name)          return "Enter a character name.";
    if (this.step === "abilities"  && !d.abilityMethod) return "Choose an ability score method.";
    if (this.step === "abilities"  && d.abilityMethod === "roll") {
      const assigned = ABILITY_KEYS.filter(k => d.assignments[k] !== undefined).length;
      if (assigned < 6) return "Assign all rolled scores before continuing.";
    }
    if (this.step === "race"       && !d.race)       return "Select a race.";
    if (this.step === "background" && !d.background) return "Select a background.";
    if (this.step === "class"      && !d.cls)        return "Select a class.";
    if (this.step === "equipment") {
      const unresolved = d.equipmentChoices.filter(c => !c.selected);
      if (unresolved.length) return "Make all equipment choices before continuing.";
    }
    return null;
  }

  #updateNextButton() {
    const btn = this.element?.querySelector(".mezz-creator-next");
    if (!btn) return;
    const err = this.#validate();
    btn.disabled = !!err;
    btn.title = err ?? "";
  }

  #advance() {
    const err = this.#validate();
    if (err) return ui.notifications.warn(err);
    if (this.#step < STEPS.length - 1) { this.#step++; this.render(); }
  }

  #retreat() {
    if (this.#step > 0) { this.#step--; this.render(); }
  }

  // ── Actor creation ─────────────────────────────────────────────────
  async #finish() {
    const d = this.#data;
    ui.notifications.info(`Creating ${d.name}…`);

    try {
      // 1. Create blank actor
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

      // 2. Class first — before race/background increment character level
      if (d.cls) {
        const doc = await this.#getDoc(d.cls.packId, d.cls.id);
        if (doc) {
          const obj = doc.toObject();
          obj.system.levels = 1;
          advancementQueue.push({ itemData: obj, label: "class" });
        }
      }

      // 3. Race — embed directly (guarantees it lands on the actor)
      // dnd5e v4 auto-applies ItemGrant/Trait advancements on createEmbeddedDocuments
      if (d.race) {
        const doc = await this.#getDoc(d.race.packId, d.race.id);
        if (doc) {
          const obj = doc.toObject();
          obj.system.advancementLevel = 1;
          const [raceItem] = await actor.createEmbeddedDocuments("Item", [obj]);
          log(`Race embedded: ${raceItem?.name} (${raceItem?.id})`);
        }
      }

      // 4. Background — same pattern
      if (d.background) {
        const doc = await this.#getDoc(d.background.packId, d.background.id);
        if (doc) {
          const obj = doc.toObject();
          obj.system.advancementLevel = 1;
          const [bgItem] = await actor.createEmbeddedDocuments("Item", [obj]);
          log(`Background embedded: ${bgItem?.name} (${bgItem?.id})`);
        }
      }

      // 5. Equipment — embed items, expand containers into their contents
      const itemsToAdd = [];

      for (const g of d.equipmentGrants) {
        try {
          if (g.isContainer && g.contents?.length) {
            itemsToAdd.push(...g.contents);
          } else {
            const doc = await fromUuid(g.uuid);
            if (doc) itemsToAdd.push(doc.toObject());
          }
        } catch {}
      }

      for (const c of d.equipmentChoices) {
        if (!c.selected) continue;
        try {
          const selectedOpt = c.options.find(o => o.uuid === c.selected);
          if (selectedOpt?.isContainer && selectedOpt.contents?.length) {
            itemsToAdd.push(...selectedOpt.contents);
          } else {
            const doc = await fromUuid(c.selected);
            if (doc) itemsToAdd.push(doc.toObject());
          }
        } catch {}
      }

      if (itemsToAdd.length) await actor.createEmbeddedDocuments("Item", itemsToAdd);

      // 6. Starting currency
      if (Object.keys(d.equipmentCurrency).length) {
        const currencyUpdate = {};
        for (const [den, amt] of Object.entries(d.equipmentCurrency)) {
          currencyUpdate[`system.currency.${den}`] = amt;
        }
        await actor.update(currencyUpdate);
      }

      // 7. Open sheet, close creator, then run advancements sequentially
      this.close();
      actor.sheet.render(true);
      log(`Character ${d.name} created successfully.`);
      this.#runAdvancementQueue(actor, AdvMgr, advancementQueue);

    } catch (e) {
      ui.notifications.error(`Character creation failed: ${e.message}`);
      console.error(e);
    }
  }

  // ── Sequential advancement queue ───────────────────────────────────
  async #runAdvancementQueue(actor, AdvMgr, queue) {
    for (const entry of queue) {
      await this.#openAdvancement(actor, AdvMgr, entry);
    }
  }

  async #openAdvancement(actor, AdvMgr, { itemData, label }) {
    return new Promise((resolve) => {
      let mgr;
      try {
        mgr = AdvMgr.forNewItem(actor, itemData);
      } catch (e) {
        log(`AdvancementManager failed for ${label}: ${e}`);
        resolve();
        return;
      }

      if (!mgr?.steps?.length) {
        log(`No steps for ${label}, skipping`);
        resolve();
        return;
      }

      const mgrId = mgr.id;
      let resolved = false;

      const done = () => {
        if (resolved) return;
        resolved = true;
        Hooks.off("dnd5e.advancementManagerComplete", completeHookId);
        Hooks.off("closeAdvancementManager", closeHookId);
        resolve();
      };

      const completeHookId = Hooks.on("dnd5e.advancementManagerComplete", (m) => {
        if (m.id === mgrId) done();
      });
      const closeHookId = Hooks.on("closeAdvancementManager", (m) => {
        if (m.id === mgrId) done();
      });

      mgr.render({ force: true });
      log(`Advancement opened for ${label} (${mgr.steps.length} steps)`);
    });
  }
}
