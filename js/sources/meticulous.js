// Meticulous profiles: metprofiles.link links and exported .json files.
//
// Every source is turned into the same shape:
//   {
//     source, name, author, notes, temperature, targetWeight,
//     phases: [{
//       name,
//       control: "power" | "flow" | "pressure",
//       points: [[x, value], ...],   // x is seconds, grams or ml into the phase
//       over: "time" | "weight" | "volume",
//       rampFromCurrent: bool,       // first point starts from the live value
//       exits: [{ type, op, value, relative }],
//       maxPressure, maxFlow,        // limits, null when unset
//     }],
//     recorded: null | { t, p, f, w, phaseStarts }   // a real shot, when known
//   }
(function () {
  const LC = window.LC;

  const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  function matchUrl(url) {
    if (!/metprofiles\.link/i.test(url)) return null;
    const m = url.match(UUID);
    return m ? m[1] : null;
  }

  async function fetchUrl(url) {
    const id = matchUrl(url);
    if (!id) throw new Error("That metprofiles.link address has no profile id in it.");
    const res = await fetch(`https://metprofiles.link/api/profiles/${id}/download`);
    if (!res.ok) throw new Error(`metprofiles.link answered ${res.status}. Check that the profile still exists.`);
    return parse(await res.json());
  }

  function looksLike(json) {
    return json && Array.isArray(json.stages);
  }

  function parse(json) {
    const vars = {};
    (json.variables || []).forEach((v) => (vars[v.key] = v.value));
    const val = (x) => {
      if (typeof x === "string" && x.startsWith("$")) {
        const key = x.slice(1);
        if (!(key in vars)) throw new Error(`The profile uses a variable "${key}" it doesn't define.`);
        return LC.num(vars[key]);
      }
      return LC.num(x);
    };

    const phases = json.stages.map((s) => {
      const d = s.dynamics || {};
      const over = d.over === "weight" ? "weight" : d.over === "piston_position" ? "volume" : "time";
      const points = (d.points || [[0, 0]]).map(([x, y]) => [val(x), val(y)]);
      const limit = (type) => {
        const l = (s.limits || []).find((l) => l.type === type);
        return l ? val(l.value) : null;
      };
      const exits = [];
      (s.exit_triggers || []).forEach((e) => {
        const type = { time: "time", pressure: "pressure", flow: "flow", weight: "weight", piston_position: "volume" }[e.type];
        if (!type) return; // user_interaction, power: nothing to simulate
        exits.push({
          type,
          op: e.comparison === "<=" ? "<=" : ">=",
          value: val(e.value),
          relative: type === "time" ? e.relative !== false : !!e.relative,
        });
      });
      const control = ["power", "flow", "pressure"].includes(s.type) ? s.type : "pressure";
      return {
        name: s.name || control,
        control,
        points,
        over,
        rampFromCurrent: false,
        exits,
        maxPressure: control === "pressure" ? null : limit("pressure"),
        maxFlow: control === "pressure" ? limit("flow") : null,
      };
    });

    return {
      source: "Meticulous",
      name: json.name || "Meticulous profile",
      author: json.author || "",
      notes: (json.display && (json.display.description || json.display.shortDescription)) || "",
      temperature: LC.num(json.temperature, 93),
      targetWeight: LC.num(json.final_weight, 0),
      phases,
      recorded: null,
    };
  }

  LC.sources = LC.sources || {};
  LC.sources.meticulous = { matchUrl, fetchUrl, looksLike, parse };
})();
