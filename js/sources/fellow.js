// Fellow Espresso Series 1 profiles.
// brew.link pages can't be read by other sites, so the values are typed into
// a form (or pasted as JSON). The fields match Fellow's own profile data.
(function () {
  const LC = window.LC;

  function matchUrl(url) {
    const m = url.match(/brew\.link\/p\/([A-Za-z0-9_-]+)/i);
    return m ? m[1] : null;
  }

  function looksLike(json) {
    return json && Array.isArray(json.infusion) && "preInfusionEnabled" in json;
  }

  const DEFAULTS = {
    title: "Fellow profile",
    temperature: 93,
    dose: 18,
    ratio: 2,
    transition: "fast",
    preInfusionEnabled: true,
    preInfusionFillFlowRate: 4,
    preInfusionHoldPressure: 3,
    preInfusionDuration: 8,
    infusion: [{ pressure: 9, duration: 20 }],
    rampDownEnabled: false,
    rampDownEndPressure: 6,
    rampDownDuration: 10,
  };

  function parse(json) {
    const j = Object.assign({}, DEFAULTS, json);
    const smooth = j.transition && j.transition !== "fast";
    const phases = [];
    if (j.preInfusionEnabled) {
      const dur = LC.num(j.preInfusionDuration);
      const hold = LC.num(j.preInfusionHoldPressure);
      phases.push({
        name: "Pre-infusion fill",
        control: "flow",
        points: [[0, LC.num(j.preInfusionFillFlowRate, 4)]],
        over: "time",
        rampFromCurrent: false,
        exits: [
          { type: "pressure", op: ">=", value: hold, relative: false },
          { type: "time", op: ">=", value: dur, relative: false },
        ],
        maxPressure: hold,
        maxFlow: null,
      });
      phases.push({
        name: "Pre-infusion hold",
        control: "pressure",
        points: [[0, hold]],
        over: "time",
        rampFromCurrent: false,
        exits: [{ type: "time", op: ">=", value: dur, relative: false }],
        maxPressure: null,
        maxFlow: null,
      });
    }
    (j.infusion || []).forEach((s, i) => {
      const dur = LC.num(s.duration);
      if (dur <= 0) return;
      const p = LC.num(s.pressure);
      phases.push({
        name: j.infusion.length > 1 ? `Infusion ${i + 1}` : "Infusion",
        control: "pressure",
        points: smooth ? [[0, null], [Math.min(dur, 4), p]] : [[0, p]],
        over: "time",
        rampFromCurrent: smooth,
        exits: [{ type: "time", op: ">=", value: dur, relative: true }],
        maxPressure: null,
        maxFlow: null,
      });
    });
    if (j.rampDownEnabled && LC.num(j.rampDownDuration) > 0) {
      const dur = LC.num(j.rampDownDuration);
      phases.push({
        name: "Ramp down",
        control: "pressure",
        points: [[0, null], [dur, LC.num(j.rampDownEndPressure)]],
        over: "time",
        rampFromCurrent: true,
        exits: [{ type: "time", op: ">=", value: dur, relative: true }],
        maxPressure: null,
        maxFlow: null,
      });
    }
    return {
      source: "Fellow Series 1",
      name: j.title || "Fellow profile",
      author: j.roasterName || "",
      notes: j.notes || "",
      temperature: LC.num(j.temperature, 93),
      targetWeight: Math.round(LC.num(j.dose, 18) * LC.num(j.ratio, 2) * 10) / 10,
      phases,
      recorded: null,
    };
  }

  // A shared profile, read once from brew.link, used as the built-in sample.
  const SAMPLE = {
    title: "Slayer",
    temperature: 93.88,
    dose: 19,
    ratio: 2,
    transition: "fast",
    preInfusionEnabled: true,
    preInfusionHoldPressure: 1,
    preInfusionFillFlowRate: 1.5,
    preInfusionDuration: 25,
    infusion: [{ duration: 15, pressure: 9 }],
    rampDownEnabled: true,
    rampDownEndPressure: 6,
    rampDownDuration: 10,
    notes: "Pay attention to the first drops during pre-infusion. They should show up around the 25 second mark.",
  };

  LC.sources = LC.sources || {};
  LC.sources.fellow = { matchUrl, looksLike, parse, DEFAULTS, SAMPLE };
})();
