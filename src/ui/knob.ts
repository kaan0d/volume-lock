// Placeholder with the contract API; replaced by the knob agent's version.
export interface KnobOpts { value: number; max: number; step?: number; onInput(v: number): void; onChange(v: number): void }
export function createKnob(host: HTMLElement, o: KnobOpts) {
  let { value, max } = o;
  const step = o.step ?? 5;
  const el = document.createElement('div');
  el.className = 'knob';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', 'Volume');
  el.setAttribute('aria-valuemin', '0');
  const num = document.createElement('span');
  num.className = 'knob-value';
  el.append(num);
  host.append(el);
  const paint = () => {
    num.textContent = `${value}%`;
    el.setAttribute('aria-valuenow', String(value));
    el.setAttribute('aria-valuemax', String(max));
    el.setAttribute('aria-valuetext', `${value}%`);
  };
  const set = (v: number) => { value = Math.min(max, Math.max(0, v)); paint(); o.onInput(value); o.onChange(value); };
  el.addEventListener('keydown', (e) => {
    if (el.getAttribute('aria-disabled') === 'true') return;
    const to: Record<string, number> = { ArrowUp: value + step, ArrowRight: value + step, ArrowDown: value - step, ArrowLeft: value - step, PageUp: value + 10, PageDown: value - 10, Home: 0, End: max };
    if (!(e.key in to)) return;
    e.preventDefault();
    set(to[e.key]);
  });
  paint();
  return {
    setValue(v: number, _animate?: boolean) { value = Math.min(max, Math.max(0, v)); paint(); },
    setMax(m: number) { max = m; value = Math.min(value, max); paint(); },
    setLevels(_l: number[]) {},
    setIdle() {},
    setDisabled(d: boolean) { el.setAttribute('aria-disabled', String(d)); el.tabIndex = d ? -1 : 0; },
    destroy() { el.remove(); },
  };
}
