# Handover

Written mid-session for whoever picks this up. `issues.md` is the backlog;
this file is the state of the workshop around it: what is half-done, what is
not what it looks like, and the things that will waste your time if nobody
tells you.

Read `AGENTS.md` and `plugin/AGENTS.md` first. They are still accurate.

---

## 1. The tree is not clean, and two agents are still writing to it

At the time of writing, `git status` shows three modified files, and **two
background agents are still working and will drop more changes in**:

| path | who | state |
|---|---|---|
| `plugin/src/shared.liquid` | me | one unverified change, see §2 |
| `test/layout/cases/views.js` | me | a new test that does not work, see §2 |
| `plugin/src/settings.yml` | an agent, mid-flight | do not touch |

The two agents in flight were asked for:

- **Settings groups + the weather alert's data half** (`settings.yml`,
  `transform.js`, `test/transform/`, `i18n/`). That is `issues.md` C1 and
  the non-drawing half of E6. It was told to expose
  `metro.service_alert = { text, kind } | null`, fully composed and
  translated, so the template only prints it. **The banner drawing and the
  canvas reflow were deliberately left out of its brief and are still to
  do.**
- **Preset library in the editor** (`tools/config-editor.html`,
  `test/config-editor/`, and the three top-level `.md` docs). That is E5.

Both were told not to commit. If their results never arrive, their work is
still on disk; check the files above and run the suites.

**Do not `git add -A` while an agent is running.** I did that earlier and
swept three agents' in-flight files into a commit whose message says nothing
about them. Commit explicit paths.

---

## 2. The one change in the tree I do not stand behind

`plugin/src/shared.liquid`, in the terminus-name block: I moved the line
name clear of its own terminal bar and increased the vertical clearance,
because at 3x zoom on the `seven-lines` board the bar sits hard against the
first letter ("Crew" reading as "|Crew").

Three things you need to know about it:

1. **The test I wrote for it (`views.js`, "a line name never touches its own
   terminal bar") passes on the old code as well.** It asserts the boxes do
   not overlap, and they never did: the label element carries 3px of padding,
   so the bar lands in the padding rather than on the glyph. The test
   therefore pins nothing. Either rewrite it to assert a minimum *gap* (and
   justify the number from a measurement, not a guess) or delete it.
2. **After the change the gap is still about 1.3px** at the rendered size,
   so the change may not even have achieved what it was for. I had not
   finished checking when the session ended.
3. Reverting it costs nothing. `git checkout -- plugin/src/shared.liquid
   test/layout/cases/views.js` if you would rather start clean.

What I am confident of: at 300% zoom on `seven-lines`, six of seven names
are drawn **on** their rail rather than above it. That is the documented
fallback (`-nameThick / 2`, "centred ON the line, masked by its own paper
outline") and the masking works: the rail visibly stops at the text. It is
not a bug. It only looks like one at high zoom.

---

## 3. Corrections to `issues.md`

- **A5 is wrong. Delete it.** I recorded "a station shared by five lines
  draws five separate pills" from a screenshot. Those five pills are the
  five **cars**, one per line, all at the same minute. The shared-station
  corridor works correctly: on `seven-lines`, "Delivery Run" bends all five
  crew lines together and captions them once, exactly as intended.
- That misreading is itself the argument for **E1b** (the user's "one car,
  not one per line"): a column of five or seven cars at the same minute
  reads as a stack of blobs, and I misread my own board because of it. E1b
  is worth doing and is cheap.
- **A11 is done** (the layout suite now renders small views as slots). It is
  ticked but left in the file as a warning, see §5.

---

## 4. What is actually left, and what it costs

14 open items. Grouped by what they really are:

**Cheap, well understood (an hour or two each)**

- `A3` station captions collide, `A4` simultaneous branches overlap,
  `A8` a long wrapped name meets the first event label, `A10` a branch and
  a station ramp grazing at the same minute. All are the same shape of work
  as the ones fixed this session: reproduce, probe, fix, re-screenshot, add
  the test, run the suite.
- `A7` quadrant backwards branch. **Cheaper than it looks now**, because
  until this session the harness could not render a quadrant at all (§5).
- `E1b` one car. Small, but it is a design comparison: build it, screenshot
  both, keep the better one.
- `C1` settings groups. An agent may already have finished it.

**Moderate**

- `D5` collapse location and time metadata before bending geometry on small
  boards.
- `E5` editor presets. An agent may already have finished it.
- `E6` the weather banner. An agent has the data half; the drawing and the
  canvas reflow in `shared.liquid` are still open.

**The big one, and it is not written down as such anywhere but here**

- **`E2`, `E3` and `E4` all assume a multi-day board, and this plugin has
  never drawn one.** There is exactly one day in the payload
  (`day_start_min` / `day_end_min`), the weather is fetched with
  `forecast_days: 1`, and `metro.days` appears nowhere in the template. A
  date *range* header, a midnight terminal and a sleeper event crossing the
  night are all views of a thing that does not exist. The day model is the
  work; those three are what sits on top of it. I would treat it as its own
  project and not start it inside a bug-fixing pass.
- `E4`'s axis compression is the exception: the scale already compresses
  quiet hours (`aFor`, `EXPRESS_RATE`), so the night express is an extension
  of something real rather than something new.

Two known issues are recorded honestly in `geometry.js` rather than papered
over: holding a branch's elbow inside its own event leaves one branch
crossing a caption on two boards. That was a deliberate trade (the
alternative drew a ring detached from a stub of rail) and the reasoning is
in the comment beside it. Do not "fix" it without reading that first.

---

## 5. Traps that cost me time today

- **`trmnlp pull` destroys the working tree.** It overwrites every local file
  with the server's copy, and the server's `shared.liquid` is the stripped,
  minified build `push.sh` uploads. Use `trmnlp clone NAME ID` into `/tmp` to
  inspect the server.
- **The framework pins `.screen` to the device's own size whatever the window
  is.** Asking Chromium for a 400x240 window and calling the result a
  quadrant renders a full 800x480 board and crops it. A half or a quadrant is
  a *slot inside* the screen: override `--full-w` / `--full-h`, which is the
  one knob a real mashup turns. Until this session **every small-view case in
  the layout suite was measuring a full-size board under a small view's
  name**. They pass now, but any conclusion drawn from one before this is
  worth re-checking, and that includes conclusions written into comments.
- **`{n}` inside a Liquid output tag ends the tag.** `{{ x | default: "{n}
  more" }}` takes the whole template down with a syntax error that only shows
  up as a 900-byte build. Build the string with `{% assign %}` first, the way
  `rain_pct` does.
- **A test that passes the moment you write it has told you nothing.** Two of
  mine did today; one is still in the tree (§2). Before believing a new test,
  put the old file back and watch it fail:
  `git show HEAD:plugin/src/shared.liquid > plugin/src/shared.liquid`, build,
  run, restore. Stashing does not work for this, it takes the new test away
  too.

---

## 6. How to run things

```sh
./test.sh                       # transform (132) + config editor (37+)
cd test/layout && node run.js   # layout, ~1m20, headless Chromium
cd test/layout && node run.js "some substring"   # just the matching cases
```

The layout suite renders are cached on content, so a case that mutates a
fixture and calls `render()` directly is a cache hit. Expect
`265/273 passed, 8 known issue(s), 0 failure(s)` plus whatever the agents
added.

Screenshots, which the layout rules say you must take before and after any
layout change:

```sh
SP=/tmp/claude-1000/-home-dev-workspace-trmnl-family-calendar/23ce89ca-c964-4dc0-81fd-dc5e12dffec9/scratchpad
node -e "const f=require('./test/layout/fixtures.js');require('fs').writeFileSync('$SP/x.json',JSON.stringify(f.find(y=>y.name==='seven-lines').metro))"
cd plugin && trmnlp build && cd ..
python3 $SP/swap.py $SP/x.json          # swap the fixture into _build/full.html
bash $SP/shotv.sh $SP/out.png "screen--v2 screen--lg screen--4bit screen--density-2x" 1872 1404
convert $SP/out.png -crop 300x200+400+300 +repage -resize 400% $SP/zoom.png
```

`shotv.sh` takes the **view** size, not the window size, and is the only one
of the two scratchpad shot scripts that tells the truth about small views.
`swap.py` and `shotv.sh` live in the scratchpad and are throwaway; if they
are gone, `test/layout/run.js` has the same logic in `pageFor`.

Publishing:

```sh
./plugin/push.sh                # strips comments, minifies, verifies, uploads
node plugin/verify-build.js     # renders _build/full.html and insists a map appeared
```

`push.sh` restores the working copies on the way out whatever happens, checks
both files against the server's 100KB limit before uploading anything, and
will not upload a build that does not actually lay a map out. The minifier
deliberately leaves identifiers alone so the layout suite can measure the
artefact that ships; I ran the whole suite against the minified build and it
is green.

The standing workflow the user expects: **run `./plugin/push.sh` and commit
after every fix.** Commit messages end with the two attribution lines used
throughout the history.

---

## 7. Two standing instructions worth repeating

- **No em dashes anywhere.** Code, comments, YAML, docs, the AI prompt. The
  user has said so twice, and once they rendered as a literal `&mdash;` on
  the settings page.
- `calendar-config.json` is gitignored and holds the user's real calendar
  URLs. Never commit it, never print it.
