// MAIN-world half of the override, injected at document_start before any page script.
// Page writes to `volume` are kept as the page's virtual value and read back unchanged; the real
// element volume and a master gain in front of every AudioContext destination follow our level.
// With no level for the site everything passes through (real === virtual, gain 1).
// The isolated content script (content.ts) owns storage and messaging and pushes the level here.

import { EQ_BANDS, type Fx } from './lib/rules';

// Captured before page code runs, so later page patches can't intercept or break us.
const call = Reflect.apply;
const gopd = Reflect.getOwnPropertyDescriptor;
const define = Reflect.defineProperty;
const { parse, stringify } = JSON;
const Custom = CustomEvent;
const Ev = Event;
const listen = EventTarget.prototype.addEventListener;
const unlisten = EventTarget.prototype.removeEventListener;
const dispatch = EventTarget.prototype.dispatchEvent;
const detailOf = gopd(CustomEvent.prototype, 'detail')!.get!;
const Observer = MutationObserver;
const observe = MutationObserver.prototype.observe;
const fnToString = Function.prototype.toString;
const Media = HTMLMediaElement;
const vol = gopd(Media.prototype, 'volume')!;
const play = Media.prototype.play;
const attachShadow = Element.prototype.attachShadow;
const Ctx = AudioContext;
const Offline = OfflineAudioContext;
const Dest = AudioDestinationNode;
const connect = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => unknown;
const disconnect = AudioNode.prototype.disconnect as (this: AudioNode, ...a: unknown[]) => unknown;
const contextOf = gopd(AudioNode.prototype, 'context')!.get!;
const destinationOf = gopd(BaseAudioContext.prototype, 'destination')!.get!;
const createGain = BaseAudioContext.prototype.createGain;
const createSource = AudioContext.prototype.createMediaElementSource;
const gainOf = gopd(GainNode.prototype, 'gain')!.get!;
const setParam = gopd(AudioParam.prototype, 'value')!.set!;
const scratch = document.createElement('audio'); // validates page writes exactly like the real setter
const pause = Media.prototype.pause;
const createBiquad = BaseAudioContext.prototype.createBiquadFilter;
const createComp = BaseAudioContext.prototype.createDynamicsCompressor;
const createPanner = BaseAudioContext.prototype.createStereoPanner;
const getter = (proto: object, name: string) => gopd(proto, name)!.get!;
const setter = (proto: object, name: string) => gopd(proto, name)!.set!;
const bq = { frequency: getter(BiquadFilterNode.prototype, 'frequency'), gain: getter(BiquadFilterNode.prototype, 'gain'), Q: getter(BiquadFilterNode.prototype, 'Q') };
const bqType = setter(BiquadFilterNode.prototype, 'type');
const dc: Record<string, (this: unknown) => AudioParam> = Object.fromEntries(
  ['threshold', 'knee', 'ratio', 'attack', 'release'].map((n) => [n, getter(DynamicsCompressorNode.prototype, n) as () => AudioParam]),
);
const panOf = getter(StereoPannerNode.prototype, 'pan');
const setCount = setter(AudioNode.prototype, 'channelCount');
const setCountMode = setter(AudioNode.prototype, 'channelCountMode');
const setInterp = setter(AudioNode.prototype, 'channelInterpretation');
const userActivation = gopd(Navigator.prototype, 'userActivation')?.get;
const hasBeenActive = gopd(UserActivation.prototype, 'hasBeenActive')?.get;
/** True once the user has clicked or pressed a key on this page; autoplay is "unprompted" before that. */
const activated = () => (userActivation && hasBeenActive ? !!call(hasBeenActive, call(userActivation, navigator, []), []) : true);

const realGet = (el: HTMLMediaElement): number => call(vol.get!, el, []);
const realSet = (el: HTMLMediaElement, v: number) => call(vol.set!, el, [v]);

let pending = true; // no level yet: hold real output silent instead of risking a blast
let level: number | null = null; // percent; null = pass through
let fx: Fx | null = null; // sound effects for this site, null = none
let block = false; // pause media that starts before any user activation
const controlled = () => pending || level !== null;

const seen = new WeakSet<HTMLMediaElement>();
const tracked = new Set<WeakRef<HTMLMediaElement>>();
const virtual = new WeakMap<HTMLMediaElement, number>();
const routed = new WeakSet<HTMLMediaElement>(); // goes through an AudioContext, so the master gain carries the level
const encrypted = new WeakSet<HTMLMediaElement>();
const stages = new WeakMap<BaseAudioContext, Stage>();
const stageList: WeakRef<Stage>[] = [];
let ours: AudioContext | undefined; // private context for boosting plain elements
let reported = false;

// ---------- level channel ----------

let key = '';
const up = (data: unknown) => key && call(dispatch, window, [new Custom(key + ':up', { detail: stringify(data) })]);

function onKey(e: Event) {
  const k = call(detailOf, e, []);
  if (typeof k !== 'string' || key) return;
  key = k;
  call(unlisten, window, ['svs:key', onKey]); // first key wins; later page spoofs are ignored
  call(listen, window, [key, onMessage]);
  up({ ready: true });
}

/** After an extension update this copy can't be replaced; the orphaned isolated script hands it the new key. */
function rekey(k: string) {
  call(unlisten, window, [key, onMessage]);
  key = k;
  call(listen, window, [key, onMessage]);
  up({ ready: true });
}

function onMessage(e: Event) {
  const msg = parse(call(detailOf, e, []));
  if ('level' in msg) {
    fx = msg.fx ?? null;
    block = msg.block === true;
    setLevel(msg.level, msg.sync === true);
  }
  if (msg.probe) up({ probe: probe() });
  if (typeof msg.rekey === 'string') rekey(msg.rekey);
}

/** `sync`: the user moved the level from the extension, so the page's own volume (YouTube's slider) follows it. */
function setLevel(l: number | null, sync = false) {
  pending = false;
  level = l;
  reported = false;
  for (const ref of tracked) {
    const el = ref.deref();
    if (el && sync && l !== null) {
      const v = Math.min(l, 100) / 100;
      const old = virtual.get(el);
      virtual.set(el, v);
      if (old !== v) call(dispatch, el, [new Ev('volumechange')]);
    }
    if (el) apply(el);
    else tracked.delete(ref);
  }
  for (const ref of stageList) {
    const st = ref.deref();
    if (st) configure(st);
  }
}

/** Test seam, reachable only through the secret channel. */
const probe = () => ({
  els: [...tracked].flatMap((r) => {
    const el = r.deref();
    return el ? [{ id: el.id, real: realGet(el), virtual: virtual.get(el), routed: routed.has(el) }] : [];
  }),
  gains: stageList.flatMap((r) => {
    const st = r.deref();
    return st ? [Math.round(st.input.gain.value * 1000) / 1000] : []; // float32 param
  }),
  chains: stageList.flatMap((r) => r.deref()?.wired ?? []),
});

// ---------- media elements ----------

/** Web Audio outputs silence for DRM and for cross-origin media fetched without CORS; undefined = not loaded yet. */
function boostable(el: HTMLMediaElement): boolean | undefined {
  if (el.mediaKeys || encrypted.has(el)) return false;
  if (!el.currentSrc) return undefined;
  if (el.crossOrigin !== null) return true; // CORS request: if it loaded, it's readable
  const url = new URL(el.currentSrc, location.href);
  return url.protocol === 'data:' || url.origin === location.origin; // blob: carries its creator's origin
}

/** Element volume tops out at 1, so above 100% the element goes through our context's master gain. Permanent. */
function route(el: HTMLMediaElement, boosting: boolean) {
  const ok = boostable(el);
  if (ok === undefined) return;
  if (!ok) {
    if (boosting && !reported) up({ needsCapture: true }); // only tab capture can boost this one; effects just skip it
    reported = boosting || reported;
    return;
  }
  ours ??= new Ctx();
  if (ours.state !== 'running') {
    // A suspended context would mute the element until the page gets a click, so wait until it runs.
    if (!resuming) {
      resuming = true;
      call(listen, ours, ['statechange', () => ours!.state === 'running' && sweep()]);
      void ours.resume();
    }
    return;
  }
  try {
    call(connect, call(createSource, ours, [el]), [master(ours)]);
  } catch {
    // InvalidStateError: the page already routed it (e.g. `new MediaElementAudioSourceNode`)
  }
  routed.add(el);
}
let resuming = false;
/** Re-applies the level to every tracked element, e.g. once the private context is allowed to run. */
function sweep() {
  for (const ref of tracked) {
    const el = ref.deref();
    if (el) apply(el);
    else tracked.delete(ref);
  }
}

const target = (el: HTMLMediaElement) =>
  pending ? 0 : level === null ? virtual.get(el)! : routed.has(el) ? 1 : Math.min(level, 100) / 100;

function apply(el: HTMLMediaElement) {
  if (!pending && !routed.has(el)) {
    const boosting = level !== null && level > 100;
    if (boosting || fx) route(el, boosting);
  }
  const v = target(el);
  if (realGet(el) !== v) realSet(el, v);
}

// Backstop for writes that bypass our setter (another realm's native setter, an older copy of the
// extension still running after an update): put the real volume back, at most 5 times a second.
const restores = new WeakMap<HTMLMediaElement, { n: number; since: number }>();
function mayRestore(el: HTMLMediaElement): boolean {
  const now = performance.now();
  let r = restores.get(el);
  if (!r || now - r.since > 1000) restores.set(el, (r = { n: 0, since: now }));
  return ++r.n <= 5;
}

/** Media that starts before the user did anything on this page, on a site that blocks autoplay. */
function stopAutoplay(el: Element): boolean {
  if (!block || !(el instanceof Media) || activated()) return false;
  call(pause, el, []);
  return true;
}

function onMediaEvent(this: HTMLMediaElement, e: Event) {
  if (e.type === 'play' && stopAutoplay(this)) return;
  if (e.type === 'encrypted') encrypted.add(this);
  if (e.type === 'volumechange' && (realGet(this) === target(this) || !mayRestore(this))) return;
  apply(this);
}

function track(el: HTMLMediaElement) {
  if (seen.has(el)) return;
  seen.add(el);
  virtual.set(el, realGet(el));
  tracked.add(new WeakRef(el));
  for (const t of ['play', 'loadedmetadata', 'encrypted', 'volumechange']) call(listen, el, [t, onMediaEvent]);
  apply(el);
}

// ---------- discovery: DOM, open and closed shadow roots ----------

const observer = new Observer((records) => {
  for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) scan(n);
});

function watch(root: Document | ShadowRoot) {
  call(observe, observer, [root, { childList: true, subtree: true }]);
  call(listen, root, ['play', (e: Event) => e.target instanceof Media && !stopAutoplay(e.target) && track(e.target), true]);
}

/** Tracks media under root, descending into open shadow roots made by the parser. */
function scan(root: Element | Document | ShadowRoot) {
  const els = root instanceof Element ? [root, ...root.querySelectorAll('*')] : root.querySelectorAll('*');
  for (const el of els) {
    if (el instanceof Media) track(el);
    if (el.shadowRoot && !seenRoots.has(el.shadowRoot)) {
      seenRoots.add(el.shadowRoot);
      watch(el.shadowRoot);
      scan(el.shadowRoot);
    }
  }
}
const seenRoots = new WeakSet<ShadowRoot>();

// ---------- Web Audio ----------

const gainValue = () => (pending ? 0 : level === null ? 1 : level / 100);
const set = (param: AudioParam, v: number) => call(setParam, param, [v]);

/**
 * Everything the page plays through one context goes input (level) -> [EQ] -> [leveler] -> [mono] -> [balance]
 * -> [limiter] -> destination. Nodes in brackets exist and are wired only while they have a job, so a site
 * without effects or boost costs one gain node, as before.
 */
interface Stage {
  ctx: BaseAudioContext;
  input: GainNode;
  eq?: BiquadFilterNode[];
  leveler?: DynamicsCompressorNode;
  mono?: GainNode;
  pan?: StereoPannerNode;
  limiter?: DynamicsCompressorNode;
  wired: string[];
}

const EQ_TYPES = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];
const comp = (ctx: BaseAudioContext, v: [number, number, number, number, number]) => {
  const n = call(createComp, ctx, []) as DynamicsCompressorNode;
  ['threshold', 'knee', 'ratio', 'attack', 'release'].forEach((name, i) => set(call(dc[name], n, []), v[i]));
  return n;
};

function configure(st: Stage) {
  const { ctx } = st;
  set(call(gainOf, st.input, []), gainValue());
  const want: [string, AudioNode][] = [];
  if (fx && fx.eq.some((g) => g !== 0)) {
    st.eq ??= EQ_BANDS.map((f, i) => {
      const n = call(createBiquad, ctx, []) as BiquadFilterNode;
      call(bqType, n, [EQ_TYPES[i]]);
      set(call(bq.frequency, n, []), f);
      set(call(bq.Q, n, []), 1);
      return n;
    });
    st.eq.forEach((n, i) => set(call(bq.gain, n, []), fx!.eq[i]));
    st.eq.forEach((n, i) => want.push(['eq' + i, n]));
  }
  if (fx?.leveler) want.push(['leveler', (st.leveler ??= comp(ctx, [-32, 24, 8, 0.01, 0.25]))]);
  if (fx?.mono) {
    if (!st.mono) {
      st.mono = call(createGain, ctx, []) as GainNode;
      call(setCount, st.mono, [1]);
      call(setCountMode, st.mono, ['explicit']);
      call(setInterp, st.mono, ['speakers']);
    }
    want.push(['mono', st.mono]);
  }
  if (fx && fx.balance !== 0) {
    st.pan ??= call(createPanner, ctx, []) as StereoPannerNode;
    set(call(panOf, st.pan, []), fx.balance / 100);
    want.push(['pan', st.pan]);
  }
  if (!pending && level !== null && level > 100) want.push(['limiter', (st.limiter ??= comp(ctx, [-2, 0, 20, 0.002, 0.08]))]);

  const names = want.map((w) => w[0]);
  if (names.join() === st.wired.join()) return;
  const chain = [st.input, ...want.map((w) => w[1])];
  for (const n of chain) call(disconnect, n, []);
  chain.forEach((n, i) => call(connect, n, [i + 1 < chain.length ? chain[i + 1] : call(destinationOf, ctx, [])]));
  st.wired = names;
}

/** The stage's input gain, which stands in for the context's destination. */
function master(ctx: BaseAudioContext): GainNode {
  let st = stages.get(ctx);
  if (!st) {
    st = { ctx, input: call(createGain, ctx, []) as GainNode, wired: [] };
    call(connect, st.input, [call(destinationOf, ctx, [])]);
    stages.set(ctx, st);
    stageList.push(new WeakRef(st));
    configure(st);
  }
  return st.input;
}

/** Page connections to a realtime destination go to that context's master gain instead. */
function mapDest(node: unknown): unknown {
  if (!(node instanceof Dest)) return node;
  const ctx = call(contextOf, node, []) as BaseAudioContext;
  return ctx instanceof Offline ? node : master(ctx);
}

// ---------- patches ----------

const fakes = new WeakMap<object, unknown>(); // our function -> the native it replaces, for toString

function patch(proto: object, name: string, impl: PropertyDescriptor) {
  const native = gopd(proto, name)!;
  for (const k of ['get', 'set', 'value'] as const) if (impl[k]) fakes.set(impl[k], native[k]);
  define(proto, name, { ...native, ...impl });
}

function install() {
  const volumeImpl = {
    get volume() {
      const el = this as unknown as HTMLMediaElement;
      const real = realGet(el); // throws Illegal invocation like the native getter
      track(el);
      return controlled() ? virtual.get(el)! : real;
    },
    set volume(v: number) {
      const el = this as unknown as HTMLMediaElement;
      if (controlled()) {
        realGet(el); // brand check
        call(vol.set!, scratch, [v]); // throws IndexSizeError/TypeError like the native setter
        v = realGet(scratch);
      } else {
        realSet(el, v);
        v = realGet(el);
      }
      track(el);
      const old = virtual.get(el);
      virtual.set(el, v);
      apply(el);
      if (controlled() && old !== v) call(dispatch, el, [new Ev('volumechange')]); // what the page would see natively
    },
  };
  const volumeDesc = gopd(volumeImpl, 'volume')!;
  patch(Media.prototype, 'volume', { get: volumeDesc.get, set: volumeDesc.set });

  patch(Media.prototype, 'play', {
    value: {
      play(this: HTMLMediaElement) {
        if (this instanceof Media) track(this); // catches detached media like `new Audio()`
        return call(play, this, []);
      },
    }.play,
  });

  patch(Element.prototype, 'attachShadow', {
    value: {
      attachShadow(this: Element, init: ShadowRootInit) {
        const root = call(attachShadow, this, [init]) as ShadowRoot;
        seenRoots.add(root);
        watch(root); // closed roots are only reachable here
        return root;
      },
    }.attachShadow,
  });

  patch(AudioContext.prototype, 'createMediaElementSource', {
    value: {
      createMediaElementSource(this: AudioContext, el: HTMLMediaElement) {
        const node = call(createSource, this, [el]);
        routed.add(el);
        track(el);
        apply(el);
        return node;
      },
    }.createMediaElementSource,
  });

  patch(AudioNode.prototype, 'connect', {
    value: {
      connect(this: AudioNode, dest: unknown, ...rest: unknown[]) {
        const mapped = mapDest(dest);
        const args = [mapped];
        for (let i = 0; i < rest.length; i++) args[i + 1] = rest[i];
        const r = call(connect, this, args);
        return r === mapped ? dest : r; // the page gets back the node it passed
      },
    }.connect,
  });

  patch(AudioNode.prototype, 'disconnect', {
    value: {
      disconnect(this: AudioNode, ...args: unknown[]) {
        if (args.length) args[0] = mapDest(args[0]);
        return call(disconnect, this, args);
      },
    }.disconnect,
  });

  patch(Function.prototype, 'toString', {
    value: {
      toString(this: unknown) {
        return call(fnToString, fakes.get(this as object) ?? this, []);
      },
    }.toString,
  });
  fakes.set(Function.prototype.toString, fnToString);

  call(listen, window, ['svs:key', onKey]);
  call(dispatch, window, [new Custom('svs:hello')]); // covers the isolated script having run first
  watch(document);
  scan(document); // media already there when injected into an open tab
  // Isolated script never answered (it failed to load): stop holding, pass through.
  setTimeout(() => {
    call(unlisten, window, ['svs:key', onKey]);
    if (pending) setLevel(null);
  }, 1500);
}

// ---------- start ----------

// A copy from before an extension update may still be running in this page; it keeps the job.
// Only late injection into open tabs can meet one, and only then could a page fake the answer.
const existing = new Custom('svs:main', { cancelable: true });
call(dispatch, window, [existing]);
if (!existing.defaultPrevented) {
  call(listen, window, ['svs:main', (e: Event) => e.preventDefault()]);
  install();
}

export {}; // module scope, nothing leaks into the page's globals
