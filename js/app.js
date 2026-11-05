// Page wiring: loading, settings, and rendering the result.
(function () {
  const LC = window.LC;
  const $ = (id) => document.getElementById(id);

  const store = {
    get(k, d) { try { const v = localStorage.getItem("lelit." + k); return v === null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("lelit." + k, v); } catch (_) { /* private mode */ } },
  };

  const state = {
    profile: null,
    url: null,
    minSeconds: +store.get("minsec", 3),
    grind: +store.get("grind", LC.SIM_DEFAULTS.resistance),
  };
  if (![2, 3, 4, 5].includes(state.minSeconds)) state.minSeconds = 3;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt1 = (x) => (Math.round(x * 10) / 10).toString();

  function setStatus(text, isError) {
    $("status").textContent = text || "";
    $("status").classList.toggle("error", !!isError);
  }

  // ---------- Loading ----------

  async function loadUrl(url) {
    setStatus("Loading…");
    try {
      const profile = await LC.load.fromUrl(url);
      state.url = url.trim();
      show(profile);
      setStatus("");
    } catch (e) {
      if (e instanceof LC.load.NeedsFellowForm) {
        openFellow(null);
        setStatus(e.message);
      } else if (e instanceof TypeError) {
        setStatus("Couldn't reach that site. Check your connection, or download the profile and open the file instead.", true);
      } else setStatus(e.message, true);
    }
  }

  async function loadFile(file) {
    setStatus("Reading " + file.name + "…");
    try {
      const profile = await LC.load.fromFile(file);
      state.url = null;
      show(profile);
      setStatus("");
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  // ---------- Fellow form ----------

  const form = $("fellow-form");

  function infusionRow(step, i) {
    const row = document.createElement("div");
    row.className = "inf-row";
    row.innerHTML = `<span class="n">${i + 1}</span>
      <label>Pressure bar <input type="number" step="any" min="0" max="10" data-k="pressure" value="${esc(step.pressure)}"></label>
      <label>Duration s <input type="number" step="any" min="0" max="120" data-k="duration" value="${esc(step.duration)}"></label>
      <button type="button" class="quiet" aria-label="Remove infusion step ${i + 1}">Remove</button>`;
    row.querySelector("button").onclick = () => {
      const steps = readFellow().infusion;
      steps.splice(i, 1);
      renderInfusion(steps.length ? steps : [{ pressure: 9, duration: 20 }]);
    };
    return row;
  }

  function renderInfusion(steps) {
    const box = $("infusion-rows");
    box.innerHTML = "";
    steps.forEach((s, i) => box.appendChild(infusionRow(s, i)));
    $("add-infusion").hidden = steps.length >= 5;
  }

  function openFellow(values) {
    const v = Object.assign({}, LC.sources.fellow.DEFAULTS, values || {});
    for (const el of form.elements) {
      if (!el.name || !(el.name in v)) continue;
      if (el.type === "checkbox") el.checked = !!v[el.name];
      else el.value = v[el.name];
    }
    renderInfusion(v.infusion);
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function readFellow() {
    const v = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      v[el.name] = el.type === "checkbox" ? el.checked : el.type === "number" ? parseFloat(el.value) : el.value;
    }
    v.infusion = [...$("infusion-rows").querySelectorAll(".inf-row")].map((r) => ({
      pressure: parseFloat(r.querySelector('[data-k="pressure"]').value) || 0,
      duration: parseFloat(r.querySelector('[data-k="duration"]').value) || 0,
    }));
    return v;
  }

  // ---------- Rendering ----------

  function rms(curve, steps) {
    let acc = 0, s = 0, n = 0;
    const bounds = steps.map((st) => (acc += st.seconds));
    curve.forEach(([t, p]) => {
      const i = bounds.findIndex((b) => t < b);
      const target = steps[i < 0 ? steps.length - 1 : i].pressure;
      s += (p - target) ** 2;
      n++;
    });
    return n ? Math.sqrt(s / n) : 0;
  }

  function show(profile) {
    state.profile = profile;
    $("result").hidden = false;
    render();
    const params = new URLSearchParams(location.search);
    if (state.url) params.set("u", state.url); else params.delete("u");
    const q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function render() {
    const profile = state.profile;
    if (!profile) return;
    const recorded = !!profile.recorded;
    const sim = LC.simulate(profile, { resistance: state.grind });
    const intent = LC.intentCurve(sim.curve, sim.stages);
    const steps = LC.fitSteps(intent, { minSeconds: state.minSeconds });
    const slots = LC.toSlots(steps);
    const total = steps.reduce((a, s) => a + s.seconds, 0);
    const response = LC.lelitResponse(steps, total);
    const guide = LC.buildGuide(sim, profile);
    const fitErr = rms(intent, steps);

    // Header
    $("p-name").textContent = profile.name;
    const kind = recorded ? "Recorded Decent shot" : `${profile.source} profile`;
    $("p-by").textContent = profile.author ? `${kind} by ${profile.author}` : kind;
    $("f-temp").textContent = `${fmt1(profile.temperature)}°C`;
    $("f-weight").textContent = profile.targetWeight > 0 ? `${fmt1(profile.targetWeight)} g` : "–";
    $("f-time").textContent = `≈ ${Math.round(sim.total)} s`;
    $("p-notes").textContent = profile.notes || "";
    $("p-notes-wrap").hidden = !profile.notes;

    // Chart
    const every = Math.max(1, Math.floor(sim.curve.length / 700));
    LC.chart.render({
      source: sim.curve.filter((_, i) => i % every === 0).map((c) => [c[0], c[1]]),
      steps,
      response,
      total: Math.max(total, sim.total),
    });
    $("chart").setAttribute("aria-label", `Pressure over ${Math.round(sim.total)} seconds: original profile against ${steps.length} Lelit steps.`);
    $("chart-caption").textContent = recorded
      ? "Real pressure, recorded on a Decent espresso machine."
      : "Simulated from the profile with an average puck. Slide the grind until the shot time looks like what the profile's author describes.";

    // Controls
    document.querySelectorAll('input[name="minsec"]').forEach((r) => (r.checked = +r.value === state.minSeconds));
    $("grind-wrap").hidden = recorded;
    $("grind").value = state.grind;
    $("grind-out").textContent = `${fmt1(state.grind)} bar at 2 ml/s`;

    // Warnings
    const warn = [];
    if (fitErr > 0.8 || guide.length > LC.LELIT.maxSteps) warn.push(`This profile has ${guide.length} phases and the machine takes 5 steps, so the machine version is a simplification. The paddle guide follows every phase.`);
    if (Math.max(...sim.curve.map((c) => c[1])) > LC.LELIT.maxPressure + 0.25) warn.push(`The original goes above ${LC.LELIT.maxPressure} bar; the steps stop there.`);
    if (!recorded && profile.targetWeight > 0 && sim.finalWeight < profile.targetWeight * 0.9) {
      warn.push(`With this grind the simulated shot only reaches ${Math.round(sim.finalWeight)} g of ${fmt1(profile.targetWeight)} g. Try a coarser grind.`);
    }
    $("warnings").hidden = !warn.length;
    $("warnings").textContent = warn.join(" ");

    // Machine steps
    $("lcc").innerHTML = slots.map((s) => {
      const k = `<span class="k">P${s.slot}</span>`;
      if (s.untilStop) return `<li>${k}<span class="p">${s.pressure.toFixed(1)} <small>bar</small></span><span class="s stop">until stop</span></li>`;
      if (s.unused) return `<li>${k}<span class="off">0 bar</span><span class="off">0 s</span></li>`;
      const note = s.pressure === 0 ? "bloom" : s.spare ? `incl. ${s.spare} s spare` : "";
      const spare = note ? `<small class="spare">${note}</small>` : "";
      return `<li>${k}<span class="p">${s.pressure.toFixed(1)} <small>bar</small></span><span class="s">${s.seconds} s${spare}</span></li>`;
    }).join("");
    const stopAt = profile.targetWeight > 0 ? `Stop the shot at ${fmt1(profile.targetWeight)} g on the scale, around ${total} s in.` : `Stop the shot around ${total} s in.`;
    const lastSlot = slots[steps.length - 1];
    const ending = lastSlot && lastSlot.untilStop
      ? "P5 runs until you stop the shot or the button's max time ends, so set the max time a little longer than the shot."
      : `The last step has ${LC.LELIT.lastStepSpare} spare seconds in case your shot runs long; the steps after it are 0 bar, 0 s, so the machine skips them.`;
    $("lcc-after").textContent = `Brew at ${fmt1(profile.temperature)}°C. ${stopAt} ${ending}`;

    // Paddle guide
    $("guide").innerHTML = guide.map((g) => `
      <li>
        <span class="t">${Math.round(g.t0)}–${Math.round(g.t1)}s</span>
        <div>
          <div class="name">${esc(g.name)}</div>
          <div class="a">${esc(g.action)}</div>
          <div class="c">${esc(g.cue.charAt(0).toUpperCase() + g.cue.slice(1))}</div>
          ${g.intent ? `<div class="o">${esc(g.intent)}</div>` : ""}
        </div>
        <span class="pad">${g.paddle}%<small>paddle</small></span>
      </li>`).join("");

    state.copyText = [
      `Lelit3 profile: ${profile.name}`,
      ...slots.map((s) => s.untilStop ? `P${s.slot}  ${s.pressure.toFixed(1)} bar  until stop` : s.unused ? `P${s.slot}  0 bar  0 s` : `P${s.slot}  ${s.pressure.toFixed(1)} bar  ${s.seconds} s${s.pressure === 0 ? " (bloom)" : ""}${s.spare ? ` (incl. ${s.spare} s spare)` : ""}`),
      `${fmt1(profile.temperature)}°C, stop at ${profile.targetWeight > 0 ? `${fmt1(profile.targetWeight)} g, ` : ""}around ${total} s`,
      state.url ? `From ${state.url}` : "",
    ].filter(Boolean).join("\n");
  }

  // ---------- Events ----------

  $("link-form").addEventListener("submit", (e) => {
    e.preventDefault();
    loadUrl($("link").value);
  });
  $("link").addEventListener("input", () => setStatus(""));
  $("file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) loadFile(f);
    e.target.value = "";
  });
  document.querySelectorAll("[data-sample]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.sample === "fellow") {
        openFellow(LC.sources.fellow.SAMPLE);
        state.url = null;
        show(LC.sources.fellow.parse(LC.sources.fellow.SAMPLE));
        setStatus("");
        return;
      }
      $("link").value = b.dataset.sample;
      loadUrl(b.dataset.sample);
    }));

  $("fellow-open").addEventListener("click", () => openFellow(null));
  $("fellow-close").addEventListener("click", () => (form.hidden = true));
  $("add-infusion").addEventListener("click", () => {
    const steps = readFellow().infusion;
    steps.push({ pressure: steps.length ? steps[steps.length - 1].pressure : 9, duration: 10 });
    renderInfusion(steps);
  });
  function fellowProblem(v) {
    const bad = (x, lo, hi) => !Number.isFinite(x) || x < lo || x > hi;
    if (bad(v.dose, 5, 30)) return "Enter a dose between 5 and 30 g.";
    if (bad(v.ratio, 0.5, 6)) return "Enter a ratio between 0.5 and 6.";
    if (bad(v.temperature, 70, 100)) return "Enter a temperature between 70 and 100°C.";
    if (v.preInfusionEnabled && (bad(v.preInfusionFillFlowRate, 0.5, 10) || bad(v.preInfusionHoldPressure, 0, 10) || bad(v.preInfusionDuration, 0, 120))) {
      return "Check the pre-infusion numbers: flow 0.5–10 ml/s, pressure 0–10 bar, 0–120 s.";
    }
    if (!v.infusion.some((s) => s.duration > 0)) return "Give at least one infusion step a duration.";
    if (v.infusion.some((s) => bad(s.pressure, 0, 10) || bad(s.duration, 0, 120))) return "Infusion steps need 0–10 bar and 0–120 s.";
    if (v.rampDownEnabled && (bad(v.rampDownEndPressure, 0, 10) || bad(v.rampDownDuration, 0, 120))) return "Check the ramp down numbers: 0–10 bar, 0–120 s.";
    return "";
  }

  form.addEventListener("input", () => ($("fellow-error").textContent = ""));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = readFellow();
    const problem = fellowProblem(v);
    $("fellow-error").textContent = problem;
    if (problem) return;
    state.url = null;
    show(LC.sources.fellow.parse(v));
    setStatus("");
  });

  document.querySelectorAll('input[name="minsec"]').forEach((r) =>
    r.addEventListener("change", () => {
      state.minSeconds = +r.value;
      store.set("minsec", state.minSeconds);
      render();
    }));
  $("grind").addEventListener("input", (e) => {
    state.grind = +e.target.value;
    store.set("grind", state.grind);
    render();
  });

  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.copyText || "");
      $("copy").textContent = "Copied";
    } catch (_) {
      $("copy").textContent = "Couldn't copy";
    }
    setTimeout(() => ($("copy").textContent = "Copy steps"), 1600);
  });

  // ---------- Start ----------

  LC.chart.attach($("chart"));
  $("ref-paddle").innerHTML = LC.PADDLE_TO_FLOW.map(([a, b]) => `<tr><td>${a}%</td><td>${b}</td></tr>`).join("");
  $("ref-pressure").innerHTML = LC.PRESSURE_TO_FLOW.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");

  const start = new URLSearchParams(location.search).get("u");
  if (start) {
    $("link").value = start;
    loadUrl(start);
  }
})();
