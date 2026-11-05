// Small hand-drawn canvas chart: original pressure, the fitted Lelit steps
// and the gauge the Lelit should show. Redraws on resize and theme change,
// and shows a readout under the pointer.
(function () {
  const LC = window.LC;

  let canvas, data, hoverT = null;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function at(curve, t) {
    if (!curve.length) return null;
    if (t <= curve[0][0]) return curve[0][1];
    let lo = 0, hi = curve.length - 1;
    if (t >= curve[hi][0]) return curve[hi][1];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (curve[mid][0] <= t) lo = mid; else hi = mid;
    }
    const [t0, p0] = curve[lo], [t1, p1] = curve[hi];
    return p0 + ((p1 - p0) * (t - t0)) / (t1 - t0 || 1);
  }

  function stepAt(steps, t) {
    let acc = 0;
    for (let i = 0; i < steps.length; i++) {
      acc += steps[i].seconds;
      if (t < acc || i === steps.length - 1) return { slot: steps[i].slot || i + 1, p: steps[i].pressure };
    }
    return null;
  }

  function niceStep(span, px) {
    const target = span / Math.max(2, px / 70);
    for (const s of [1, 2, 5, 10, 15, 20, 30, 60]) if (s >= target) return s;
    return 120;
  }

  function draw() {
    if (!canvas || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const ink = css("--ink"), muted = css("--muted"), line = css("--line");
    const src = css("--src"), lelit = css("--lelit"), soft = css("--lelit-soft"), panel = css("--panel");
    const font = (size, weight = 400) => `${weight} ${size}px ${css("--body") || "sans-serif"}`;

    const pad = { l: 34, r: 12, t: 22, b: 30 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const T = Math.max(1, data.total);
    const maxP = Math.max(10, Math.ceil(Math.max(...data.source.map((c) => c[1]), 0)));
    const X = (t) => pad.l + (t / T) * pw;
    const Y = (p) => pad.t + ph - (p / maxP) * ph;

    // Grid and axes.
    g.font = font(12);
    g.fillStyle = muted;
    g.strokeStyle = line;
    g.lineWidth = 1;
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (let p = 0; p <= maxP; p += 2) {
      g.beginPath();
      g.moveTo(pad.l, Math.round(Y(p)) + 0.5);
      g.lineTo(w - pad.r, Math.round(Y(p)) + 0.5);
      g.stroke();
      g.fillText(String(p), pad.l - 8, Y(p));
    }
    g.textAlign = "center";
    g.textBaseline = "top";
    const xs = niceStep(T, pw);
    for (let t = 0; t <= T + 0.01; t += xs) g.fillText(`${t}s`, X(t), pad.t + ph + 8);
    g.save();
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText("bar", 0, 0);
    g.restore();

    // Step bands with labels.
    let acc = 0;
    data.steps.forEach((s, i) => {
      const x0 = X(acc), x1 = X(acc + s.seconds);
      if (i % 2 === 0) {
        g.fillStyle = soft;
        g.fillRect(x0, pad.t, x1 - x0, ph);
      }
      g.fillStyle = muted;
      g.font = font(12, 500);
      g.textAlign = "left";
      g.textBaseline = "top";
      if (x1 - x0 > 22) g.fillText(`P${s.slot || i + 1}`, x0 + 5, pad.t + 4);
      acc += s.seconds;
    });

    const path = (pts, color, width, dash, alpha = 1) => {
      if (!pts.length) return;
      g.save();
      g.globalAlpha = alpha;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = "round";
      g.lineCap = "round";
      g.setLineDash(dash || []);
      g.beginPath();
      pts.forEach(([t, p], i) => (i ? g.lineTo(X(t), Y(p)) : g.moveTo(X(t), Y(p))));
      g.stroke();
      g.restore();
    };

    // Expected Lelit gauge (wide, soft), then steps (dashed), then the original on top.
    path(data.response, lelit, 4, null, 0.45);
    const stepPts = [];
    acc = 0;
    data.steps.forEach((s) => {
      stepPts.push([acc, s.pressure], [acc + s.seconds, s.pressure]);
      acc += s.seconds;
    });
    path(stepPts, lelit, 2, [7, 5]);
    path(data.source, src, 2);

    // Pointer readout.
    if (hoverT !== null && hoverT >= 0 && hoverT <= T) {
      const x = X(hoverT);
      g.strokeStyle = muted;
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(x + 0.5, pad.t);
      g.lineTo(x + 0.5, pad.t + ph);
      g.stroke();
      g.setLineDash([]);
      const so = at(data.source, hoverT), st = stepAt(data.steps, hoverT), re = at(data.response, hoverT);
      const rows = [
        [`${hoverT.toFixed(1)} s`, ink],
        [`Original ${so == null ? "–" : so.toFixed(1)} bar`, src],
        [st ? `P${st.slot} target ${st.p.toFixed(1)} bar` : "", lelit],
        [`Lelit gauge ≈ ${re == null ? "–" : re.toFixed(1)} bar`, muted],
      ].filter((r) => r[0]);
      g.font = font(13);
      const bw = Math.max(...rows.map((r) => g.measureText(r[0]).width)) + 20;
      const bh = rows.length * 18 + 12;
      let bx = x + 12;
      if (bx + bw > w - pad.r) bx = x - 12 - bw;
      const by = pad.t + 8;
      g.fillStyle = panel;
      g.strokeStyle = line;
      g.beginPath();
      if (g.roundRect) g.roundRect(bx, by, bw, bh, 6); else g.rect(bx, by, bw, bh);
      g.fill();
      g.stroke();
      g.textAlign = "left";
      g.textBaseline = "top";
      rows.forEach(([text, color], i) => {
        g.fillStyle = color;
        g.fillText(text, bx + 10, by + 8 + i * 18);
      });
    }
  }

  function attach(el) {
    canvas = el;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const pw = r.width - 34 - 12;
      return ((e.clientX - r.left - 34) / pw) * Math.max(1, data ? data.total : 1);
    };
    canvas.addEventListener("pointermove", (e) => { hoverT = pos(e); draw(); });
    canvas.addEventListener("pointerleave", () => { hoverT = null; draw(); });
    if ("ResizeObserver" in window) new ResizeObserver(draw).observe(canvas);
    else window.addEventListener("resize", draw);
    const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) mq.addEventListener("change", draw);
  }

  LC.chart = {
    attach,
    render(d) {
      data = d;
      draw();
    },
  };
})();
