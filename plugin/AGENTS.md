# AGENTS.md — Metro Calendar plugin guidelines

## Core Design Philosophy & Constraints

* **Platform:** Non-touch 1-bit / high-contrast e-Paper display (TRMNL).
* **Aesthetic:** Authentic London Underground / NYC Subway transit diagram geometry.
* **Strictly Prohibited:** HTML/CSS card containers, pill buttons, polygon boxes, diagonal background hatching, gray fill blocks, and box-border frames around event text.
* **Core Rule:** Render events as **pure typographic signage** anchored by continuous, single-stroke SVG track paths.

## Data Sources

* `transform.js` is a real **TRMNL Serverless** entry point — exported function must be named `run(input)`, not `transform` (renaming it breaks the live plugin even though local `trmnlp serve`/`build` doesn't care, since `transform_runtime: disabled` bypasses it entirely).
* Two sources, chosen by the **Use Demo Data** boolean setting: the hardcoded demo events (default, no network) — a day in Springfield: Homer, Marge, Bart & Lisa and Maggie, with the plant and the school as sidings, or a pasted **Calendar Config (JSON)** — same shape as this repo's `calendar-config.json`/`demo-config.json` — fetched as real ICS and parsed with a hand-rolled parser (no ICS library available in Serverless).
* RRULE support is a **bounded subset**: only `FREQ=WEEKLY` (+ optional BYDAY, UNTIL and INTERVAL) is evaluated against each day of the run. INTERVAL matters more than it looks: a fortnightly sprint review read as plain weekly fires on the off weeks too, and the ceremonies most likely to carry one are exactly what a work calendar is full of. EXDATE is honoured, so an occurrence deleted out of a series is not drawn. Other patterns (DAILY/MONTHLY/YEARLY, COUNT) and all-day events are not shown. A `RECURRENCE-ID` override IS honored: it suppresses the master's occurrence on that date, otherwise an edited/moved single instance of a standing meeting renders twice ("standup twice").
* **Demo mode** runs `DEMO_CONFIG` (in transform.js) through the real fetch/parse/rule pipeline against the ICS files in `demo/` on this repo's `main`, so the configuration every new device starts on is also a worked example of the config format — and is covered. `test/transform/cases/demo-config.js` serves those files from disk. The hardcoded Springfield day (`DEMO_EVENTS` etc.) stays as the offline fallback for when GitHub is unreachable. Note the ICS files must be on `main` for a live device to see them.
* The **rule engine** (is covered by `test/transform/` (`npm test` there, no Docker): match types `any`/`all`, `exact`, `word`, `contains`, `regex`, `status`, `weekday`, `and`/`or`, `not` (`{matcher: Matcher}`, negates it — prefer this over a regex negative lookahead for "one of these except that one," since it needs no backslash escaping to get wrong); actions `track` (string or list), `rename` (defaults true, but false on an any/all match), `rewrite`/`rewriteFull`, `hide`, `allDay`, `siding` (a timed event's own track leaves the running line for its span and rejoins, instead of branching into a lane — for a status/location block like "Desk booking" that spans real meetings without being one; needs both a start and end time, so it's timed-events-only, never all-day); top-level `rules` run before each calendar's own (calendar wins ties); the first `tracks[]` entry is the `everyoneTrack` fallback; calendars may be bare URL strings; non-JSON config text is a newline-separated URL list; per-calendar `headers` go on the fetch. A `track` list becomes an interchange (`owner` + `co_owners`). Per-calendar `includeDescription: true` is the only thing that makes DESCRIPTION get parsed and matched — off by default. (Legacy configs may use `people`/`person` in place of `tracks`/`track` — still accepted, for anyone who set this up before tracks were called tracks.)
* **The forecast covers a run of days; the board draws one of them, at a particular minute.** Every fact taken out of the snapshot has to be indexed by the day it describes and, when it names an hour, held to the clock. This has gone wrong four separate ways: the wettest hour scanned across both days, so tomorrow's rain became today's service alert; the rain markers ran on into day 1 as soon as day 0 had fewer than two crossings, carrying "it is raining" over the midnight gap and drawing a "Rain Stops 07:00" before the "Rain Starts 13:00" it belonged to; sunrise/sunset were a hardcoded `[0]`; and `now_min` was passed through on a board showing tomorrow, parking a car on every line at a minute nobody had reached. The snapshot now records the civil day of its own day 0 (`snap.date`) and `buildFromConfig` slides the index by the days elapsed, so a forecast fetched at 23:30 and read at 04:00 is read as the yesterday it is. A banner is a promise about what is COMING: `wettestHour(hours, from)` re-picks the hour at draw time, the hour happening right now still counts, and a day that is not today gets no clock at all. Tests: `service-alert.js` ("Nothing in the past") and `multi-day.js` ("The sky band, the clock, and the day they belong to").
* Tracks are **dynamic** in config mode, not the fixed 3 from demo data — discovered from `config.tracks` (a `color` there overrides the auto hue cycle) plus any calendar whose events resolve to no rule-assigned track (that calendar's own name becomes a fallback track, so nothing silently vanishes). Side (left/right) is decided once every calendar is fetched and every event tallied: an explicit `track.side` wins, everyone else is balanced by their own event count (heaviest first, each to whichever side is currently lighter) — not by any calendar's name.

---

## Layout (see ../DESIGN.md for the full algorithm)

* **All geometry is client-side** in `shared.liquid`'s `<script>`: `transform.js` returns raw facts only (events with `start_min`/`end_min`, `owner`/`co_owners`, `side`, `hue`, `track_offset`, `line_width`, `line_style`; weather milestones with `at_min`; `now_min`, `date_label`, `orientation`). No pixel or percentage positions come from the backend — it can't know the canvas size, the zoom factor, or how wide a title renders.
* **Orientation:** the `orientation` setting (`auto`/`horizontal`/`vertical`); auto = horizontal on a landscape canvas. One algorithm in axis coordinates serves both.
* **Bands:** each track gets its own stretch of the cross-axis — its baseline, room for its siding kink, then its OWN lanes — so a branch never reaches across a neighbouring track and cannot cross one. Band sizes come from what each track's events actually need (measured by placing that track alone first); leftover room goes to lane pitch, then to separation between tracks, both capped, and the rest is centred. When the bands cannot fit — the 800x480 panel with a few all-day kinks — it falls back to the original packed bundle with one lane pool shared per side. Interchanges are a thin tie between the lines with a ring on each, not one capsule stretched across the gap; a station junction is a hollow diamond.
* **Bands:** every track gets its own stretch of the cross-axis — baseline, siding kink room, then its OWN lanes, sized to what its events need and spread over the canvas. An event may only take a lane rung its own track owns, so a branch can't reach across a neighbour (an interchange takes its rung from the OUTERMOST line it joins, where its ring physically sits). When bands can't fit — the 800x480 panel with a few all-day kinks — it falls back to the old packed bundle with one shared lane pool per side.
* **Line treatments (the Mini Metro pass):** every line is SOLID and thick. A dashed line is a weak mark on e-ink — it is mostly paper, so it reads faint however dark the ink is, and a dotted one all but disappears against the hour labels. Lines are told apart by WEIGHT and by what is knocked OUT of the stroke: `plain` (a solid bar), `casing` (a paper stripe down the middle, reading as two parallel lines), `hatch` (paper rungs at a regular pitch, the railway hatch), `beads` (paper dots at a wider pitch). All four keep a continuous black envelope, so they are equally heavy at a glance and equally legible at 1-bit. A treated line is drawn WIDER by `widen`, because what the eye weighs is the ink and not the envelope. The overlay is an exact clone of the same geometry in the CANVAS colour, carries no `data-metro-role` (it is not a line, it is a hole in one) and is found by `data-metro-overlay`; a treated line ends FLUSH (`stroke-linecap: butt`) because a round cap sticks out half a stroke past where the path stops while the paper core cut out of it does not, so every join between two drawn pieces grew a solid bar across the pattern; where its pattern repeats it takes the same phase the ramp does, so a run drawn as several elements is hatched continuously. `line_style` still carries the four names the config and transform use; `treatmentFor` is where they stop meaning "dash pattern".
* **Spine:** every track's line runs full-bleed along the axis in one bundle;
* **Symbols** follow standard transit-map grammar (`feedback/research/metro-map-guide.md`), because that vocabulary is what lets the diagram be read without a key: a **tick** across the line for a local stop (the line calls here), a **hollow ring** only for an interchange (you can change lines here), a **dashed tie** joining a ring on each line for an out-of-station interchange (one event on several people's lines, which with bands are rarely adjacent), a **hollow diamond** for a station junction, **concentric rings** for the major hub an all-day landmark gets, a **bar** at each terminus. Spending the ring on every ordinary appointment is the mistake to avoid: it says every appointment is an interchange, and a busy line becomes eight identical circles.
* **A shared EVENT is a BUNDLE: one rail per line, not one rail for the group.** Several people in one place is several lines arriving at it, so the drawing is several rails. Each line sends a branch straight down from where it runs to its own rung of a bundle, in its OWN stroke, with the start dot and end tick every other rail gets. This reverses an earlier decision: drawn as a comb it read as a smudge, and the reason was that the rails were stacked on one minute with nothing between them. Four rules make it read now, and each one exists because its absence broke a picture:
  * **The bundle sits in the WIDEST GAP between two of the lines in it**, so everybody travels about as far as everybody else. Put beyond the outermost line, the far one fell the whole depth of the board while the nearest barely moved, which reads as one line visiting another. Widest gap and not the midpoint, because with an odd number of lines the midpoint IS the middle line. A gap with the hour river in it is never chosen; where every gap straddles it (members on both sides) the bundle goes out to the event's own lane instead.
  * **Rungs keep the order the lines actually RUN in**, read off `lineCAt`, never off `_dist`. Distance from the spine is unsigned, so two lines on opposite sides both read as "near": ordered that way, Work dropped to the lower rung while Alex climbed to the upper one and the two rails crossed.
  * **Drops share a minute unless they must not.** A rail only has to turn earlier than another if its own drop passes through where that other rail will lie; then it turns first, so its vertical stands left of where the other's horizontal begins. Rails that pass nothing of each other's turn together, which is both tidier and truer. Staggering all of them alike spread three drops over three minutes to solve a conflict between two.
  * **A rail crossing a line it does not belong to is BROKEN for it** (`tunnelSegments`): it reads as passing under, and the line on top stays whole. It needs no extra drawing, because the trunk is already painted by the time a branch goes over it, so the gap simply shows the trunk through. The hole is the crossed line's own width plus air.
  Rails sit a stroke of paper apart, tighter than the gap the map keeps between unrelated lines because reading as a group is the point, and never tighter than that: below one stroke two rails merge into one thick one (3px was tried and could not be seen). The label hangs off the end of the bundle facing away from the spine, since the lane the event was given is where the bundle STARTS, not where it ends. An event too short to be worth a bundle keeps the interchange tie and its ring.
* **`colorFor('black')` is a ROLE, not a colour** — it resolves to the theme's ink, and `'white'` to its paper. A line assigned literal black vanished on a dark board, and it was the anchor: the heaviest line on the map, drawn in the same ink as the canvas. Because a colour can now be a CSS variable, every stroke and fill goes through `.style`, never a presentation attribute (SVG attributes do not accept `var()`).
* **The car stands up differently.** Lying down it is the drawn train from `assets/metro-car.svg`, wheels on the rail. Standing up it is a plain rounded block beside the line: rotated, the train reads as one that has fallen over, and a side view has a front and a back, which a vertical line does not.
* **One end mark per rail.** The group's far end and its last member's own end are the same point, so a terminus bar and a stop tick were both landing there — and where the event was too short for a tick, only the bar. Same place, two shapes, depending on the length of the meeting. The tick is the mark, drawn per event, always.
* **Shared sidings draw their lines TOGETHER.** An ordinary siding kinks a line AWAY from the spine; a shared one kinks its members toward each other (inner steps out, outer steps in) so they run alongside each other for the length of the thing they are both at, with a bar across them at each end of the span. Two people at the same school kinking away from each other read as two unrelated sidings that happened to share a name. Direction comes from board order (`track_offset`), not cross positions, because those are still being solved when `sidingRaiseAt` is read; that function returns a SIGNED delta now. Members on opposite sides of the spine keep the ordinary outward kink — converging across the middle would cross the hour river.
* **Labels stay by their rails.** A full lane slides labels along it rather than refusing them, and the slides accumulate: on a line with five wide captions the last sat two hours right of its own branch, which reads as a caption with no branch at all. Drift now bumps the lane demand (`lastPlaceDrift`) and is scored in `layoutAttempt` above crossings, so the tier ladder will step the text down to put captions back beside their rails.
* **No box behind a label.** An opaque panel over a metro map reads as a hole punched in it. Text carries a thin paper outline instead (`paint-order: stroke fill`, which puts the stroke behind the glyphs so the letterforms keep their weight).
* **One event, drawn once:** two calendars can describe the SAME thing (Bart's "L6 School Day" and Lisa's "L2 School Day" both rename to "School Day" over the same hours). `mergeAcrossTracks` in transform.js folds anything with the same title over the same minutes into one event with `co_owners`. A merged STATION still emits one entry per owner — both children really are at school, so both lines kink — sharing a `group` id so the client draws the caption once, set midway between the lines it belongs to. Both the merge and a rule-assigned track list feed `registry.link()`.
* **Track order:** the lines are laid out as ONE chain, strongest shared-event link first, extended at whichever end offers the next strongest. The board is a chain too (outermost left … innermost left, spine, innermost right … outermost right), so a chain laid along it keeps every consecutive pair adjacent and can be cut anywhere. The cut is chosen to balance the two sides and to fall on a weak link; an explicit `side` rules out any cut that contradicts it. The anchor line (black, boldest, solid) is the first track the config names, else the busiest.
* **How much day:** `DAY_LO`/`DAY_HI` stretch to fit what is actually on the board, an hour before the first thing and 90 minutes after the last, clamped to real midnight. That tail is the room a late event's label needs. The quiet ends cost almost nothing because the client runs them as express sections. There is no orientation setting: the timeline always runs along the canvas's longer side.
* **Marks on a rail:** the START is a hollow dot, the END a tick. Every marker is filled with the CANVAS colour and outlined in its line's, so it masks the line behind it and reads the same on a 4px black trunk as on a dotted grey one — a solid dot in its own line's colour is the one thing that cannot be seen, being the same ink as what it sits on. Importance is carried by SIZE, never by fill: stop < interchange < hub (`feedback/research/mini-metro-notes.md`). The dot goes where the line actually IS at that minute, found with `pointOnPathAtAxis` on the ramp element — the start of a rail is a corner, corners are drawn rounded, and a marker placed on the vertex floats in the gap inside the elbow. A tick is a bar drawn ACROSS the line and the start of a rail is usually a bend (the ramp arrives at exactly that minute), so a tick there lay over the corner — on a vertical drop it read as the line overshooting its own rail, on a 45° ramp as a blot. A dot sits ON the line instead of across it, so it can mark a corner. A group leaves the trunk ONCE, at its earliest elbow: after that the rail is already lying there flat, so a second ramp would drop into a line that was already horizontal.
* **The car** stands ON its line rather than through it (anchored at its wheels, y=65 in `metro-car.svg`). `MIN_DIAG` is sized so the shallowest branch clears a car's height off the trunk, and `LEAD_CAP` follows `MIN_DIAG` — pinned at two corner radii it fell below `MIN_DIAG` and every branch on the board went vertical at once.
* **Line names** sit ABOVE their line's starting bar, not in a column beside it, so the day gets that width back; they are measured against `lineCAt` sampled across the name's whole width, since a track that begins inside one of its own all-day sidings starts raised. Standing up they keep the head-of-the-map column at the smaller size — there the names run along their lines and the lines are only a track-step apart.
* **Marks:** a marker at the true start time, never moved. A station junction (where a line kinks out to siding level) is a hollow diamond, so a change of state reads differently from something happening on the line. An interchange is a thin tie between the lines it joins with a ring on each, not a filled capsule — with bands the lines can be most of the canvas apart. Rings and ties are placed with `lineCAt()`, the single source of truth for where a line actually is (baseline + siding kink + terminus ramp).
* **Branches (the ramp builder):** every place a line leaves its trunk for a lane, or comes back, is one shape from one function — a lead-in lying ON the trunk, a bend away, a straight run, a bend flat, a tail along the lane. Departures and rejoins, 45° and vertical, either side of the spine, either orientation, are all that with different arguments. **Two shapes only:** a shallow drop takes the 45° ramp (it leaves a drop's width early, which at `MIN_DIAG` is a few px); anything deeper goes fully vertical at its own minute. Nothing in between — steepening a 45° ramp to fit a deep lane looks like a mistake, and easing a vertical one out to 45° makes it leave an hour before its event (`RAMP_LEAD` caps the lead at two corner radii). Where the drop marks the start, the start tick is dropped: it is collinear with the drop and reads as the line overshooting its own rail. **A ramp is drawn in the stroke of the line it grows from** — for an interchange that is the outermost rail it joins, not the nominal owner. Its lead-in lies on top of the trunk, so its dash pattern is offset by the trunk's own arc length at that point (`trunkLenAt`, measured on the real path element so siding kinks count); the overlay then falls exactly on the trunk's dashes and disappears. That offset is the whole reason the elbow no longer has to be drawn solid. Rejoins are the exception, not the rule: only a solo event of four hours or more (`MIN_REJOIN_MIN`) climbs back; everything else ends on a terminus bar.
* **Sidings** (config `siding: true`, `transform.js`'s `metro.sidings`): a track's own line leaves the running line for the event's `[start_min,end_min]` span and rejoins at the end, instead of branching into a lane — rings sit at the true, unmoved boundary times where the 45° kink itself starts/ends (`sidingRaiseAt` in `shared.liquid` ramps the raise across that same kink, so a real event's ring landing inside the transition zone still sits exactly on the drawn line). For a status/location block ("Desk booking") that spans real meetings without being one; those meetings still fork off the raised segment normally via `e._trackDist`/`e._trackDistEnd`, which factor in the raise at that event's own axis position.
* **Lanes:** labels are measured as real DOM boxes, then placed chronologically, innermost lane first. Same-owner branches that overlap in a lane share one spur (the label slides along it; the ring feeds into it). Another owner's line or text blocks the lane. Overrunning the axis end drops the time tag, then ellipsises the title, and only then allows a backward branch. Unplaceable events are counted in "+N more".
* **The board carries as many LINES as it has room for** (`fitLines`) and counts the rest into the overflow note. A line needs its own stretch of cross axis — the line, its siding-kink room, and one lane deep enough for a two-row label — and below that five lines on a 240px panel do not get cramped, they get illegible. The lines kept are the busiest, because a line with one event costs the same room as a line with six and tells you less. One line is a valid board.
* **Line names sit above their line only when there is room above it**, decided after the bands are solved from the real track pitch; where the tracks end up closer together than a name is tall, each name lands on its neighbour's ("Lisa" and "Marge" came out as one word), so they sit ON their own line instead and their paper outline masks it.
* **Weights come down with the pitch** (`weightScale`). Line widths are tuned for a board where every track has a band; on a panel where they end up a track-step apart, a 6px line is a third of the gap to the next one and the map turns into stripes.
* **Marks are sized off the RAIL, not off a constant** (`markOut`). At a fixed radius the start dot vanished into a heavy line and stood clear of a light one, so the same mark read as a knob on one track and a bar on another.
* **Small screens:** text tier ladder (drop location → smaller title → drop time) retried until the fewest events are lost; the visible window narrows around now when hours get too dense; hour labels thin out; header compacts by canvas size, not view name.
* **TRMNL X zoom:** the framework zooms high-density screens ~2×. Work in layout px (`offsetWidth`) and divide `getBoundingClientRect()` measurements by the zoom factor; scale constants with `TRMNLPaint.px(1, {kind:'ui'})`.
* **Line names:** a terminus column is reserved out of the start of the axis and every line begins there with its own name, at its own height, capped by a terminal bar at each end. There is no legend and no lettered-bullet fallback — the name is on the line rather than in a key. (Ideas.md's "give each track a named starting station".)
* **Sky band:** sunrise/sunset and rain start/stop markers (icon + text) sit in a band along the top edge in horizontal mode, beside the bundle in vertical mode, each with a guide line across the map.
* **Text size:** the tier ladder starts as big as the canvas allows (`title--xlarge` on TRMNL X) and steps down only while that improves layout quality (drops, crossings, slid elbows, backward branches).
* **i18n:** English lives inline in `I18N` in `transform.js` and is the fallback; every other language is a JSON file in `i18n/<code>.json`, fetched from raw.githubusercontent at render time (budgeted against the render deadline, cached in `trmnl_state`, silently English on failure), so a new language is a pull request. Strings reach the template as `metro.i18n`; dates use Intl with the account locale; `time_format` auto = 12h only for US-style locales, and `temperature_unit` auto = Fahrenheit only for an en-US locale.
* **Header:** the date and the visible window are solid ink pill badges with the text knocked out of them — on e-ink that is the highest-contrast mark available, and it gives the header two fixed anchors that read from across a room. This is the one place a pill is allowed; around a label on the map they are still prohibited.
* **Prohibited:** cards, pills, boxes or borders around event text; hardcoded hex colours (use `TRMNLPaint`, black for 1-bit); moving per-pixel layout back into `transform.js`.
* **Landmarks:** an all-day event is the day's landmark on its line — a full-width band plus the concentric major-hub marker a transit map gives its biggest stations.
* **Layout tests:** see "Testing the layout" below. `test/layout/` (`npm test` there) renders the real built page in headless Chromium against fixture METRO payloads and asserts geometry invariants. Elements carry `data-metro-role` (`track`/`branch`/`fork`/`capsule`/`ring`/`station-ring`/`stop`/`bullet`/`now`/`car`) purely so tests can tell them apart — keep them on anything new that gets drawn.
* **Debug:** the canvas's `data-metro-debug` attribute lists the chosen orientation, window, spine position, lane counts, resolved colours and every event's placement. Read it with headless Chrome `--dump-dom` on a `trmnlp build` with the device's `screen--*` classes injected.
* **Local preview:** `.trmnlp.yml` mirrors the demo data (transform runtime disabled) — regenerate it after changing `DEMO_EVENTS`/`DEMO_STATIONS`/`DEMO_ALLDAY` (command in the file's header). `trmnlp lint` reports `lat_lon` as an unknown field type; that is the local linter lagging behind the server.


---

## Testing the layout

This suite exists because the layout kept regressing in ways nobody noticed
until a screenshot arrived. Read this before adding to it, and before
trusting it.

### What the harness actually does

`test/layout/run.js` runs `trmnlp build`, swaps the baked demo `metro:` block
for a fixture, loads the page in headless Chromium with the **real** 18MB
TRMNL framework CSS, waits for the layout to settle, and has the page report
every drawn thing in one coordinate space (screen px, canvas-relative). SVG
paths are **sampled** with `getPointAtLength`, never read as control points,
so a rounded or curved path is checked as the shape it really draws.
Assertions run out in Node against that report. `layout(fixture, viewport)` is
memoised per fixture+viewport, so ten tests on one board cost one render.

### The rule that matters: test the truth, not the tidiness

Every assertion in here is one of two kinds, and only one of them catches
real bugs on its own.

* **Well-formedness** — lines meet, nothing overlaps, markers sit on their
  line, nothing falls off the canvas. Cheap, fast, and satisfied by drawings
  that are complete nonsense.
* **Truthfulness** — the drawing says what the data says. A label is not
  drawn before the time of the event it names. A rail is as long as its
  event, not as long as its label. A tick is at the start minute and another
  at the end minute.

A branch once ran two hours backwards to find room, so "Family Dinner"
appeared at 17:00 for a 19:00 event. Every well-formedness test passed: the
line met its trunk, the label collided with nothing, the ring was centred.
`cases/honesty.js` is the answer to that, and it is the file to extend first
when a new kind of thing gets drawn. **When a visual bug is reported and the
suite is green, the missing test is almost always a truthfulness one.**

### Do not trust a green run you have not looked at

Two failure modes have both bitten here, and both look like success:

1. **The invariant is measured against the wrong set of elements.** The ring
   test compared markers to `track` and `branch` paths only. Where a branch
   dives just a lane's minimum, the whole diagonal fits inside the corner
   fillet — so the `branch` path collapses to a point and the `fork` path IS
   the line. The test reported a tick as adrift by exactly the length of the
   diagonal it was sitting on, and the "fix" attempts all moved the drawing.
   *Before believing a geometry failure, print what the marker's nearest
   neighbours are in every role.*
2. **The test is wrong and the code is right.** A rail-connection test was
   written against the elbow when it should have been against the rail end.
   It went green on a broken build. If a test starts passing right after you
   change it, re-derive what it asserts from the picture.

### The loop

1. **Reproduce visually first.** Build, screenshot at a real device size,
   crop and zoom to the defect. Never start from the test output.
2. **Probe with numbers.** Drop a throwaway `cases/zz-probe.js` that renders
   one fixture and `assert(false, ...)`s the values you care about (console
   output from a case is not shown; the assertion message is). Read the
   canvas's `data-metro-debug` attribute for each event's chosen lane,
   direction, node/elbow/text positions and track distance.
3. **Fix, then re-screenshot.** A passing suite is not evidence the picture
   is right.
4. **Add the test that would have caught it** — stated as the property, not
   as the pixel values you just observed.
5. **Run the whole suite.** It takes a few minutes; run it in the background
   rather than narrowing to the test you just wrote.

### Writing a good case

* Assert a **property with a reason**, and put the reason in a comment: what
  broke, what it looked like, why this tolerance and not a tighter one.
  Every tolerance in this suite has a written justification, because an
  unexplained one gets loosened silently the next time it fails.
* **Loop over all fixtures** unless the case is about one specific board.
  Fixtures are bug reports: `busy-day` (the everyday case), `all-day-every-track`
  and `siding-day` (siding kinks moving every line off its baseline),
  `quiet-day` (must not invent overlaps out of empty space), `tight-pair`
  (same-owner events minutes apart), `full-day` (express-compressed head and
  tail). Add a fixture when a bug needs a board shape none of these has.
* **Failure messages carry the evidence**: which element, where, off by how
  much. `'3 label(s) with a line through them: "Team Standup" pierced 15px'`
  is debuggable from CI output alone; `'assertion failed'` costs a full
  re-derivation.
* **Check the views.** `og-*` and `x-*`, full/half-horizontal/half-vertical/
  quadrant, plus portrait. Vertical broke for weeks because one path skipped
  `toXY`; the test that found it found it on its first run.

### Known issues, not skips

`test(name, fn, { known: 'why' })` marks a real, understood, unfixed defect.
It reports without failing the run, **and fails if it ever starts passing**,
so a fix cannot land without the marker coming off. Use it for a genuine
trade-off you have decided to accept; never to quiet a failure you have not
diagnosed. The `why` string must name the trade-off, not the symptom.

### Before pushing a layout change

* `cd test/layout && npm test` — 0 failures, and the known-issue count has
  not grown without a written reason.
* `./test.sh` at the repo root for `transform.js` and the config editor.
* Screenshots of the affected views at real device sizes, zoomed on what
  changed.
