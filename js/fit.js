// Squeezes a pressure curve into at most 5 flat Lelit steps.
//
// Uses dynamic programming to find the split with the smallest squared error,
// where every step must last at least `minSeconds`. Short wiggles are absorbed
// by the neighbouring steps instead of becoming 1-second steps of their own.
(function () {
  const LC = window.LC;

  function fitSteps(curve, opts) {
    const L = LC.LELIT;
    const minSeconds = Math.max(1, Math.round((opts && opts.minSeconds) || 3));
    const maxSteps = (opts && opts.maxSteps) || L.maxSteps;
    if (!curve.length) return [];

    // Average the curve into 1-second bins. Bloom seconds (third column set)
    // weigh much more, so a bloom stays an exact 0 bar step with clean edges.
    const BLOOM_WEIGHT = 8;
    const n = Math.max(1, Math.ceil(curve[curve.length - 1][0] - 1e-9));
    const sum = new Array(n).fill(0);
    const cnt = new Array(n).fill(0);
    const bloom = new Array(n).fill(0);
    curve.forEach(([t, p, isBloom]) => {
      const b = Math.min(n - 1, Math.max(0, Math.floor(t)));
      sum[b] += p;
      cnt[b]++;
      if (isBloom) bloom[b]++;
    });
    const bins = sum.map((s, i) => (cnt[i] ? s / cnt[i] : null));
    for (let i = 0; i < n; i++) if (bins[i] === null) bins[i] = i ? bins[i - 1] : 0;
    const weight = bloom.map((b, i) => 1 + (BLOOM_WEIGHT - 1) * (cnt[i] ? b / cnt[i] : 0));

    const Wt = [0], S = [0], S2 = [0];
    bins.forEach((v, i) => {
      const w = weight[i];
      Wt.push(Wt[i] + w);
      S.push(S[i] + w * v);
      S2.push(S2[i] + w * v * v);
    });
    const level = (a, b) => LC.clamp(LC.roundHalf((S[b] - S[a]) / (Wt[b] - Wt[a])), L.minPressure, L.maxPressure);
    const cost = (a, b) => {
      const mu = level(a, b);
      return S2[b] - S2[a] - 2 * mu * (S[b] - S[a]) + (Wt[b] - Wt[a]) * mu * mu;
    };

    const minLen = Math.min(minSeconds, n);
    const D = [], B = [];
    for (let k = 0; k <= maxSteps; k++) {
      D.push(new Array(n + 1).fill(Infinity));
      B.push(new Array(n + 1).fill(-1));
    }
    D[0][0] = 0;
    for (let k = 1; k <= maxSteps; k++) {
      for (let b = minLen; b <= n; b++) {
        for (let a = 0; a <= b - minLen; a++) {
          if (D[k - 1][a] === Infinity) continue;
          const c = D[k - 1][a] + cost(a, b);
          if (c < D[k][b]) {
            D[k][b] = c;
            B[k][b] = a;
          }
        }
      }
    }

    // Fewest steps whose error is close to the best possible: an extra step
    // has to earn its place (about 0.3 bar rms better) to be kept.
    let bestK = 1, bestErr = Infinity;
    for (let k = 1; k <= maxSteps; k++) if (D[k][n] < bestErr) bestErr = D[k][n];
    for (let k = 1; k <= maxSteps; k++) {
      if (D[k][n] <= bestErr + 0.1 * n) {
        bestK = k;
        break;
      }
    }

    const steps = [];
    let b = n;
    for (let k = bestK; k >= 1; k--) {
      const a = B[k][b];
      steps.unshift({ pressure: level(a, b), seconds: b - a });
      b = a;
    }
    for (let i = steps.length - 1; i > 0; i--) {
      if (steps[i].pressure === steps[i - 1].pressure) {
        steps[i - 1].seconds += steps[i].seconds;
        steps.splice(i, 1);
      }
    }
    return steps;
  }

  // Places fitted steps on the machine's P1-P5, in order from P1. Unused
  // slots after them are 0 bar / 0 s so the machine skips them. P5 has no
  // time on the Lelit3 (it runs until the shot is stopped), so only a full
  // 5-step profile uses it; otherwise the last step gets a few spare seconds
  // in case the shot runs a little long.
  function toSlots(steps) {
    const L = LC.LELIT;
    const slots = Array.from({ length: L.maxSteps }, (_, i) => ({ slot: i + 1, pressure: 0, seconds: 0, unused: true, untilStop: false, spare: 0 }));
    steps.forEach((s, i) => {
      s.slot = i + 1;
      Object.assign(slots[i], { pressure: s.pressure, seconds: s.seconds, unused: false });
    });
    if (!steps.length) return slots;
    const last = slots[steps.length - 1];
    if (last.slot === L.maxSteps) Object.assign(last, { seconds: null, untilStop: true });
    else Object.assign(last, { seconds: last.seconds + L.lastStepSpare, spare: L.lastStepSpare });
    return slots;
  }

  LC.fitSteps = fitSteps;
  LC.toSlots = toSlots;
})();
