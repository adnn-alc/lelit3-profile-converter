// Turns a profile into a pressure / flow / weight curve over time.
//
// Profiles describe intent ("2 ml/s until 4 bar"), not what the gauge shows,
// so we run them against a simple puck: an empty basket that first has to
// fill, then a resistance that builds as the puck saturates and slowly
// erodes during the shot. Recorded shots skip all of this and use real data.
(function () {
  const LC = window.LC;

  // Puck constants were fitted to real Decent shots from visualizer.coffee
  // (see test/run.js), which record pressure, flow and weight.
  const DEFAULTS = {
    resistance: 8, // bar the puck pushes back with at 2 ml/s (the grind slider)
    headspace: 30, // ml before the puck starts to resist at all
    fullAt: 64, // ml pumped by the time the puck is fully saturated
    buildScale: 7, // ml; how gradually resistance builds before that
    soakRate: 1.0, // ml/s; a wet puck keeps saturating even with little flow
    erosion: 0.004, // share of resistance lost per second after saturation
    pumpMax: 8, // ml/s the source machine can push
    maxPressure: 12, // bar; source machines cut out above this
    riseTau: 0.4, // s; how fast pressure follows the pump upwards
    fallTau: 2.0, // s; how fast pressure bleeds off through the puck
    dt: 0.05,
    maxTime: 180,
  };

  function valueAt(points, x) {
    if (points.length === 1) return points[0][1];
    return LC.interp(points, x);
  }

  // opts.targetWeight overrides the profile's target (grams in the cup).
  function simulate(profile, opts) {
    const target = opts && opts.targetWeight != null ? opts.targetWeight : null;
    if (profile.recorded) return fromRecording(profile, target);
    if (target != null) profile = Object.assign({}, profile, { targetWeight: target });
    const o = Object.assign({}, DEFAULTS, opts || {});
    const k = o.resistance / 2;
    let t = 0, V = 0, W = 0, P = 0, Q = 0, tSat = null, tWet = null;
    let i = 0;
    const curve = [];
    const stages = [];
    let cur = null;

    while (i < profile.phases.length && t < o.maxTime) {
      const ph = profile.phases[i];
      if (!cur) {
        const live = ph.control === "pressure" ? P : Q;
        cur = {
          phase: ph, name: ph.name, control: ph.control,
          t0: t, v0: V, w0: W, p0: P,
          points: ph.rampFromCurrent ? ph.points.map(([x, y]) => [x, y === null ? live : y]) : ph.points,
          pmin: Infinity, pmax: 0, qSum: 0, n: 0, exit: null,
        };
      }
      const x = ph.over === "weight" ? W - cur.w0 : ph.over === "volume" ? V - cur.v0 : t - cur.t0;
      const target = valueAt(cur.points, x);

      // Puck resistance right now.
      if (tWet === null && V >= o.headspace) tWet = t;
      const Veff = tWet === null ? V : V + o.soakRate * (t - tWet);
      let ke;
      if (V < o.headspace) ke = 0.02;
      else {
        if (tSat === null && Veff >= o.fullAt) tSat = t;
        const build = Math.min(1, Math.exp((Veff - o.fullAt) / o.buildScale));
        const wear = tSat === null ? 1 : Math.max(0.5, 1 - o.erosion * (t - tSat));
        ke = Math.max(0.02, k * build * wear);
      }

      let want;
      // Pressure the profile is really asking for, when the gauge is only
      // lagging because the pump is flat out filling the puck.
      let aim = null;
      if (ph.control === "pressure") {
        Q = Math.min(o.pumpMax, target / ke);
        const pumpBound = Q >= o.pumpMax - 1e-9;
        if (ph.maxFlow != null) Q = Math.min(Q, ph.maxFlow);
        want = Math.min(target, ke * Q);
        if (pumpBound && (ph.maxFlow == null || ph.maxFlow >= o.pumpMax)) aim = target;
      } else {
        Q = ph.control === "power" ? (target > 0 ? LC.interp(LC.PADDLE_TO_FLOW, target) : 0) : Math.max(0, target);
        const cap = Math.min(o.maxPressure, ph.maxPressure != null ? ph.maxPressure : Infinity);
        want = ke * Q;
        if (want > cap) {
          want = cap;
          Q = want / ke;
        }
      }
      P += (want - P) * Math.min(1, o.dt / (want >= P ? o.riseTau : o.fallTau));
      V += Q * o.dt;
      // Water leaves the puck at the rate the pressure pushes it through.
      // Nothing reaches the cup until the puck is close to saturated.
      if (Veff > o.fullAt - 8 && ke > 0.5) W += (P / ke) * o.dt * 0.95;
      t += o.dt;
      curve.push([t, Math.max(0, P), Q, W, aim]);

      cur.pmin = Math.min(cur.pmin, P);
      cur.pmax = Math.max(cur.pmax, P);
      cur.qSum += Q;
      cur.n++;

      const hit = ph.exits.find((e) => {
        let m;
        if (e.type === "time") m = e.relative ? t - cur.t0 : t;
        else if (e.type === "pressure") m = P;
        else if (e.type === "flow") m = Q;
        else if (e.type === "weight") m = e.relative ? W - cur.w0 : W;
        else if (e.type === "volume") m = e.relative ? V - cur.v0 : V;
        else return false;
        return e.op === "<=" ? m <= e.value : m >= e.value;
      });
      const done = profile.targetWeight > 0 && W >= profile.targetWeight;
      if (hit || done || t >= o.maxTime) {
        cur.exit = hit || null;
        closeStage(cur, t, P, stages);
        cur = null;
        i++;
        if (done) break;
      }
    }
    if (cur) closeStage(cur, t, P, stages);
    return { curve, stages, total: t, finalWeight: W, recorded: false };
  }

  function closeStage(cur, t, P, stages) {
    stages.push({
      name: cur.name, control: cur.control, phase: cur.phase,
      t0: cur.t0, t1: t, p0: cur.p0, p1: P,
      pmin: cur.pmin === Infinity ? P : cur.pmin, pmax: cur.pmax,
      qAvg: cur.n ? cur.qSum / cur.n : 0, exit: cur.exit,
    });
  }

  // A different target weight on a recorded shot: stop the real curve where
  // the scale reached it, or carry on at the final pressure and flow rate.
  function retarget(curve, target) {
    if (!(target > 0) || curve.length < 2) return curve;
    const lastW = curve[curve.length - 1][3];
    if (target < lastW - 0.5) {
      const i = curve.findIndex((c) => c[3] >= target);
      return i > 0 ? curve.slice(0, i + 1) : curve;
    }
    if (target <= lastW + 0.5) return curve;
    const end = curve[curve.length - 1];
    const back = curve.filter((c) => c[0] >= end[0] - 5);
    const rate = Math.max(0.5, (end[3] - back[0][3]) / Math.max(1, end[0] - back[0][0]));
    const p = back.reduce((a, c) => a + c[1], 0) / back.length;
    const f = back.reduce((a, c) => a + c[2], 0) / back.length;
    const out = curve.slice();
    const extra = Math.min(120, (target - lastW) / rate);
    for (let dt = 0.25; dt <= extra + 1e-9; dt += 0.25) out.push([end[0] + dt, p, f, lastW + rate * dt]);
    return out;
  }

  function fromRecording(profile, targetWeight) {
    const r = profile.recorded;
    const raw = r.t.map((t, i) => [t, Math.max(0, r.p[i] || 0), r.f[i] || 0, r.w[i] || 0]);
    // The cup keeps dripping after the shot stops, so keep that offset between
    // the last scale reading and the final drink weight.
    const lastRaw = raw.length ? raw[raw.length - 1][3] : 0;
    const drip = LC.clamp((profile.targetWeight || lastRaw) - lastRaw, 0, 5);
    const curve = targetWeight != null ? retarget(raw, targetWeight - drip) : raw;
    const end = curve.length ? curve[curve.length - 1][0] : 0;
    const starts = r.phaseStarts.filter((s) => s < end);
    const named = profile.phases.length === starts.length;
    const stages = starts.map((t0, si) => {
      const t1 = si + 1 < starts.length ? starts[si + 1] : end;
      const pts = curve.filter((c) => c[0] >= t0 && c[0] <= t1);
      const first = pts[0] || [t0, 0, 0, 0];
      const last = pts[pts.length - 1] || first;
      const ph = named ? profile.phases[si] : null;
      return {
        name: ph ? ph.name : null, control: ph ? ph.control : null, phase: ph,
        t0, t1, p0: first[1], p1: last[1],
        pmin: Math.min(...pts.map((c) => c[1]), first[1]),
        pmax: Math.max(...pts.map((c) => c[1]), first[1]),
        qAvg: pts.length ? pts.reduce((a, c) => a + c[2], 0) / pts.length : 0,
        exit: null,
      };
    });
    const lastW = curve.length ? curve[curve.length - 1][3] : 0;
    return { curve, stages, total: end, finalWeight: lastW, recorded: true };
  }

  // A bloom: the original pauses the pump and lets the puck soak. The Lelit
  // does the same with a 0 bar step. Known phases are judged by what they
  // ask for; recorded phases without a matching profile by the data.
  function isBloom(stage, index) {
    if (index === 0) return false;
    const ph = stage.phase;
    if (ph) {
      const v = ph.points.map((p) => p[1]).filter((x) => x !== null);
      const top = v.length ? Math.max(...v) : 0;
      if (ph.maxPressure === 0) return true;
      if (ph.control === "pressure") return top <= 0.3;
      return top <= 0.1;
    }
    return stage.qAvg < 0.3 && (stage.pmax < 1.5 || stage.p1 < stage.p0 - 1);
  }

  // The pressure the Lelit should aim for over time. Identical to the curve,
  // except the opening fill: there the gauge reads ~0 only because the basket
  // is still filling. A 0 bar step would switch the Lelit pump off, so instead
  // we pick the step pressure whose free flow matches the original fill flow.
  function intentCurve(curve, stages) {
    const out = curve.map((c) => [c[0], c[4] != null ? Math.max(c[1], c[4]) : c[1]]);
    // The fill is over once the gauge shows real pressure (a fast fill alone
    // reads ~1.3 bar on a Decent). Low-pressure profiles never get there,
    // so the bar is lowered for them.
    const top = Math.max(0, ...curve.map((c) => c[1]));
    if (top < 0.3) { zeroBlooms(out, stages); return out; }
    const threshold = Math.min(1.5, 0.7 * top);
    let V = 0, end = -1, qSum = 0, qN = 0;
    for (let i = 0; i < curve.length; i++) {
      const [t, p, q] = curve[i];
      if (p >= threshold || V >= DEFAULTS.fullAt) { end = i; break; }
      V += q * (i ? t - curve[i - 1][0] : t);
      if (q > 0.1) { qSum += q; qN++; }
    }
    if (end <= 0) { zeroBlooms(out, stages); return out; }
    // A steep climb straight after the fill (faster than 1 bar/s) is the
    // puck pressurising, not a step of its own: the Lelit ramps by itself.
    let rampEnd = end;
    for (;;) {
      let k = rampEnd;
      while (k < curve.length && curve[k][0] < curve[rampEnd][0] + 0.5) k++;
      if (k >= curve.length || out[k][1] - out[rampEnd][1] <= 0.5) break;
      rampEnd = k;
    }
    // Highest pressure the profile wants in the two seconds after that.
    let ahead = 0;
    for (let i = rampEnd; i < curve.length && curve[i][0] <= curve[rampEnd][0] + 2; i++) ahead = Math.max(ahead, out[i][1]);
    let fillP = ahead;
    if (qN) {
      const minFlow = LC.PRESSURE_TO_FLOW[0][1];
      const q = Math.max(minFlow, qSum / qN);
      // Never fill harder than the pressure that follows, or the Lelit overshoots it.
      fillP = Math.min(LC.interp(LC.invert(LC.PRESSURE_TO_FLOW), q), Math.max(ahead, 0.5));
    }
    fillP = LC.clamp(LC.roundHalf(Math.max(0.5, fillP)), 0.5, LC.LELIT.maxPressure);
    // Fill samples that already carry a pressure target keep it.
    for (let i = 0; i < rampEnd; i++) if (curve[i][4] == null) out[i][1] = fillP;
    zeroBlooms(out, stages);
    return out;
  }

  // During a bloom the gauge drains slowly, but the intent is "pump off".
  function zeroBlooms(out, stages) {
    (stages || []).forEach((s, i) => {
      if (!isBloom(s, i)) return;
      out.forEach((c) => { if (c[0] > s.t0 && c[0] <= s.t1) { c[1] = 0; c[2] = 1; } });
    });
  }

  // What a Lelit running the given steps should roughly show on the gauge.
  function lelitResponse(steps, total) {
    const L = LC.LELIT;
    const dt = 0.1;
    const out = [];
    let t = 0, P = 0, V = 0, si = 0, stepEnd = steps.length ? steps[0].seconds : 0;
    while (t < total && steps.length) {
      while (si < steps.length - 1 && t >= stepEnd) {
        si++;
        stepEnd += steps[si].seconds;
      }
      const target = steps[si].pressure;
      if (V < L.headspace) {
        V += (target > 0 ? LC.interp(LC.PRESSURE_TO_FLOW, target) : 0) * dt;
      } else if (P < target) {
        P = Math.min(target, P + L.riseRate * dt);
      } else {
        P = Math.max(target, P - L.fallRate * dt);
      }
      t += dt;
      out.push([t, P]);
    }
    return out;
  }

  LC.simulate = simulate;
  LC.intentCurve = intentCurve;
  LC.isBloom = isBloom;
  LC.lelitResponse = lelitResponse;
  LC.SIM_DEFAULTS = DEFAULTS;
})();
