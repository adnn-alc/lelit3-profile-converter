// Decent profiles and recorded shots from visualizer.coffee, plus Decent
// profile .json files (de1app "v2" JSON) and Visualizer shot downloads.
(function () {
  const LC = window.LC;
  const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const API = "https://visualizer.coffee/api/shots";

  function matchUrl(url) {
    if (!/visualizer\.coffee/i.test(url)) return null;
    const m = url.match(UUID);
    return m ? m[1] : null;
  }

  async function fetchUrl(url) {
    const id = matchUrl(url);
    if (!id) throw new Error("That visualizer.coffee address has no shot id in it.");
    const shotRes = await fetch(`${API}/${id}/download`);
    if (!shotRes.ok) throw new Error(`visualizer.coffee answered ${shotRes.status}. The shot may be private or deleted.`);
    const shot = await shotRes.json();
    let profile = null;
    try {
      const profRes = await fetch(`${API}/${id}/profile?format=json`);
      if (profRes.ok) profile = await profRes.json();
    } catch (_) {
      // The recorded curve is enough on its own.
    }
    return parseShot(shot, profile);
  }

  function looksLikeProfile(json) {
    return json && Array.isArray(json.steps);
  }

  function looksLikeShot(json) {
    return json && json.data && Array.isArray(json.data.espresso_pressure) && Array.isArray(json.timeframe);
  }

  function parseProfile(json) {
    const phases = [];
    json.steps.forEach((s) => {
      const seconds = LC.num(s.seconds);
      if (seconds <= 0) return; // de1app skips zero-length steps
      const control = s.pump === "flow" ? "flow" : "pressure";
      const target = LC.num(s[control]);
      const smooth = s.transition === "smooth";
      const exits = [{ type: "time", op: ">=", value: seconds, relative: true }];
      if (s.exit && s.exit.type) {
        exits.push({
          type: s.exit.type === "flow" ? "flow" : "pressure",
          op: s.exit.condition === "under" ? "<=" : ">=",
          value: LC.num(s.exit.value),
          relative: false,
        });
      }
      if (LC.num(s.weight) > 0) exits.push({ type: "weight", op: ">=", value: LC.num(s.weight), relative: false });
      if (LC.num(s.volume) > 0) exits.push({ type: "volume", op: ">=", value: LC.num(s.volume), relative: true });
      const lim = s.limiter ? LC.num(s.limiter.value) : 0;
      phases.push({
        name: s.name || control,
        control,
        points: smooth ? [[0, null], [seconds, target]] : [[0, target]],
        over: "time",
        rampFromCurrent: smooth,
        exits,
        maxPressure: control === "flow" && lim > 0 ? lim : null,
        maxFlow: control === "pressure" && lim > 0 ? lim : null,
      });
    });
    const first = json.steps[0] || {};
    return {
      source: "Decent",
      name: json.title || "Decent profile",
      author: json.author || "",
      notes: (json.notes || "").replace(/\n*Downloaded from Visualizer\s*$/, ""),
      temperature: LC.num(first.temperature, 93),
      targetWeight: LC.num(json.target_weight) || LC.num(json.target_volume) || 0,
      phases,
      recorded: null,
    };
  }

  function parseShot(shot, profileJson) {
    const d = shot.data;
    const t = shot.timeframe.map((x) => LC.num(x));
    const p = d.espresso_pressure.map((x) => LC.num(x));
    const f = (d.espresso_flow || []).map((x) => LC.num(x));
    const w = (d.espresso_weight || []).map((x) => LC.num(x));

    // The DE1 flips espresso_state_change at every step boundary.
    const phaseStarts = [];
    const sc = d.espresso_state_change || [];
    let prev = null;
    for (let i = 0; i < sc.length && i < t.length; i++) {
      const v = LC.num(sc[i]);
      if (v !== 0 && v !== prev) phaseStarts.push(t[i]);
      if (v !== 0) prev = v;
    }
    if (!phaseStarts.length || phaseStarts[0] > 1) phaseStarts.unshift(0);
    phaseStarts[0] = 0;

    const base = profileJson && looksLikeProfile(profileJson)
      ? parseProfile(profileJson)
      : { source: "Decent", name: shot.profile_title || "Decent shot", author: "", notes: "", temperature: 93, targetWeight: 0, phases: [] };

    const lastW = w.length ? w[w.length - 1] : 0;
    return Object.assign(base, {
      source: "Decent shot",
      name: shot.profile_title || base.name,
      author: shot.user_name || base.author,
      targetWeight: LC.num(shot.drink_weight) || lastW || base.targetWeight,
      recorded: { t, p, f, w, phaseStarts },
    });
  }

  LC.sources = LC.sources || {};
  LC.sources.decent = { matchUrl, fetchUrl, looksLikeProfile, looksLikeShot, parseProfile, parseShot };
})();
