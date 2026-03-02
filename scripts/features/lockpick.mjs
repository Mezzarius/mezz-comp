// scripts/features/lockpick.mjs

export function openMezzLockpick({ actor, dc = 15, skill = 5, picks = 5 } = {}) {
  new MezzLockpickApp({ actor, dc, skill, picks }).render(true);
}

class MezzLockpickApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mezz-lockpick",
      title: "Lockpicking",
      template: "modules/mezz-comp/templates/lockpick.hbs",
      width: 720,
      height: 420,
      resizable: true
    });
  }

  constructor({ actor, dc, skill, picks }) {
    super();
    this.actor = actor;
    this.dc = dc;
    this.skill = skill;
    this.picks = picks;

    this.state = this._buildState();
    this._mouseDown = false;
    this._angleTarget = 0;
  }

  _buildState() {
    const tumblers = Math.min(9, Math.max(3, 3 + Math.floor((this.dc - 10) / 3)));
    const skillScore = Math.min(1, Math.max(0, (this.skill + 2) / 18));

    const sweetCenter = foundry.utils.randomID().length % 90 - 45;

    const baseWidth = 18;
    const sweetWidth = Math.max(
      2.5,
      baseWidth - (this.dc - 10) * 0.55 - (tumblers - 3) * 1.5
    ) * (0.9 + skillScore);

    return {
      tumblers,
      skillScore,
      pickAngle: 0,
      cylinderAngle: 0,
      stress: 0,
      time: 12 + (skillScore * 18),
      sweetCenter,
      sweetWidth,
      solved: false,
      failed: false
    };
  }

  getData() {
    return {
      dc: this.dc,
      tumblers: this.state.tumblers
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    const root = html[0];

    this.$pick = root.querySelector(".lp-pick");
    this.$cyl = root.querySelector(".lp-cylinder");
    this.$stress = root.querySelector(".lp-stress-fill");
    this.$time = root.querySelector(".lp-time-fill");
    this.$status = root.querySelector(".lp-status");

    root.addEventListener("mousemove", ev => {
      const rect = root.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = ev.clientX - cx;
      const dy = ev.clientY - cy;
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      this._angleTarget = Math.max(-65, Math.min(65, ang));
    });

    root.addEventListener("mousedown", () => this._mouseDown = true);
    root.addEventListener("mouseup", () => this._mouseDown = false);

    this._loop();
  }

  _loop() {
    const tick = () => {
      this._step(0.016);
      this._renderFrame();
      if (!this.state.solved && !this.state.failed)
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _step(dt) {
    const s = this.state;
    if (s.solved || s.failed) return;

    s.time -= dt;
    if (s.time <= 0) {
      s.failed = true;
      this._status("Failed (Time)");
      return;
    }

    s.pickAngle += (this._angleTarget - s.pickAngle) * 0.2;

    const diff = Math.abs(s.pickAngle - s.sweetCenter);
    const inBand = diff <= (s.sweetWidth / 2);

    if (this._mouseDown) {
      if (inBand) {
        s.cylinderAngle += 40 * dt;
      } else {
        s.cylinderAngle += 3 * dt;
        s.stress += (5 + diff) * dt;
      }
    } else {
      s.cylinderAngle -= 35 * dt;
    }

    s.cylinderAngle = Math.max(0, Math.min(90, s.cylinderAngle));
    s.stress = Math.min(100, s.stress);

    if (s.stress >= 100) {
      s.failed = true;
      this._status("Pick Broke");
    }

    if (s.cylinderAngle >= 90) {
      s.solved = true;
      this._status("Unlocked!");
    }
  }

  _renderFrame() {
    const s = this.state;

    this.$pick.style.transform = `rotate(${s.pickAngle}deg)`;
    this.$cyl.style.transform = `rotate(${s.cylinderAngle}deg)`;
    this.$stress.style.transform = `scaleX(${s.stress / 100})`;
    this.$time.style.transform = `scaleX(${s.time / 30})`;
  }

  _status(text) {
    if (this.$status) this.$status.innerText = text;
  }
}