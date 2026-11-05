// Shared namespace, lookup tables and small helpers.
// Loaded first; every other script hangs off window.LC.
(function () {
  const LC = (window.LC = window.LC || {});

  // Measured with the Lelit Pagaia (from a video, no coffee in the basket).
  // These are free-flow numbers: with a puck, the same setting flows far less.
  LC.PRESSURE_TO_FLOW = [
    [0.5, 2.5], [1, 3], [2, 5], [3, 5.5], [4, 6.5], [5, 8],
    [6, 8.5], [7, 9], [8, 9.5], [9, 10],
  ];
  LC.PADDLE_TO_FLOW = [
    [1, 1.5], [5, 2.5], [10, 3], [20, 5], [30, 6], [40, 7], [50, 7.5],
    [60, 8], [70, 8.5], [80, 9], [90, 9.5], [100, 10],
  ];

  // Lelit Victoria3 / Elizabeth3 profile limits and behaviour.
  // Ramp rates are estimates: the pump can only raise pressure as fast as
  // it can push water into the puck. Adjust after testing on a real machine.
  LC.LELIT = {
    maxSteps: 5,
    minPressure: 0,
    maxPressure: 10,
    pressureStep: 0.5,
    riseRate: 2.0, // bar per second when climbing to a higher step
    fallRate: 1.5, // bar per second when dropping to a lower step
    headspace: 45, // ml of water needed before the gauge starts to climb
  };

  // Linear interpolation in a sorted [[x, y], ...] table, clamped at the ends.
  LC.interp = function (table, x) {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (x <= table[i][0]) {
        const [x0, y0] = table[i - 1];
        const [x1, y1] = table[i];
        return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return table[table.length - 1][1];
  };

  LC.invert = (table) => table.map(([a, b]) => [b, a]);

  // Whole percent near the bottom of the dial, steps of 5 above that.
  const round5 = (x) => Math.max(0, Math.min(100, x < 10 ? Math.max(1, Math.round(x)) : Math.round(x / 5) * 5));

  // Paddle % that delivers a given free flow (ml/s).
  LC.paddleForFlow = function (flow) {
    if (flow <= 0.05) return 0;
    return round5(LC.interp(LC.invert(LC.PADDLE_TO_FLOW), flow));
  };

  // Paddle % that matches a pressure setting, via the two Pagaia tables.
  // Only a starting point: with coffee in the basket the gauge is the truth.
  LC.paddleForPressure = function (bar) {
    if (bar <= 0.2) return 0;
    return LC.paddleForFlow(LC.interp(LC.PRESSURE_TO_FLOW, bar));
  };

  LC.roundHalf = (x) => Math.round(x * 2) / 2;
  LC.fmtBar = (x) => LC.roundHalf(x).toFixed(1);
  LC.num = (x, fallback = 0) => {
    const n = typeof x === "string" ? parseFloat(x) : x;
    return Number.isFinite(n) ? n : fallback;
  };
  LC.clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
})();
