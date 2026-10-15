// Rotary volume knob with a 24-bar visualizer ring. Styles live in knob.css (link it next to the page CSS).

export type KnobOptions = {
  value: number;
  max: number;
  step?: number;
  label?: string;
  onInput(v: number): void;
  onChange(v: number): void;
};

export type Knob = {
  setValue(v: number, animate?: boolean): void;
  setMax(max: number): void;
  setLevels(levels: number[]): void;
  setIdle(): void;
  setDisabled(d: boolean): void;
  destroy(): void;
};

const SWEEP = 270; // degrees, gap at the bottom
const START = -SWEEP / 2; // angle of 0, clockwise from 12 o'clock
const BARS = 24;
const TRACK_R = 72;
const BAR_IN = 83;
const BAR_MIN = 2.5;
const BAR_MAX = 15;
const WHEEL_SETTLE_MS = 300;
const NS = 'http://www.w3.org/2000/svg';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const polar = (deg: number, r: number) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export function createKnob(host: HTMLElement, opts: KnobOptions): Knob {
  const step = opts.step ?? 1;
  let max = opts.max;
  let value = clamp(Math.round(opts.value), 0, max);
  let disabled = false;

  // ---------- DOM ----------
  const root = document.createElement('div');
  root.className = 'knob';
  root.tabIndex = 0;
  root.setAttribute('role', 'slider');
  root.setAttribute('aria-label', opts.label ?? 'Volume');
  root.setAttribute('aria-valuemin', '0');

  const [sx, sy] = polar(START, TRACK_R);
  const arc = `M ${sx} ${sy} A ${TRACK_R} ${TRACK_R} 0 1 1 ${-sx} ${sy}`;
  const ring = svg('svg', { class: 'knob-ring', viewBox: '-100 -100 200 200', 'aria-hidden': 'true' });
  const barGroup = svg('g', { class: 'knob-bars' });
  const bars = Array.from({ length: BARS }, (_, i) => {
    const [x1, y1] = polar((i * 360) / BARS, BAR_IN);
    const line = svg('line', { x1, y1, x2: x1, y2: y1 });
    barGroup.append(line);
    return line;
  });
  const track = svg('path', { class: 'knob-track', d: arc, pathLength: SWEEP });
  const fill = svg('path', { class: 'knob-fill', d: arc, pathLength: SWEEP });
  const hot = svg('path', { class: 'knob-hot', d: arc, pathLength: SWEEP });
  const mark = svg('line', { class: 'knob-mark' });
  ring.append(barGroup, track, fill, hot, mark);

  const press = document.createElement('div');
  press.className = 'knob-press';
  press.innerHTML = '<div class="knob-body"><div class="knob-dial"><span class="knob-dot"></span></div></div><div class="knob-num" aria-hidden="true"><span class="knob-n"></span><span class="knob-pct">%</span></div>';
  const dial = press.querySelector<HTMLElement>('.knob-dial')!;
  const num = press.querySelector<HTMLElement>('.knob-n')!;
  root.append(ring, press);
  host.append(root);

  // ---------- drawing ----------
  const angleOf = (v: number) => START + (v / max) * SWEEP;
  let shown = value; // the drawn value; springs toward `value`
  let velocity = 0;
  let shownText = '';

  function drawValue() {
    const v = clamp(shown, 0, max);
    const deg = (v / max) * SWEEP;
    const deg100 = (Math.min(100, max) / max) * SWEEP;
    fill.style.strokeDasharray = `${Math.min(deg, deg100)} 999`;
    hot.style.strokeDasharray = `${Math.max(0, deg - deg100)} 999`;
    hot.style.strokeDashoffset = `${-deg100}`;
    root.classList.toggle('is-hot', deg > deg100 + 0.01);
    dial.style.transform = `rotate(${angleOf(v)}deg)`;
    const text = String(Math.round(v));
    if (text !== shownText) num.textContent = shownText = text;
  }

  function drawStatic() {
    root.setAttribute('aria-valuemax', String(max));
    root.setAttribute('aria-valuenow', String(value));
    root.setAttribute('aria-valuetext', `${value}%`);
    const boost = max > 100;
    root.classList.toggle('is-boost', boost);
    const [x1, y1] = polar(angleOf(100), TRACK_R - 8);
    const [x2, y2] = polar(angleOf(100), TRACK_R + 8);
    mark.setAttribute('x1', String(x1));
    mark.setAttribute('y1', String(y1));
    mark.setAttribute('x2', String(x2));
    mark.setAttribute('y2', String(y2));
    mark.classList.toggle('is-on', boost);
  }

  // ---------- levels ----------
  const target = new Float32Array(BARS);
  const level = new Float32Array(BARS);
  let barsDirty = true;

  function drawBars() {
    for (let i = 0; i < BARS; i++) {
      const [x, y] = polar((i * 360) / BARS, BAR_IN + BAR_MIN + (level[i] / 255) * (BAR_MAX - BAR_MIN));
      bars[i].setAttribute('x2', x.toFixed(2));
      bars[i].setAttribute('y2', y.toFixed(2));
    }
  }

  // ---------- animation loop: value spring + bar smoothing, sleeps when settled ----------
  let raf = 0;
  let last = 0;
  function frame(now: number) {
    raf = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000 || 1 / 60);
    last = now;
    let busy = false;
    if (shown !== value || velocity !== 0) {
      // damped spring: stiffness 260, damping 24 gives a small overshoot
      velocity += ((value - shown) * 260 - velocity * 24) * dt;
      shown += velocity * dt;
      if (Math.abs(value - shown) < 0.05 && Math.abs(velocity) < 0.5) {
        shown = value;
        velocity = 0;
      } else busy = true;
      drawValue();
    }
    if (barsDirty) {
      barsDirty = false;
      const instant = reduced();
      const k = instant ? 1 : 1 - Math.exp(-dt * 18); // attack
      const r = instant ? 1 : 1 - Math.exp(-dt * 7); // release
      for (let i = 0; i < BARS; i++) {
        const d = target[i] - level[i];
        if (Math.abs(d) < 0.5) level[i] = target[i];
        else {
          level[i] += d * (d > 0 ? k : r);
          barsDirty = true;
        }
      }
      drawBars();
      busy ||= barsDirty;
    }
    if (busy) schedule();
    else last = 0;
  }
  const schedule = () => (raf ||= requestAnimationFrame(frame));

  function show(animate: boolean) {
    drawStatic();
    if (animate && !reduced()) return schedule();
    shown = value;
    velocity = 0;
    drawValue();
  }

  // ---------- input ----------
  /** User-driven change: updates value and reports it. */
  function commit(v: number, animate: boolean, final: boolean) {
    const next = clamp(Math.round(v), 0, max);
    const changed = next !== value;
    value = next;
    if (changed) {
      show(animate);
      opts.onInput(value);
    }
    if (final) opts.onChange(value);
  }

  let dragging = false;
  let cx = 0;
  let cy = 0;
  let lastAngle = 0;
  let lastY = 0;
  let radius = 0;
  let vertical = false; // grabbed near the center, where angles are noisy: drag like a fader
  let raw = 0; // unclamped drag value so the indicator never jumps across the gap
  const pointerAngle = (e: PointerEvent) => (Math.atan2(e.clientX - cx, cy - e.clientY) * 180) / Math.PI;

  root.addEventListener('pointerdown', (e) => {
    if (disabled || e.button !== 0) return;
    const r = root.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    radius = r.width / 2; // cached so moves never read layout
    vertical = Math.hypot(e.clientX - cx, e.clientY - cy) < radius * 0.3;
    lastAngle = pointerAngle(e);
    lastY = e.clientY;
    raw = value;
    dragging = true;
    root.setPointerCapture(e.pointerId);
    root.classList.add('is-pressed');
    root.focus({ preventScroll: true });
    e.preventDefault();
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const a = pointerAngle(e);
    raw += vertical
      ? ((lastY - e.clientY) / (radius * 2)) * max
      : ((((a - lastAngle + 540) % 360) - 180) / SWEEP) * max; // angle delta wrapped into [-180, 180)
    lastAngle = a;
    lastY = e.clientY;
    raw = clamp(raw, -max * 0.25, max * 1.25); // a little slack past the ends, no runaway
    commit(raw, false, false);
  });
  const release = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('is-pressed');
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    opts.onChange(value);
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  let wheelTimer = 0;
  root.addEventListener(
    'wheel',
    (e) => {
      if (disabled || e.deltaY === 0) return;
      e.preventDefault();
      commit(value + (e.deltaY < 0 ? step : -step), true, false);
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => opts.onChange(value), WHEEL_SETTLE_MS);
    },
    { passive: false },
  );

  let keyHeld = false;
  root.addEventListener('keydown', (e) => {
    if (disabled) return;
    const by = (d: number) => value + d;
    const next: Record<string, number> = {
      ArrowUp: by(step), ArrowRight: by(step), ArrowDown: by(-step), ArrowLeft: by(-step),
      PageUp: by(10), PageDown: by(-10), Home: 0, End: max,
    };
    if (!(e.key in next)) return;
    e.preventDefault();
    keyHeld = true;
    commit(next[e.key], true, false);
  });
  root.addEventListener('keyup', () => {
    if (keyHeld) opts.onChange(value);
    keyHeld = false;
  });

  // ---------- init ----------
  show(false);
  drawBars();

  return {
    setValue(v, animate = false) {
      if (dragging) return; // the user's hand wins over echoes from storage
      value = clamp(Math.round(v), 0, max);
      show(animate);
    },
    setMax(m) {
      max = m;
      value = clamp(value, 0, max);
      show(false);
    },
    setLevels(levels) {
      if (reduced()) return; // static ring
      for (let i = 0; i < BARS; i++) target[i] = clamp(levels[i] ?? 0, 0, 255);
      barsDirty = true;
      schedule();
    },
    setIdle() {
      target.fill(0);
      barsDirty = true;
      schedule();
    },
    setDisabled(d) {
      disabled = d;
      root.tabIndex = d ? -1 : 0;
      root.setAttribute('aria-disabled', String(d));
      root.classList.toggle('is-disabled', d);
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      root.remove();
    },
  };
}
