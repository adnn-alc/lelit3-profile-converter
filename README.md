# Lelit3 profile converter

Turn espresso profiles from Meticulous, Decent and Fellow machines into
something you can pull on a **Lelit Victoria3 or Elizabeth3**.

**Open it here: https://adnn-alc.github.io/lelit3-profile-converter/**

## What you get

- **On the machine:** up to 5 pressure steps (bar and seconds) to program into
  coffee button 1 or 2. Blooms become 0 bar steps (the pump pauses for that
  long). Steps you don't need stay at 0 bar, 0 s.
- **By hand with the paddle:** a phase-by-phase guide with where to put the
  paddle, what the gauge should read, and when to move on.
- **A chart** comparing the original pressure with what the Lelit will do.

## How to use it

1. Paste a profile link, open a profile `.json` file, or pick one of the
   starting points (light, medium and dark roast, milk drinks, turbo, bloom).
2. Pick the shortest step you want (2–5 s). Short wiggles get folded into
   longer steps.
3. Change the target weight if you want a different yield; the steps and
   shot time follow.
4. Program the steps into your machine, or follow the paddle guide. To tweak
   a step, press **Edit steps**; the chart redraws as you type.
5. Dial in with the grind: if the gauge stays below the targets, grind finer;
   if it overshoots or the shot runs fast, go coarser. Stop the shot at the
   target weight on your scale.

Your last few conversions, with your edits, are kept under **Recent** in
this browser.

## Supported profiles

| Machine | Use |
| --- | --- |
| Meticulous | A [metprofiles.link](https://metprofiles.link) profile link, or an exported `.json` file |
| Decent | A [visualizer.coffee](https://visualizer.coffee) shot link, or a profile `.json` file |
| Fellow Series 1 | The numbers from a brew.link page, typed into the built-in form |

Shot links from visualizer.coffee convert best, because they contain the real
pressure the machine recorded. Other profiles are simulated with an average
puck; the grind slider adjusts it.

To share a conversion, copy the page address after converting. It includes the
profile link.

## Why it isn't a perfect copy

Meticulous and Decent machines can steer by flow and let the pressure follow
the puck. The Lelit holds a target pressure (profiles) or a pump power (paddle)
instead, and a profile has at most 5 steps. So the converter copies the shape
and timing of the pressure curve, which is what you can see and control on a
Lelit. Profiles with many phases are simplified for the machine; the paddle
guide still follows every phase.

## Privacy

Everything runs in your browser. Files you open are never uploaded, and the
Recent list stays in your browser's storage.

## Offline use

Download the repository and open `index.html`. Loading links still needs an
internet connection.

## License

[MIT](LICENSE). Profiles you convert belong to their authors.
