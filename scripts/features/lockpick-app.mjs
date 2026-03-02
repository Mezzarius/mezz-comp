// =====================================================
// MEZZ-COMP LOCKPICK MINI-GAME
// scripts/features/lockpick-app.mjs
// dnd5e 5.2.4 / midi-qol
// =====================================================

import { MODULE_ID, log, getModuleAsset, sendChat } from "../utils.mjs";

const ASSET_PATH = getModuleAsset("lockpick");

// ─────────────────────────────────────────────────────────
//  Skill scaling
// ─────────────────────────────────────────────────────────

const TIME_PER_BONUS             = 3;     // extra seconds per +1 SoH bonus
const SNAP_REDUCTION_PER_BONUS   = 0.04;  // snap chance reduced 4% per +1
const MIN_SNAP_CHANCE            = 0.05;  // floor: 5% even at very high bonus
const TUMBLER_REDUCTION_PER_BONUS = 0.15; // fractional max-tumbler reduction per +1

const BASE_DIFFICULTY = {
  easy:   { minTime: 40, maxTime: 70, minTumblers: 2, maxTumblers: 4, numLocks: 4 },
  normal: { minTime: 20, maxTime: 50, minTumblers: 3, maxTumblers: 6, numLocks: 6 },
  hard:   { minTime: 12, maxTime: 38, minTumblers: 4, maxTumblers: 7, numLocks: 6 },
  deadly: { minTime:  8, maxTime: 25, minTumblers: 5, maxTumblers: 8, numLocks: 8 },
};

/**
 * Merge the DC-derived difficulty tier with the actor's Sleight of Hand bonus
 * to produce final game settings.
 *
 * Higher skillBonus → more time, lower snap chance, fewer max tumblers.
 */
function buildGameSettings(difficulty, skillBonus) {
  const base        = BASE_DIFFICULTY[difficulty] ?? BASE_DIFFICULTY.normal;
  const bonus       = Math.max(0, skillBonus);
  const timeBonus   = Math.round(bonus * TIME_PER_BONUS);
  const tumblerCut  = Math.floor(bonus * TUMBLER_REDUCTION_PER_BONUS);
  const snapChance  = Math.max(MIN_SNAP_CHANCE, 0.5 - bonus * SNAP_REDUCTION_PER_BONUS);

  log(`Lockpick settings | difficulty=${difficulty} skillBonus=${skillBonus} snapChance=${(snapChance*100).toFixed(0)}% timeBonus=+${timeBonus}s`);

  return {
    minTime:     base.minTime  + timeBonus,
    maxTime:     base.maxTime  + timeBonus,
    minTumblers: base.minTumblers,
    maxTumblers: Math.max(base.minTumblers, base.maxTumblers - tumblerCut),
    numLocks:    base.numLocks,
    snapChance,
    skillBonus,
    difficulty,
  };
}

function deriveDifficulty(dc = 15) {
  if (dc < 10) return "easy";
  if (dc < 15) return "normal";
  if (dc < 20) return "hard";
  return "deadly";
}

// ─────────────────────────────────────────────────────────
//  Public entry point
// ─────────────────────────────────────────────────────────

/**
 * Open the lockpick mini-game dialog.
 *
 * @param {Actor}  actor
 * @param {Item}   item
 * @param {object} [options]
 * @param {number} [options.dc=15]         Lock DC
 * @param {number} [options.skillBonus=0]  Actor's full SoH modifier
 * @returns {Promise<{success: boolean, locksCleared: number, picksLeft: number, aborted?: boolean}>}
 */
export async function openLockpickMinigame(actor, item, options = {}) {
  const dc         = options.dc          ?? 15;
  const skillBonus = options.skillBonus  ?? 0;
  const difficulty = deriveDifficulty(dc);
  const settings   = buildGameSettings(difficulty, skillBonus);

  return new Promise((resolve) => {
    const snapPct   = Math.round(settings.snapChance * 100);
    const timeRange = `${settings.minTime}–${settings.maxTime}s`;

    // Use Dialog — the simplest Foundry UI primitive, always works.
    // No template file, no Handlebars, no _renderInner override needed.
    const dlgContent = `
      <div style="background:#000;margin:-4px -4px 0;padding:0;overflow:hidden;">
        <div style="padding:5px 10px;background:#111;color:#888;font-size:11px;border-bottom:1px solid #222;">
          <strong style="color:#ccc;">${actor.name}</strong> &nbsp;·&nbsp;
          <span style="color:#e8a020;text-transform:uppercase;">${settings.difficulty}</span>
          &nbsp;·&nbsp; SoH +${settings.skillBonus} &nbsp;·&nbsp;
          snap ${snapPct}% &nbsp;·&nbsp; ${timeRange}
        </div>
        <canvas id="mezz-lockpick-canvas" width="960" height="600"
          style="display:block;width:960px;height:600px;
                 image-rendering:pixelated;image-rendering:crisp-edges;"></canvas>
        <div style="padding:3px 8px;background:#0d0d0d;color:#444;font-size:10px;
                    border-top:1px solid #1a1a1a;text-align:center;">
          WASD/↑↓←→ select &nbsp;·&nbsp; Space flip &nbsp;·&nbsp;
          Enter use &nbsp;·&nbsp; Esc give up
        </div>
      </div>`;

    let game     = null;
    let resolved = false;

    function finish(result) {
      if (resolved) return;
      resolved = true;
      dlg.close();
      resolve(result);
    }

    const dlg = new Dialog({
      title:   "Lockpicking",
      content: dlgContent,
      buttons: {},
      render: (html) => {
        const canvas = html[0]?.querySelector?.("#mezz-lockpick-canvas")
                    ?? html.find?.("#mezz-lockpick-canvas")?.[0];
        if (!canvas) {
          console.error("[mezz-comp|lockpick] #mezz-lockpick-canvas not found in dialog!");
          console.log("[mezz-comp|lockpick] dialog html:", html[0]?.innerHTML?.slice(0,400));
          resolve({ success: false, locksCleared: 0, picksLeft: 0, aborted: true });
          return;
        }
        game = new LockpickGame({ canvas, settings, assetPath: ASSET_PATH, onComplete: finish });
        game.start();
      },
      close: () => {
        if (!resolved) {
          if (game) game.abort();
          resolve({ success: false, locksCleared: 0, picksLeft: 0, aborted: true });
        }
      },
    }, { width: 1000, height: 680, resizable: false, classes: ["mezz-comp-lockpick"] });

    dlg.render(true);
  });
}


// ─────────────────────────────────────────────────────────
//  Core mini-game  (adapted from ha3k-20-lockpick by za3k)
//  https://github.com/za3k/ha3k-20-lockpick
// ─────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

class LockpickGame {
  constructor({ canvas, settings, assetPath, onComplete }) {
    this.canvas     = canvas;
    this.ctx        = canvas.getContext("2d");
    this.assetPath  = assetPath;
    this.onComplete = onComplete;
    this.settings   = settings;
    this.finished   = false;
    this.aborted    = false;

    this.selectedPick     = 0;
    this.timeLeft         = 0;
    this.tumblersUnlocked = 0;
    this.lock             = [];
    this.text             = "";
    this.kbQueue          = [];

    // 10 picks: [leftSprite, rightSprite, broken]
    this.picks = [
      [ 9,17,0], [ 6,16,0], [10,14,0], [17, 7,0], [ 3, 1,0],
      [13,15,0], [10, 5,0], [ 8, 4,0], [11, 0,0], [12, 2,0],
    ];

    this._sprites = {};
    this._locks   = [];
    this._chests  = [];
    this._picture = null;
    this._scale   = 1;

    this._boundKeyPress = this._keyPress.bind(this);
  }

  // ── Lifecycle ──────────────────────────────────────────

  /**
   * Wait for the spritesheet to fully load before starting the game loop.
   * This prevents the blank-screen bug where drawImage silently fails
   * because the image hasn't been decoded yet.
   */
  async start() {
    document.addEventListener("keydown", this._boundKeyPress);

    // Force explicit pixel size — prevents offsetWidth returning 0 before layout
    this.canvas.width  = 960;
    this.canvas.height = 600;

    // Diagnostic fill — magenta means canvas works, spritesheet loading
    const ctx = this.canvas.getContext("2d");
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 960, 600);
    ctx.fillStyle = "#ffffff";
    ctx.font = "32px monospace";
    ctx.fillText("Loading spritesheet...", 40, 300);

    console.log(`[mezz-comp|lockpick] Canvas size: ${this.canvas.width}x${this.canvas.height}, offset: ${this.canvas.offsetWidth}x${this.canvas.offsetHeight}`);

    try {
      await this._loadSprites();
    } catch (err) {
      console.error("[mezz-comp|lockpick] Failed to load spritesheet:", err);
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 960, 600);
      ctx.fillStyle = "#ffffff";
      ctx.font = "28px monospace";
      ctx.fillText("ERROR: " + err.message, 40, 300);
      ctx.fillText("Check browser console for details.", 40, 340);
      // Don't auto-close — let the GM see the error
      return;
    }

    console.log(`[mezz-comp|lockpick] Spritesheet loaded. Sprite count: ${Object.keys(this._sprites).length}`);
    console.log(`[mezz-comp|lockpick] Image natural size: ${this._sharedImage.naturalWidth}x${this._sharedImage.naturalHeight}`);

    // Two rAFs: first lets the Application finish DOM injection,
    // second lets the browser complete its layout pass.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    console.log(`[mezz-comp|lockpick] Post-layout canvas size: ${this.canvas.offsetWidth}x${this.canvas.offsetHeight}`);

    this._play();
  }

  abort() {
    this.aborted  = true;
    this.finished = true;
    document.removeEventListener("keydown", this._boundKeyPress);
  }

  // ── Assets ─────────────────────────────────────────────

  _sprite(opts) {
    return { x: opts.x, y: opts.y, w: opts.w ?? 16, h: opts.h ?? 16, img: this._sharedImage };
  }

  /**
   * Returns a Promise that resolves once the spritesheet Image has decoded.
   * All sprite objects are built after load so their img reference is valid.
   */
  _loadSprites() {
    return new Promise((resolve, reject) => {
      const img   = new Image();
      img.onload  = () => {
        this._sharedImage = img;
        this._buildSpriteMap();
        resolve();
      };
      img.onerror = () => reject(new Error(`Could not load: ${img.src}`));
      // Set src after handlers so we don't miss an instant cache-hit
      // Prefix with / so the path resolves from the Foundry root regardless of
      // any subdirectory the server may be running under.
      img.src = `/${this.assetPath}/spritesheet.png`;
    });
  }

  _buildSpriteMap() {
    // ORIGINAL spritesheet coords (383x378px from ha3k-20-lockpick repo)
    const sp = this._sprites;
    for (let i = 0; i < 18; i++) {
      sp[`pick_left_${i}`]     = this._sprite({ x: 16*i, y:  1, w: 15, h: 12 });
      sp[`pick_right_${i}`]    = this._sprite({ x: 16*i, y: 19, w: 15, h: 12 });
      sp[`lock_unpicked_${i}`] = this._sprite({ x: 16*i, y: 32, w: 15, h: 11 });
      sp[`lock_picked_${i}`]   = this._sprite({ x: 16*i, y: 44, w: 15, h: 16 });
    }
    sp["pick_middle_selected"] = this._sprite({ x:  0, y: 62, w: 46, h: 14 });
    sp["pick_middle_broken"]   = this._sprite({ x: 48, y: 62, w: 46, h: 14 });
    sp["pick_middle_whole"]    = this._sprite({ x: 96, y: 62, w: 46, h: 14 });
    for (let i = 0; i < 4; i++)
      sp[`tumbler_background_${i}`] = this._sprite({ x: 16*i, y:  77, w: 15, h: 63 });
    for (let i = 0; i < 3; i++) {
      sp[`chest_${i}`] = this._sprite({ x: 48*i, y: 141, w: 47, h: 63 });
      this._chests.push(sp[`chest_${i}`]);
    }
    for (let i = 0; i < 8; i++) {
      sp[`lock_${i}`] = this._sprite({ x: 48*i, y: 205, w: 47, h: 63 });
      this._locks.push(sp[`lock_${i}`]);
    }
    sp["scroll"]     = this._sprite({ x:   1, y: 269, w: 318, h: 102 });
    sp["wick"]       = this._sprite({ x:   0, y: 374, w: 108, h:   4 });
    sp["wick_flame"] = this._sprite({ x: 108, y: 374, w:   2, h:   4 });
    log(`Lockpick spritesheet loaded — ${Object.keys(sp).length} sprites mapped.`);
  }

  // ── Audio ──────────────────────────────────────────────

  _sound(name) {
    const audio = new Audio(`/${this.assetPath}/audio/${name}.wav`);
    audio.play().catch(() => {});
  }

  // ── Timing ─────────────────────────────────────────────

  _sleep(seconds) {
    return new Promise(resolve => {
      setTimeout(() => { this.timeLeft -= seconds; resolve(); }, seconds * 1000);
    });
  }

  // ── Input ──────────────────────────────────────────────

  _keyPress(e) {
    if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const valid = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","w","a","s","d"," ","Enter","Escape"];
    if (valid.includes(e.key)) { e.preventDefault(); this.kbQueue.push(e.key); }
  }

  async _getInput(timeoutSeconds) {
    if (this.kbQueue.length > 0) return this.kbQueue.shift();
    await this._sleep(timeoutSeconds);
    return undefined;
  }

  // ── Game flow ──────────────────────────────────────────

  async _play() {
    const { numLocks } = this.settings;
    const endSprites   = [];

    for (let i = 0; i < numLocks; i++) {
      if (this.aborted) return;
      endSprites.push(await this._playLock(i));
    }

    const cleared   = endSprites.filter(s => this._chests.includes(s)).length;
    const picksLeft = this.picks.filter(p => !p[2]).length;
    const success   = cleared > numLocks / 2;

    this.finished = true;
    document.removeEventListener("keydown", this._boundKeyPress);
    this._displayEnd(endSprites);

    await new Promise(r => setTimeout(r, 2500));
    this.onComplete({ success, locksCleared: cleared, picksLeft });
  }

  async _playLock(i) {
    const { minTime, maxTime, minTumblers, maxTumblers } = this.settings;

    const numTumblers = randomInt(minTumblers, maxTumblers);
    this.tumblersUnlocked = 0;
    this.lock = [];
    let lastTum = -1;
    for (let t = 0; t < numTumblers; t++) {
      let tum = lastTum;
      while (tum === lastTum) tum = randomInt(0, 15);
      this.lock.push((lastTum = tum));
    }

    this.timeLeft = randomInt(minTime, maxTime);
    this._picture = this._locks[i % this._locks.length];
    this.text     = "white: Hurry up and pick the lock!";
    let hurry     = false;

    while (true) {
      if (this.aborted) return this._picture;

      if (this.timeLeft <= 0) {
        this.text = "red: You have failed to pick the lock!";
        this._sound("lock_fail");
        this._display();
        await this._sleep(2);
        return this._picture;
      }

      if (!hurry && this.timeLeft <= 8) {
        hurry     = true;
        this.text = "white: Hurry, time is running out!";
        this._sound("tumbler_warn");
      }

      const input = await this._getInput(0.1);
      switch (input) {
        case "ArrowUp":    case "w": this.selectedPick = [9,7,8,0,1,2,3,4,5,6][this.selectedPick]; this._sound("pick_select"); break;
        case "ArrowLeft":  case "a": this.selectedPick = [0,3,1,2,6,4,5,9,7,8][this.selectedPick]; this._sound("pick_select"); break;
        case "ArrowRight": case "d": this.selectedPick = [0,2,3,1,5,6,4,8,9,7][this.selectedPick]; this._sound("pick_select"); break;
        case "ArrowDown":  case "s": this.selectedPick = [3,4,5,6,7,8,9,1,2,0][this.selectedPick]; this._sound("pick_select"); break;
        case " ": {
          const p = this.picks[this.selectedPick];
          this.picks[this.selectedPick] = [p[1], p[0], p[2]];
          break;
        }
        case "Enter":
          if (this.picks[this.selectedPick][2]) {
            this.text = "white: You can't use that pick, it's broken!";
          } else {
            const snapped = await this._tryPick(this.picks[this.selectedPick][1]);
            if (snapped) this.picks[this.selectedPick][2] = 1;
          }
          break;
        case "Escape":
          this.text = "red: You gave up on the lock!";
          this._sound("lock_fail");
          this._display();
          await this._sleep(2);
          return this._picture;
      }

      this._display();

      if (this.tumblersUnlocked >= this.lock.length) {
        await this._sleep(0.3);
        this._sound("lock_success");
        this._picture = this._chests[randomInt(0, this._chests.length - 1)];
        this.text     = "limegreen: You cleverly picked the lock!";
        this._display();
        await this._sleep(2);
        return this._picture;
      }
    }
  }

  /**
   * Attempt the current tumbler.
   * x is the virtual canvas x-position of this tumbler slot (3x scaled).
   */
  async _tryPick(pick) {
    const ti = this.tumblersUnlocked;
    const tv = this.lock[ti];
    const x  = 528 + ti * 42;   // 3× original (176 + ti*14)
    const { snapChance } = this.settings;

    if (pick === tv) {
      this.tumblersUnlocked++;
      this._sound("tumbler_pick");
      await this._animateSuccess(x, tv);
      return false;
    }

    if (Math.random() < snapChance) {
      this.text = "red: Uh oh! You snapped that pick!";
      this._sound("tumbler_break");
      await this._animateFail(x, tv);
      return true;
    } else {
      this.text = "red: Be careful! You'll break the pick!";
      this._sound("tumbler_warn");
      await this._animateFail(x, tv);
      return false;
    }
  }

  // ── Rendering ──────────────────────────────────────────
  // Virtual canvas: 320×200 (original game dimensions).
  // Sprites are 3× their original pixel size, so we draw them
  // at w/3, h/3 virtual units — at scale=3 they render at native pixel size.
  // scale = min(realCanvasW/320, realCanvasH/200) ≈ 3 for a 960×600 window.

  _spr(sprite, vx, vy) {
    if (!sprite) return;
    const s = this._scale;
    // Draw at 1/3 virtual size so sprites fill exactly the original layout footprint
    this.ctx.drawImage(sprite.img, sprite.x, sprite.y, sprite.w, sprite.h,
                       vx*s, vy*s, sprite.w*s, sprite.h*s);
  }

  _rect(vx, vy, vw, vh, color) {
    const s = this._scale;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(vx*s, vy*s, vw*s, vh*s);
  }

  _computeScale() {
    const c  = this.canvas;
    const dw = c.offsetWidth  || c.width  || 960;
    const dh = c.offsetHeight || c.height || 600;
    c.width  = dw;
    c.height = dh;
    this._scale = Math.max(0.1, Math.min(dw / 320, dh / 200));
  }

  _display() {
    this._computeScale();
    const s = this._scale;

    // Background + dialogue box
    this._rect(0,  0, 320, 200, "#FF55FF");
    this._rect(7, 23, 117,  33, "#000000");

    // Text in dialogue box
    if (this.text) {
      const [color, msg] = this.text.split(": ");
      this.ctx.fillStyle = color;
      this.ctx.font = `bold ${7*s}px monospace`;
      const maxW = 110 * s;
      const words = msg.split(" ");
      let line = "", y = 32;
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (this.ctx.measureText(test).width > maxW && line) {
          this.ctx.fillText(line, 9*s, y*s);
          line = w; y += 9;
        } else { line = test; }
      }
      if (line) this.ctx.fillText(line, 9*s, y*s);
    }

    // Scroll background (original position)
    this._spr(this._sprites["scroll"], 1, 91);

    // Pick grid — 10 picks in 3-col × 4-row layout, base (24, 112), stride col*96 row*16
    this.picks.forEach((pick, i) => {
      const [left, right, broken] = pick;
      const mid = this.selectedPick === i ? "selected" : (broken ? "broken" : "whole");
      const row = Math.floor((i + 2) / 3);
      const col = (i + 2) % 3;
      const bx  = 24 + col * 96;
      const by  = 112 + row * 16;
      this._spr(this._sprites[`pick_left_${left}`],   bx,      by);
      this._spr(this._sprites[`pick_middle_${mid}`],  bx + 15, by);
      this._spr(this._sprites[`pick_right_${right}`], bx + 61, by);
    });

    // Selected pick preview
    const sel = this.picks[this.selectedPick];
    this._spr(this._sprites[`pick_left_${sel[0]}`],                        24, 64);
    this._spr(this._sprites[`pick_middle_${sel[2] ? "broken" : "whole"}`], 39, 64);
    this._spr(this._sprites[`pick_right_${sel[1]}`],                       85, 66);

    // Fuse timer
    const pct   = Math.max(0, this.timeLeft / this.settings.maxTime);
    const fuseX = 7 + Math.round(108 * pct);
    this._spr(this._sprites["wick"], 7, 10);
    this._rect(fuseX, 10, 108 + 7 - fuseX, 4, "#FF55FF");
    this._spr(this._sprites["wick_flame"], fuseX, 10);

    // Lock/chest icon
    if (this._picture) this._spr(this._picture, 129, 8);

    // Tumblers
    this.lock.forEach((tv, i) => {
      const tx = 176 + i * 14;
      if (this.tumblersUnlocked > i) {
        this._spr(this._sprites["tumbler_background_1"], tx, 8);
        this._spr(this._sprites[`lock_picked_${tv}`],   tx, 29);
      } else {
        this._spr(this._sprites["tumbler_background_3"], tx, 8);
        this._spr(this._sprites[`lock_unpicked_${tv}`], tx, 26);
      }
    });
    this._spr(this._sprites["tumbler_background_0"], 176 + this.lock.length * 14, 8);
  }

  _displayEnd(endSprites) {
    this._computeScale();
    const s = this._scale;
    this._rect(0, 0, 320, 200, "#FF55FF");
    this.ctx.fillStyle = "limegreen";
    this.ctx.font = `bold ${7*s}px monospace`;
    this.ctx.fillText("Your final score:", 9*s, 20*s);
    endSprites.forEach((sprite, i) => {
      const row = Math.floor(i / 4);
      const col = i % 4;
      this._spr(sprite, 7 + col * 47, 30 + row * 63);
    });
  }

  async _animateFail(tx, tv) {
    this._spr(this._sprites["tumbler_background_1"], tx, 8);
    this._spr(this._sprites[`lock_unpicked_${tv}`], tx, 23);
    this._display(); await this._sleep(0.1);
    this._spr(this._sprites["tumbler_background_2"], tx, 8);
    this._spr(this._sprites[`lock_unpicked_${tv}`], tx, 29);
    this._display(); await this._sleep(0.1);
  }

  async _animateSuccess(tx, tv) {
    this._spr(this._sprites["tumbler_background_3"], tx, 8);
    this._spr(this._sprites[`lock_picked_${tv}`],   tx, 21);
    this._display(); await this._sleep(0.1);
    this._spr(this._sprites["tumbler_background_1"], tx, 8);
    this._spr(this._sprites[`lock_picked_${tv}`],   tx, 29);
    this._display(); await this._sleep(0.05);
  }
}
