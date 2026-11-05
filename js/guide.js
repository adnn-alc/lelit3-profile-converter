// Builds the "by hand with the paddle" guide from the simulated or recorded
// shot. Each phase says where to put the paddle, what the gauge should read,
// and when to move on. The Lelit shows its own shot timer once the paddle opens.
(function () {
  const LC = window.LC;

  function merge(stages, minSeconds) {
    const out = [];
    stages.forEach((s) => {
      const prev = out[out.length - 1];
      if (prev && prev.t1 - prev.t0 < minSeconds) {
        out[out.length - 1] = Object.assign({}, s, {
          t0: prev.t0, p0: prev.p0,
          pmin: Math.min(prev.pmin, s.pmin), pmax: Math.max(prev.pmax, s.pmax),
          qAvg: (prev.qAvg * (prev.t1 - prev.t0) + s.qAvg * (s.t1 - s.t0)) / Math.max(0.01, s.t1 - prev.t0),
          name: s.name || prev.name,
        });
      } else out.push(Object.assign({}, s));
    });
    const last = out[out.length - 1];
    if (out.length > 1 && last.t1 - last.t0 < minSeconds) {
      const prev = out[out.length - 2];
      out.splice(out.length - 2, 2, Object.assign({}, prev, {
        t1: last.t1, p1: last.p1, pmax: Math.max(prev.pmax, last.pmax), pmin: Math.min(prev.pmin, last.pmin),
      }));
    }
    return out;
  }

  function intent(ph) {
    if (!ph) return "";
    const vals = ph.points.map((p) => p[1]).filter((v) => v !== null);
    const range = (u) => {
      if (!vals.length) return "";
      const a = vals[0], b = vals[vals.length - 1];
      return Math.abs(a - b) < 0.05 ? `${+a.toFixed(1)} ${u}` : `${+a.toFixed(1)} → ${+b.toFixed(1)} ${u}`;
    };
    const from = ph.rampFromCurrent ? "ramps to " : "";
    if (ph.control === "flow") return `Original: flow ${from}${range("ml/s")}${ph.maxPressure != null ? `, max ${+ph.maxPressure.toFixed(1)} bar` : ""}`;
    if (ph.control === "power") return `Original: pump power ${range("%")}${ph.maxPressure != null ? `, max ${+ph.maxPressure.toFixed(1)} bar` : ""}`;
    return `Original: pressure ${from}${range("bar")}${ph.maxFlow != null ? `, max ${+ph.maxFlow.toFixed(1)} ml/s` : ""}`;
  }

  function cue(s, isLast, targetWeight) {
    const secs = Math.max(1, Math.round(s.t1 - s.t0));
    if (isLast) return targetWeight > 0 ? `until ${+targetWeight.toFixed(1)} g is in the cup, then close the paddle` : `for about ${secs} s, then close the paddle`;
    const e = s.exit;
    if (e && e.type === "pressure") return e.op === "<=" ? `until the gauge drops to ${LC.fmtBar(e.value)} bar` : `until the gauge reads ${LC.fmtBar(e.value)} bar`;
    if (e && e.type === "weight") return `until about ${+e.value.toFixed(1)} g is in the cup`;
    return `for about ${secs} s`;
  }

  // What the original phase asked for, when we know it.
  function targets(ph) {
    return ph ? ph.points.map((p) => p[1]).filter((v) => v !== null) : [];
  }

  // Paddle % for the original fill flow or power, else for the measured flow.
  function fillPaddle(s) {
    const ph = s.phase;
    const v = targets(ph);
    if (ph && v.length && ph.control === "power") return LC.clamp(Math.round(Math.max(...v) / 5) * 5, 1, 100);
    if (ph && v.length && ph.control === "flow") return LC.paddleForFlow(Math.max(...v));
    return LC.paddleForFlow(s.qAvg);
  }

  // Describes a pressure phase by its shape, not just its start and end:
  // a long phase that climbs in a few seconds and then sits still is a hold.
  function describePressure(s, curve) {
    const r = LC.roundHalf;
    const dur = s.t1 - s.t0;
    const pts = curve.filter((c) => c[0] >= s.t0 && c[0] <= s.t1);
    const a = r(s.p0), b = r(s.p1);
    if (dur > 6 && pts.length > 4) {
      let peak = pts[0];
      pts.forEach((c) => { if (c[1] > peak[1]) peak = c; });
      const pk = r(peak[1]);
      const early = peak[0] - s.t0 < dur * 0.5;
      if (early && pk - Math.max(a, b) >= 1) {
        return { shape: "peak", level: pk, paddle: LC.paddleForPressure(pk), action: `Bring the gauge up to ${pk.toFixed(1)} bar, then ease it down to ${b.toFixed(1)} bar` };
      }
      // Average over the last 70% of the phase: where the gauge settles.
      const late = pts.filter((c) => c[0] >= s.t0 + dur * 0.3);
      const settle = r(late.reduce((x, c) => x + c[1], 0) / late.length);
      const flat = late.every((c) => Math.abs(c[1] - settle) < 0.9);
      if (flat && Math.abs(settle - a) >= 0.75) {
        return { shape: "hold", level: settle, paddle: LC.paddleForPressure(settle), action: `Bring the gauge to ${settle.toFixed(1)} bar and hold it there` };
      }
    }
    if (Math.abs(b - a) < 0.75) {
      const level = r((s.p0 + s.p1) / 2);
      return { shape: "hold", level, paddle: LC.paddleForPressure(level), action: `Hold the gauge at ${level.toFixed(1)} bar` };
    }
    return {
      shape: b > a ? "build" : "ease",
      level: Math.max(a, b),
      paddle: LC.paddleForPressure(Math.max(a, b)),
      action: `${b > a ? "Build" : "Ease"} the gauge from ${a.toFixed(1)} to ${b.toFixed(1)} bar`,
    };
  }

  function autoName(kind, shape) {
    if (kind === "fill") return "Fill";
    if (kind === "bloom") return "Bloom";
    if (!shape) return "Low pressure";
    if (shape.shape === "peak") return "Peak, then decline";
    if (shape.shape === "build") return "Ramp up";
    if (shape.shape === "ease") return "Decline";
    return shape.level < 4 ? "Pre-infusion" : "Hold";
  }

  function buildGuide(sim, profile) {
    const stages = merge(sim.stages.filter((s) => s.t1 - s.t0 > 0.05), 2);
    return stages.map((s, i) => {
      const isLast = i === stages.length - 1;
      const ph = s.phase;
      let action, gauge, paddle, shape = null, kind = "pressure";
      const limited = ph && ph.maxPressure != null && ph.maxPressure > 0 && s.pmax >= ph.maxPressure - 0.3;
      if (i === 0 && s.pmax < 1.5) {
        kind = "fill";
        paddle = fillPaddle(s);
        action = `Open the paddle to ${paddle}% to fill the basket`;
        gauge = [0, s.p1];
      } else if (LC.isBloom(s, i)) {
        kind = "bloom";
        paddle = 0;
        action = "Paddle to 0%, valve stays open (bloom)";
        gauge = [s.p0, s.p1];
      } else if (limited && ph.maxPressure < 4) {
        paddle = LC.paddleForPressure(ph.maxPressure);
        action = `Keep the gauge at about ${LC.fmtBar(ph.maxPressure)} bar, no higher`;
        gauge = [ph.maxPressure, ph.maxPressure];
      } else if (s.pmax < 1.5) {
        paddle = fillPaddle(s);
        action = `Paddle about ${paddle}%, gauge stays under ${LC.fmtBar(Math.max(1, s.pmax))} bar`;
        gauge = [s.pmin, s.pmax];
      } else {
        shape = describePressure(s, sim.curve);
        ({ action, paddle } = shape);
        gauge = [s.p0, s.p1];
      }
      return {
        name: s.name || autoName(kind, shape),
        kind,
        t0: s.t0, t1: s.t1,
        action,
        cue: cue(s, isLast, profile.targetWeight),
        paddle,
        gauge,
        intent: intent(s.phase),
      };
    });
  }

  LC.buildGuide = buildGuide;
})();
