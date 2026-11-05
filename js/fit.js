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

    // Average the curve into 1-second bins.
    const n = Math.max(1, Math.ceil(curve[curve.length - 1][0] - 1e-9));
    const sum = new Array(n).fill(0);
    const cnt = new Array(n).fill(0);
    curve.forEach(([t, p]) => {
      const b = Math.min(n - 1, Math.max(0, Math.floor(t)));
      sum[b] += p;
      cnt[b]++;
    });
    const bins = sum.map((s, i) => (cnt[i] ? s / cnt[i] : null));
    for (let i = 0; i < n; i++) if (bins[i] === null) bins[i] = i ? bins[i - 1] : 0;

    const S = [0], S2 = [0];
    bins.forEach((v, i) => {
      S.push(S[i] + v);
      S2.push(S2[i] + v * v);
    });
    const level = (a, b) => LC.clamp(LC.roundHalf((S[b] - S[a]) / (b - a)), L.minPressure, L.maxPressure);
    const cost = (a, b) => {
      const mu = level(a, b);
      return S2[b] - S2[a] - 2 * mu * (S[b] - S[a]) + (b - a) * mu * mu;
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

  LC.fitSteps = fitSteps;
})();
