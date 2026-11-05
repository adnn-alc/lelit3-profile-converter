# Lelit3 converter

Turn espresso profiles from other machines into something you can pull on a
**Lelit Victoria3 or Elizabeth3**:

- **On the machine:** up to 5 pressure steps to program into coffee button 1
  or 2. P1–P4 have a time; P5 runs until you stop the shot (or the button's
  max time), so the last step always goes on P5 and unused steps get 0 s.
- **By hand with the paddle:** a phase-by-phase guide with a paddle % to start
  from, the pressure to aim for on the gauge, and when to move on.

It runs entirely in the browser. Nothing to install, nothing uploaded.

## What it reads

| Source | How |
| --- | --- |
| Meticulous | A [metprofiles.link](https://metprofiles.link) profile link, or an exported `.json` file |
| Decent | A [visualizer.coffee](https://visualizer.coffee) shot link (uses the real recorded pressure), or a profile / shot `.json` file |
| Fellow Series 1 | A form for the numbers on a brew.link page (Fellow doesn't let other sites read those pages) |

Links can be shared: the page puts the profile link in its own address, for
example `…/?u=https://metprofiles.link/profile/<id>`.

## How it converts

1. **Read** the profile into one common shape: phases that control pressure,
   flow or pump power, with their exit conditions and limits.
2. **Get a pressure curve.** Recorded Decent shots use the real data. Other
   profiles are simulated against a simple puck model: the basket fills, the
   puck builds resistance as it saturates, then slowly erodes. The model was
   tuned against real Decent shots (pressure within about 0.5–1.5 bar rms).
   The grind slider changes how hard the puck pushes back.
3. **Fit up to 5 steps** with dynamic programming: the split with the least
   error, where no step is shorter than the "shortest step" setting (2–5 s).
   An extra step has to earn its place.
4. **Handle the fill.** A 0 bar step would switch the Lelit pump off, so the
   opening fill uses the step pressure whose free flow matches the original
   fill flow. A fast climb straight after the fill is left to the Lelit, which
   ramps up by itself.
5. **Write the paddle guide** from every original phase, using the Pagaia
   tables (paddle % → ml/s, profile bar → ml/s).

Meticulous and Decent machines can steer by flow; the Lelit holds a pressure
or a pump power. So the converter copies the shape and timing of the pressure
curve, which is what you can see and control on a Lelit.

## Things to confirm on a real machine

These live in [`js/tables.js`](js/tables.js) and are easy to change:

- Pressure range and step size for profile steps (assumed 0–10 bar, 0.5 bar steps).
- How fast the Lelit climbs and drops between steps (assumed 2 and 1.5 bar/s).
- That a 0 s step is skipped, so unused P2–P4 can sit between the opening steps and P5.
- The Pagaia tables were measured with no coffee in the basket.

## Run it

Open `index.html` in a browser. That's it. Locally served works too:

```bash
python3 -m http.server 8765
```

### Tests

The test runner downloads real profiles and checks the conversions (needs
Node 18+ and internet, no packages):

```bash
node test/run.js
```

Add `--check` to exit with an error when a check fails.

## Files

```
index.html              page
css/style.css           styles (light and dark)
js/tables.js            Pagaia tables, Lelit limits, helpers
js/sources/meticulous.js  metprofiles.link and Meticulous .json
js/sources/decent.js      visualizer.coffee and Decent .json
js/sources/fellow.js      Fellow Series 1 form values
js/simulate.js          profile → pressure curve (puck model)
js/fit.js               pressure curve → up to 5 Lelit steps
js/guide.js             paddle guide
js/chart.js             canvas chart
js/load.js              detects what a link or file is
js/app.js               page wiring
test/run.js             conversion checks against real profiles
```

Plain scripts, loaded in order (not ES modules), so the page also works when
opened straight from disk.

## Publish on GitHub Pages

In the repository on GitHub: **Settings → Pages → Build and deployment →
Deploy from a branch → `main` / root**. The site appears at
`https://<user>.github.io/<repo>/` after a minute.

Profiles belong to their authors.
