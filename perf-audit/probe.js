// Injected via Page.addScriptToEvaluateOnNewDocument BEFORE any app code runs.
// Installs: (a) a minimal React DevTools hook that counts commits per root and
// per fiber type, (b) a rAF frame sampler, (c) a fetch/XHR tap, (d) observer
// leak counters.
(() => {
  if (window.__perf) return;
  const P = window.__perf = {
    commits: 0,
    committedTypes: Object.create(null),
    frames: [],
    sampling: false,
    net: [],
    inflightMax: 0,
    inflight: 0,
    obs: { resize: 0, mutation: 0, intersection: 0, resizeDisc: 0, mutationDisc: 0, intersectionDisc: 0 },
    timers: { interval: 0, intervalCleared: 0 },
    marks: {},
  };

  // ---- (a) React commit counter -------------------------------------------
  if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    const renderers = new Map();
    let uid = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers,
      supportsFiber: true,
      isDisabled: false,
      inject(r) { const id = ++uid; renderers.set(id, r); return id; },
      onCommitFiberRoot(_id, root) {
        P.commits++;
        if (!P.countTypes) return;
        // Walk the committed tree cheaply: only count fibers with an
        // actualDuration (profiling build) or a displayName we care about.
        try {
          const seen = P.committedTypes;
          const walk = (fiber, depth) => {
            if (!fiber || depth > 200) return;
            const t = fiber.type;
            const name = typeof t === 'function' ? (t.displayName || t.name)
              : (t && typeof t === 'object' && (t.displayName || (t.render && (t.render.displayName || t.render.name)))) || null;
            if (name) seen[name] = (seen[name] || 0) + 1;
            if (fiber.child) walk(fiber.child, depth + 1);
            if (fiber.sibling) walk(fiber.sibling, depth);
          };
          walk(root.current.child, 0);
        } catch {}
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  }

  // ---- (b) frame sampler ---------------------------------------------------
  P.startFrames = () => { P.frames = []; P.sampling = true; let last = performance.now();
    const tick = (now) => { if (!P.sampling) return; P.frames.push(now - last); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick); };
  P.stopFrames = () => { P.sampling = false; const f = P.frames.slice(1); f.sort((a,b)=>a-b);
    const q = p => f.length ? +f[Math.min(f.length-1, Math.floor(f.length*p))].toFixed(2) : null;
    return { n: f.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: f.length? +f[f.length-1].toFixed(2):null,
             over33: f.filter(x=>x>33).length, over50: f.filter(x=>x>50).length }; };

  // ---- (c) network tap -----------------------------------------------------
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
    const method = (args[1] && args[1].method) || (args[0] && args[0].method) || 'GET';
    const t0 = performance.now();
    P.inflight++; if (P.inflight > P.inflightMax) P.inflightMax = P.inflight;
    const done = (status) => { P.inflight--; P.net.push({ url, method, ms: +(performance.now()-t0).toFixed(1), t0: +t0.toFixed(1), status }); };
    return origFetch.apply(this, args).then(r => { done(r.status); return r; }, e => { done(-1); throw e; });
  };
  const OX = window.XMLHttpRequest;
  if (OX) {
    const open = OX.prototype.open, send = OX.prototype.send;
    OX.prototype.open = function (m, u) { this.__pm = m; this.__pu = u; return open.apply(this, arguments); };
    OX.prototype.send = function () { const t0 = performance.now(); P.inflight++; if (P.inflight>P.inflightMax) P.inflightMax=P.inflight;
      this.addEventListener('loadend', () => { P.inflight--; P.net.push({ url: this.__pu, method: this.__pm, ms: +(performance.now()-t0).toFixed(1), t0: +t0.toFixed(1), status: this.status, xhr: true }); });
      return send.apply(this, arguments); };
  }

  // ---- (d) observer / timer leak counters ----------------------------------
  const wrapObs = (Ctor, key, discKey) => {
    if (!window[Ctor]) return;
    const Orig = window[Ctor];
    const Wrapped = function (...a) { const inst = new Orig(...a); P.obs[key]++;
      const d = inst.disconnect.bind(inst); inst.disconnect = function () { P.obs[discKey]++; return d(); }; return inst; };
    Wrapped.prototype = Orig.prototype;
    window[Ctor] = Wrapped;
  };
  wrapObs('ResizeObserver', 'resize', 'resizeDisc');
  wrapObs('MutationObserver', 'mutation', 'mutationDisc');
  wrapObs('IntersectionObserver', 'intersection', 'intersectionDisc');

  const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function (...a) { P.timers.interval++; return si.apply(this, a); };
  window.clearInterval = function (...a) { P.timers.intervalCleared++; return ci.apply(this, a); };
})();
