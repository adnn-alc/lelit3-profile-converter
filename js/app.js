// Page wiring: loading, settings, editing and rendering the result.
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
    load: null, // how the current profile was loaded, for the recent list
    target: null, // grams in the cup, when changed from the profile's
    edits: null, // hand-edited machine steps: [{ pressure, seconds }] × 5
    editing: false,
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

  async function loadUrl(url, opts) {
    setStatus("Loading…");
    try {
      const profile = await LC.load.fromUrl(url);
      state.url = url.trim();
      state.load = { u: state.url };
      show(profile, opts);
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
      state.load = { profile };
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

  // ---------- Machine steps ----------

  const N = () => LC.LELIT.maxSteps;

  // Hand-edited values as machine slots. P1–P4 count when they have a time;
  // P5 has no time on the Lelit3 and runs until stop whenever it has pressure.
  function slotsFromEdits(edits) {
    return edits.map((e, i) => {
      const slot = i + 1;
      if (slot === N()) {
        return e.pressure > 0
          ? { slot, pressure: e.pressure, seconds: null, unused: false, untilStop: true, spare: 0 }
          : { slot, pressure: 0, seconds: 0, unused: true, untilStop: false, spare: 0 };
      }
      return e.seconds > 0
        ? { slot, pressure: e.pressure, seconds: e.seconds, unused: false, untilStop: false, spare: 0 }
        : { slot, pressure: 0, seconds: 0, unused: true, untilStop: false, spare: 0 };
    });
  }

  // What the machine will run, as steps for the chart.
  function stepsFromSlots(slots, shotLength) {
    const steps = [];
    let t = 0;
    slots.forEach((s) => {
      if (s.unused) return;
      if (s.untilStop) {
        steps.push({ pressure: s.pressure, seconds: Math.max(1, Math.ceil(shotLength) - t), slot: s.slot });
      } else {
        steps.push({ pressure: s.pressure, seconds: s.seconds, slot: s.slot });
        t += s.seconds;
      }
    });
    return steps;
  }

  function editsFromSlots(slots) {
    return slots.map((s) => ({ pressure: s.pressure, seconds: s.untilStop ? null : s.seconds }));
  }

  const sameEdits = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function machineRows(slots) {
    return slots.map((s) => {
      const k = `<span class="k">P${s.slot}</span>`;
      if (s.untilStop) return `<li>${k}<span class="p">${s.pressure.toFixed(1)} <small>bar</small></span><span class="s stop">until stop</span></li>`;
      if (s.unused) return `<li>${k}<span class="off">0 bar</span><span class="off">0 s</span></li>`;
      const note = s.pressure === 0 ? "bloom" : s.spare ? `incl. ${s.spare} s spare` : "";
      const small = note ? `<small class="spare">${note}</small>` : "";
      return `<li>${k}<span class="p">${s.pressure.toFixed(1)} <small>bar</small></span><span class="s">${s.seconds} s${small}</span></li>`;
    }).join("");
  }

  function editRows(edits) {
    return edits.map((e, i) => {
      const slot = i + 1;
      const p = `<label class="p"><input type="number" inputmode="decimal" step="0.5" min="0" max="10" data-i="${i}" data-k="pressure" value="${e.pressure}" aria-label="P${slot} pressure in bar"> <small>bar</small></label>`;
      const s = slot === N()
        ? `<span class="s stop" id="p5-label">${e.pressure > 0 ? "until stop" : "0 s"}</span>`
        : `<span class="s"><label><input class="sec" type="number" inputmode="numeric" step="1" min="0" max="120" data-i="${i}" data-k="seconds" value="${e.seconds}" aria-label="P${slot} time in seconds"> s</label></span>`;
      return `<li><span class="k">P${slot}</span>${p}${s}</li>`;
    }).join("");
  }

  // ---------- Recent conversions ----------

  const RECENT_MAX = 8;

  function readRecent() {
    try { return JSON.parse(store.get("recent", "[]")) || []; } catch (_) { return []; }
  }

  function recentKey(load, profile) {
    if (load.u) return "u:" + load.u;
    if (load.fellow) return "f:" + JSON.stringify(load.fellow);
    return "p:" + profile.source + ":" + profile.name;
  }

  let saveTimer = null;
  function saveRecent() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!state.load || !state.profile) return;
      const entry = {
        key: recentKey(state.load, state.profile),
        name: String(state.profile.name || "Profile").trim(),
        source: state.profile.recorded ? "Decent shot" : state.profile.source,
        load: state.load,
        edits: state.edits,
        target: state.target,
      };
      if (JSON.stringify(entry).length > 200000) return; // a huge file: not worth keeping
      const list = readRecent().filter((e) => e.key !== entry.key);
      list.unshift(entry);
      store.set("recent", JSON.stringify(list.slice(0, RECENT_MAX)));
      renderRecent();
    }, 300);
  }

  function renderRecent() {
    const list = readRecent();
    $("recent").hidden = !list.length;
    $("recent-list").innerHTML = list.map((e, i) =>
      `<button type="button" class="chip" data-recent="${i}">${esc(e.name)} <small>${esc(e.source)}${e.edits ? ", edited" : ""}</small></button>`).join("");
  }

  function openRecent(entry) {
    const opts = { edits: entry.edits || null, target: entry.target != null ? entry.target : null };
    const load = entry.load || {};
    if (load.u) {
      $("link").value = load.u;
      loadUrl(load.u, opts);
    } else if (load.fellow) {
      state.url = null;
      state.load = { fellow: load.fellow };
      openFellow(load.fellow);
      show(LC.sources.fellow.parse(load.fellow), opts);
    } else if (load.profile) {
      state.url = null;
      state.load = { profile: load.profile };
      show(load.profile, opts);
    }
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

  function show(profile, opts) {
    state.profile = profile;
    state.target = opts && opts.target != null ? opts.target : null;
    state.edits = opts && opts.edits ? opts.edits : null;
    state.editing = false;
    $("target-error").textContent = "";
    $("result").hidden = false;
    render();
    saveRecent();
    const params = new URLSearchParams(location.search);
    if (state.url) params.set("u", state.url); else params.delete("u");
    const q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // keepInputs: called while typing in the step editor, so don't rebuild it.
  function render(keepInputs) {
    const base = state.profile;
    if (!base) return;
    const recorded = !!base.recorded;
    const targetWeight = state.target != null ? state.target : base.targetWeight;
    const profile = Object.assign({}, base, { targetWeight });
    const sim = LC.simulate(base, { resistance: state.grind, targetWeight: state.target });
    const intent = LC.intentCurve(sim.curve, sim.stages);
    const fitted = LC.fitSteps(intent, { minSeconds: state.minSeconds });
    const converted = LC.toSlots(fitted);
    const fittedTotal = fitted.reduce((a, s) => a + s.seconds, 0);
    const guide = LC.buildGuide(sim, profile);
    const fitErr = rms(intent, fitted);

    const edited = !!state.edits && !sameEdits(state.edits, editsFromSlots(converted));
    const slots = state.edits ? slotsFromEdits(state.edits) : converted;
    const steps = state.edits ? stepsFromSlots(slots, Math.max(sim.total, fittedTotal)) : fitted;
    const total = steps.reduce((a, s) => a + s.seconds, 0);
    const chartTotal = Math.max(total, sim.total);
    const response = LC.lelitResponse(steps, chartTotal);
    const shotTime = Math.round(sim.total);

    // Header
    $("p-name").textContent = base.name;
    const kind = recorded ? "Recorded Decent shot" : `${base.source} profile`;
    $("p-by").textContent = base.author ? `${kind} by ${base.author}` : kind;
    $("f-temp").textContent = `${fmt1(base.temperature)}°C`;
    if (document.activeElement !== $("target")) $("target").value = targetWeight > 0 ? fmt1(targetWeight) : "";
    $("target-reset").hidden = state.target == null;
    $("f-time").textContent = `≈ ${shotTime} s`;
    $("p-notes").textContent = base.notes || "";
    $("p-notes-wrap").hidden = !base.notes;

    // Chart
    const every = Math.max(1, Math.floor(sim.curve.length / 700));
    LC.chart.render({
      source: sim.curve.filter((_, i) => i % every === 0).map((c) => [c[0], c[1]]),
      steps,
      response,
      total: chartTotal,
    });
    $("chart").setAttribute("aria-label", `Pressure over ${shotTime} seconds: original profile against ${steps.length} Lelit steps.`);
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
    if (fitErr > 0.8 || guide.length > N()) warn.push(`This profile has ${guide.length} phases and the machine takes 5 steps, so the machine version is a simplification. The paddle guide follows every phase.`);
    if (Math.max(...sim.curve.map((c) => c[1])) > LC.LELIT.maxPressure + 0.25) warn.push(`The original goes above ${LC.LELIT.maxPressure} bar; the steps stop there.`);
    if (!recorded && targetWeight > 0 && sim.finalWeight < targetWeight * 0.9) {
      warn.push(`With this grind the simulated shot only reaches ${Math.round(sim.finalWeight)} g of ${fmt1(targetWeight)} g. Try a coarser grind.`);
    }
    $("warnings").hidden = !warn.length;
    $("warnings").textContent = warn.join(" ");

    // Machine steps
    $("edit").setAttribute("aria-pressed", String(state.editing));
    $("edit").textContent = state.editing ? "Done editing" : "Edit steps";
    if (state.editing) {
      if (!keepInputs) $("lcc").innerHTML = editRows(state.edits);
      else if ($("p5-label")) $("p5-label").textContent = state.edits[N() - 1].pressure > 0 ? "until stop" : "0 s";
    } else {
      $("lcc").innerHTML = machineRows(slots);
    }
    $("lcc").classList.toggle("editing", state.editing);
    $("edited").hidden = !edited;

    const stopAt = targetWeight > 0 ? `Stop the shot at ${fmt1(targetWeight)} g on the scale, around ${shotTime} s in.` : `Stop the shot around ${shotTime} s in.`;
    const usedSlots = slots.filter((s) => !s.unused);
    const last = usedSlots[usedSlots.length - 1];
    let ending;
    if (last && last.untilStop) ending = "P5 runs until you stop the shot or the button's max time ends, so set the max time a little longer than the shot.";
    else if (!edited && last) ending = `The last step has ${LC.LELIT.lastStepSpare} spare seconds in case your shot runs long; the steps after it are 0 bar, 0 s, so the machine skips them.`;
    else if (last && total < sim.total) ending = `Your steps end after ${total} s, before the shot is done; give the last step more time or use P5.`;
    else ending = "Steps at 0 s are skipped.";
    $("lcc-after").textContent = `Brew at ${fmt1(base.temperature)}°C. ${stopAt} ${ending}`;

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

    state.converted = converted;
    state.copyText = [
      `Lelit3 profile: ${base.name}${edited ? " (edited)" : ""}`,
      ...slots.map((s) => s.untilStop ? `P${s.slot}  ${s.pressure.toFixed(1)} bar  until stop` : s.unused ? `P${s.slot}  0 bar  0 s` : `P${s.slot}  ${s.pressure.toFixed(1)} bar  ${s.seconds} s${s.pressure === 0 ? " (bloom)" : ""}${s.spare ? ` (incl. ${s.spare} s spare)` : ""}`),
      `${fmt1(base.temperature)}°C, stop at ${targetWeight > 0 ? `${fmt1(targetWeight)} g, ` : ""}around ${shotTime} s`,
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
      $("link").value = b.dataset.sample;
      loadUrl(b.dataset.sample);
    }));

  $("recent-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-recent]");
    if (b) openRecent(readRecent()[+b.dataset.recent]);
  });
  $("recent-clear").addEventListener("click", () => {
    store.set("recent", "[]");
    renderRecent();
  });

  $("fellow-open").addEventListener("click", () => openFellow(null));
  $("fellow-close").addEventListener("click", () => (form.hidden = true));
  $("add-infusion").addEventListener("click", () => {
    const steps = readFellow().infusion;
    steps.push({ pressure: steps.length ? steps[steps.length - 1].pressure : 9, duration: 10 });
    renderInfusion(steps);
  });
  form.addEventListener("input", () => ($("fellow-error").textContent = ""));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = readFellow();
    const problem = fellowProblem(v);
    $("fellow-error").textContent = problem;
    if (problem) return;
    state.url = null;
    state.load = { fellow: v };
    show(LC.sources.fellow.parse(v));
    setStatus("");
  });

  // Changing how the profile is converted replaces any hand edits.
  document.querySelectorAll('input[name="minsec"]').forEach((r) =>
    r.addEventListener("change", () => {
      state.minSeconds = +r.value;
      store.set("minsec", state.minSeconds);
      state.edits = null;
      state.editing = false;
      render();
      saveRecent();
    }));
  $("grind").addEventListener("input", (e) => {
    state.grind = +e.target.value;
    store.set("grind", state.grind);
    state.edits = null;
    state.editing = false;
    render();
    saveRecent();
  });

  // Target weight
  $("target").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || v < 5 || v > 200) {
      $("target-error").textContent = "Enter 5–200 g.";
      return;
    }
    $("target-error").textContent = "";
    const original = state.profile.targetWeight;
    state.target = Math.abs(v - original) < 0.05 ? null : v;
    render();
    saveRecent();
  });
  $("target").addEventListener("blur", () => {
    $("target-error").textContent = "";
    render();
  });
  $("target-reset").addEventListener("click", () => {
    state.target = null;
    $("target-error").textContent = "";
    $("target").blur();
    render();
    saveRecent();
  });

  // Step editor
  $("edit").addEventListener("click", () => {
    if (!state.editing && !state.edits) state.edits = editsFromSlots(state.converted);
    state.editing = !state.editing;
    if (!state.editing && sameEdits(state.edits, editsFromSlots(state.converted))) state.edits = null;
    render();
    saveRecent();
    if (state.editing) {
      const first = $("lcc").querySelector("input");
      if (first) first.focus();
    }
  });
  $("edit-reset").addEventListener("click", () => {
    state.edits = null;
    state.editing = false;
    render();
    saveRecent();
  });
  $("lcc").addEventListener("input", (e) => {
    const el = e.target;
    if (!el.dataset || el.dataset.i == null) return;
    const v = parseFloat(el.value);
    if (!Number.isFinite(v)) return; // half-typed; wait for a number
    const i = +el.dataset.i;
    const k = el.dataset.k;
    state.edits[i][k] = k === "pressure" ? LC.clamp(v, 0, LC.LELIT.maxPressure) : LC.clamp(Math.round(v), 0, 120);
    render(true);
    saveRecent();
  });
  // Tidy the value once you leave a field: pressure in 0.5 bar steps.
  $("lcc").addEventListener("change", (e) => {
    const el = e.target;
    if (!el.dataset || el.dataset.i == null) return;
    const i = +el.dataset.i;
    const k = el.dataset.k;
    if (k === "pressure") state.edits[i].pressure = LC.roundHalf(state.edits[i].pressure);
    el.value = k === "pressure" ? state.edits[i].pressure.toFixed(1) : state.edits[i].seconds;
    render(true);
    saveRecent();
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
  renderRecent();

  const start = new URLSearchParams(location.search).get("u");
  if (start) {
    $("link").value = start;
    loadUrl(start);
  }
})();
