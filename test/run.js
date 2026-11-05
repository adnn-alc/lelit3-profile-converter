// Runs real profiles through the converter in Node (no installs needed):
//   node test/run.js            print steps and paddle guides
//   node test/run.js --check    exit non-zero if any sanity check fails
// Needs internet: it downloads the profiles from metprofiles.link and visualizer.coffee.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = { console, fetch, window: {} };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["tables.js", "sources/meticulous.js", "sources/decent.js", "sources/fellow.js", "simulate.js", "fit.js", "guide.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "js", f), "utf8"), ctx, { filename: f });
}
const LC = ctx.LC;

const CASES = [
  ["Meticulous", "https://metprofiles.link/profile/81498c90-4b9d-4848-a817-600deb38917c"],
  ["Meticulous", "https://metprofiles.link/profile/1d619dc5-e318-4c09-89e0-3bf5dbb58cb1"],
  ["Meticulous", "https://metprofiles.link/profile/4cca1c82-4b5c-40b2-bca4-6edd4f1bfed8"],
  ["Decent shot", "https://visualizer.coffee/shots/2dae3b33-a1f4-40f4-bd48-70d1eba7c380"],
  ["Decent shot", "https://visualizer.coffee/shots/2ab2b66b-b067-4d3f-b690-b8dd5a30a930"],
  ["Fellow", null],
];

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

function rms(a, b) {
  // Compare two [t, p] curves at 0.5 s intervals.
  const end = Math.min(a[a.length - 1][0], b[b.length - 1][0]);
  const at = (c, t) => { const i = c.findIndex((x) => x[0] >= t); return i < 0 ? c[c.length - 1][1] : c[i][1]; };
  let s = 0, n = 0;
  for (let t = 0; t <= end; t += 0.5) { s += (at(a, t) - at(b, t)) ** 2; n++; }
  return Math.sqrt(s / n);
}

(async () => {
  for (const [kind, url] of CASES) {
    let profile;
    if (kind === "Meticulous") profile = await LC.sources.meticulous.fetchUrl(url);
    else if (kind === "Decent shot") profile = await LC.sources.decent.fetchUrl(url);
    else profile = LC.sources.fellow.parse(LC.sources.fellow.SAMPLE);

    const sim = LC.simulate(profile);
    const intent = LC.intentCurve(sim.curve, sim.stages);
    for (const minSeconds of [2, 4]) {
      const steps = LC.fitSteps(intent, { minSeconds });
      const total = steps.reduce((a, s) => a + s.seconds, 0);
      const resp = LC.lelitResponse(steps, total);
      check(steps.length >= 1 && steps.length <= 5, `${profile.name}: ${steps.length} steps`);
      check(steps.every((s) => s.seconds >= Math.min(minSeconds, total)), `${profile.name}: a step is shorter than ${minSeconds} s`);
      check(steps.every((s) => s.pressure >= 0 && s.pressure <= 10 && (s.pressure * 2) % 1 === 0), `${profile.name}: pressure out of range or not in 0.5 steps`);
      const slots = LC.toSlots(steps);
      if (profile.name === "Adaptive v2") check(steps.some((s) => s.pressure === 0 && s.seconds >= 5), "Adaptive v2: the 6 s Dripping bloom should be a 0 bar step");
      check(slots.length === 5 && slots.every((s, i) => s.unused === (i >= steps.length)), `${profile.name}: steps aren't packed from P1`);
      check(steps.every((s, i) => slots[i].pressure === s.pressure), `${profile.name}: slot pressures don't match the steps`);
      const lastSlot = slots[steps.length - 1];
      check(steps.length === 5 ? lastSlot.untilStop : lastSlot.seconds === steps[steps.length - 1].seconds + 10, `${profile.name}: last step timing is wrong`);
      check(Math.abs(total - Math.ceil(sim.total)) <= 1, `${profile.name}: step time ${total} vs shot ${sim.total.toFixed(1)}`);
      if (minSeconds === 4) {
        console.log(`\n== ${profile.name} (${profile.source}) ${profile.temperature}°C, ${profile.targetWeight} g, ~${sim.total.toFixed(0)} s, ${sim.recorded ? "recorded" : "simulated"}`);
        console.log("   steps:", steps.map((s) => `${s.pressure.toFixed(1)}bar×${s.seconds}s`).join("  "));
        console.log(`   fit error vs source: ${rms(intent, steps.flatMap((s, i, arr) => { const t0 = arr.slice(0, i).reduce((a, x) => a + x.seconds, 0); return [[t0, s.pressure], [t0 + s.seconds - 0.01, s.pressure]]; })).toFixed(2)} bar rms; expected Lelit gauge vs source: ${rms(sim.curve.map((c) => [c[0], c[1]]), resp).toFixed(2)} bar rms`);
        const guide = LC.buildGuide(sim, profile);
        check(guide.length >= 1, `${profile.name}: empty guide`);
        guide.forEach((g) => console.log(`   ${String(Math.round(g.t0)).padStart(3)}–${String(Math.round(g.t1)).padEnd(3)}s ${g.name}: ${g.action}, ${g.cue}${g.intent ? `  [${g.intent}]` : ""}`));
      }
    }

    // For recorded Decent shots, check the simulator against reality.
    if (sim.recorded && profile.phases.length) {
      const fake = Object.assign({}, profile, { recorded: null });
      const s2 = LC.simulate(fake);
      console.log(`   simulator vs real shot: ${rms(sim.curve.map((c) => [c[0], c[1]]), s2.curve.map((c) => [c[0], c[1]])).toFixed(2)} bar rms, sim ${s2.total.toFixed(0)} s vs real ${sim.total.toFixed(0)} s`);
    }
  }
  if (failures.length) {
    console.log("\nFAILED:\n - " + failures.join("\n - "));
    if (process.argv.includes("--check")) process.exit(1);
  } else console.log("\nAll checks passed.");
})().catch((e) => { console.error(e); process.exit(1); });
