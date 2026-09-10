# Open work

Everything outstanding, newest brief first. Tick a box only when the fix is
on `main` **and** on the device, with a test or a screenshot behind it.

Order of attack: the board is broken in front of the user (A), then the
configuration that produced it (B), then the settings and robustness work
(C, D), then the new features (E). Nothing in E starts while anything in A
is open.

---

## A. The board is wrong right now

- [x] **A1. Tracks squashed into a third of the board.** Seven lines at a
  ~35px pitch with ~700px of unused depth below them. Pass 3 of the
  separation solver spends the spare cross-axis room on lane pitch FIRST
  (`STEP_CAP = laneStep * 1.35`), and lane pitch is charged per lane summed
  over every track, so it eats the entire surplus before track separation
  (`SEP_CAP`) gets a look in. Spend on separation up to what the names need,
  then on lanes.
  Repro: `demo/futurama` + the AI config, X landscape.
- [x] **A2. Line names sitting on their own rails.** Falls out of A1: with
  no pitch there is no room above the rail, so `fitNameLines` drops the name
  onto the line and it collides with the terminus cap ("|Leela"). Re-check
  after A1; the existing test only covers 5 lines, so it needs a 7-line
  fixture.
- [x] **A3. Station captions collide.** "Lab Rotation" wraps to two lines
  and lands on "Delivery Run" and on two rails.
  Three faults in one picture. Captions were placed one line at a time and
  knew nothing about each other, so two that wanted the same strip of
  canvas simply both took it; they are placed in a second pass now,
  least-freedom-first, so the caption pinned to a two-hour station keeps
  its spot and the one with seven hours of corridor to slide along is the
  one that yields. A caption pushed out of its own loop kept wrapping to
  two lines, in a lane where every other box is a one-line title, and its
  second line landed on the event label below; out there it is clamped to
  one line and ellipsised. And a solo station NESTED inside another of its
  own line's stations gets no siding at all (`stationRaiseAt` hands the
  whole overlap to the outer one), so "inside the loop" was a space that
  was never vacated, half a raise off a baseline the line had left: with no
  kink of its own the caption now sits off the line where that line really
  runs. `cases/sidings.js` covers it on every fixture at both views.
- [ ] **A4. Simultaneous branches on different lines overlap.** "Coffee
  (100 cups)" (Fry, 07:30) and "Bend Some Girders" (Bender, 07:30) drop
  their stubs at the same axis position, a few px apart.
- [x] **A5. WITHDRAWN, this was a misreading.** "A station shared by five
  lines draws five separate pills" was written off a screenshot. Those pills
  are the five CARS, one per line, all at the same minute. The shared-station
  corridor is correct: on `seven-lines`, "Delivery Run" bends all five crew
  lines together and captions them once. The misreading is itself the
  argument for E1b below: a column of cars at one minute reads as a stack of
  blobs, and it fooled the person who drew it.
- [x] **A6. Terminator tick misplaced on a backwards branch.** "Walk
  Nibbler" (17:30 to 18:15) puts its end tick in the wrong place.
- [ ] **A7. Quadrant on TRMNL X: a backwards branch is mangled.** "Family
  Dinner" on the Simpsons board. Its stub runs the wrong way and detaches.
  A large part of this is fixed: a backward group's flat rail was drawn as
  `bridge(elbow + RAMP_LEAD, g.to)`, which is right for a forward group and
  nonsense for a backward one (the ramp's tail stops at `elbow -
  RAMP_LEAD`, so the bridge began a whole lead the other side of the elbow
  and ran to an end it had already passed, drawing nothing). The rail
  stopped two corner radii past its own elbow with its terminus bar left
  further down the lane on its own. `cases/loose-ends.js` catches it.
  Left open until it has been looked at on the board it was reported from:
  `five-lines` on an X quadrant now draws "Family Dinner" correctly, but
  that report predates the harness fix in A11, so it was written about a
  picture that was not a quadrant.
- [ ] **A8. A long wrapped track name overlaps the first event label.**
  Known, carried over: "Demo - Planet / Express Crew" touches "07:30 - 08:15
  Bender: Bend Some Girders". The name is not an obstacle to label placement.

- [x] **A13. A stretch of rail floating in the middle of the board.**
  Reported off a screenshot. It was the express half of a siding whose
  siding was never drawn: a solo station nested inside a corridor its own
  line was already in never kinks the line, so there was no loop, and
  `expressThrough` drew the straight half anyway, on the baseline the line
  had left. Nothing in the suite noticed, because the segment was the right
  colour, the right weight, on the canvas, clear of everybody's text and
  claimed by no marker. It was simply a line that went nowhere.
  `cases/loose-ends.js` is the answer: every rail end must meet another
  rail, sit under a mark that caps it, or be the edge of the board. It
  found the detached backward stub in A7 on its first run, and it needed
  `terminus()` to start setting `data-metro-role`, which it never had.
- [x] **A9. The trunk was interrupted where a siding began.** The kink's
  corners are rounded, so the trunk leaves its baseline a corner radius
  before the station's own start; the siding began at the bare vertex, and
  the two did not meet.
- [ ] **A10. A branch and a station ramp meeting at the same minute graze
  each other.** With the car no longer a solid block the junction reads, but
  the branch still leaves tangent to the corner rather than out of it, and a
  spike of the flat rail pokes out from under the kink.
- [ ] **A12. A junction redraws a stretch of the main line it does not
  need to, and the copy does not register with the original.** Reported off
  a zoomed junction: the trunk is visibly drawn twice for the length of the
  lead-in, so the casing's paper stripe steps sideways where the copy takes
  over and the elbow gets a notch out of it.
  The lead-in is `trunkSlice(p, aFrom - dir * RAMP_LEAD, aFrom)` in
  `rampOut`: two corner radii of the trunk, copied into the branch's own
  path so that the departure becomes an INTERIOR vertex and `roundedPath`
  fillets it. That is its only job. Everything else about it is an attempt
  to make the copy invisible: it is drawn in the trunk's stroke, at the
  trunk's real breakpoints (so it lies on a station kink rather than flat
  across it) and with its dash phase offset by `trunkLenAt` so the rungs
  fall on the trunk's own. Three things that have to agree exactly, on a
  stretch that carries no information, to hide something the reader was
  never meant to see. When any of them is off by a pixel the line reads as
  doubled.
  A fillet does not actually need a vertex to be interior: the corner can
  be built as its own arc from a point ON the trunk, and then the branch
  starts where it leaves and nothing is redrawn. Worth doing before A10,
  which is the same elbow seen from the other side.
- [ ] **A15. A track should carry events on BOTH sides of its line.**
  Every lane a track owns sits OUTWARD of it, so a line at the edge of the
  bundle has all of its labels on one side and the gap between it and its
  neighbour goes unused. On the everyday board, Work has six events stacked
  above it and nothing below, while the space south of its rail is empty.
  Reported as: "if Work would have some events to the south of its track,
  there would be more room to play with"; "a track should have events on
  both sides, unless constricted by space".
  The change is in the pure solver, which is where it can be driven
  cheaply: `buildSide` walks a side outward emitting `n` rungs per track
  beyond its baseline, and a rung is `{dist, owner}` whose position is
  `spineC + sign * dist`. Both-sided means splitting a track's allocation
  into inward and outward rungs, charging the band for both, and giving a
  rung a SIDE so `placeSide` knows whether the label hangs above or below
  its rail. Inward rungs live in the gap between this track and the one
  before it, so two tracks are now competing for one space and the solver
  has to hand it out rather than both assuming it.
  Do it against `test/cross`, not against renders: the fit, the ordering
  and the monotonicity are all arithmetic, and that suite answers in
  milliseconds.

- [~] **A14. The cross-axis solver gives up too early and then wastes what
  it saved.** Two of the three parts are done. The solver is a pure
  function now, lifted out of the closure between `CROSS_SOLVER_BEGIN/END`
  markers, and `test/cross` runs it directly: 32 cases including 400 seeded
  random boards, in milliseconds, with no browser.
  Fixed: the CLIFF (packing was a last resort, so forty pixels of extra
  canvas took a board from six rungs packed to five rungs banded, a bigger
  board fitting less; both layouts are now computed and compared every
  time, bands win ties and packing has to earn it with more content), and
  the WASTE (the surplus was capped at a couple of track-steps and the rest
  centred as margin, so two lines on a 1300px panel used a fifth of it;
  the cap is a share of the room per line now, and the surplus goes into
  the gaps BETWEEN the lines, which is where the inner one's labels live).
  Still open: `fitLines` decides how many lines the board carries from a
  cost estimate of its own (`TRACK_STEP + LANE_BASE + hourH * 2.6`) that is
  much cheaper than a band. On an X quadrant it allows five lines, none of
  which can then have one, so the board packs five rails into 50px with
  every label stacked beyond them. Asking the solver instead would carry
  three lines with bands. That is a trade of content for legibility and
  wants a decision, not a patch. Reported off an X quadrant of the Simpsons board: five lines
  crammed into a 40px pitch in the middle, every label stacked outside the
  bundle, and the bottom fifth of the canvas empty.
  It is A1 again, on the other path. `solve()` lays each side out as
  bands, where a track's own lanes sit in the gap between it and the next
  track outward, which is exactly "use the inner spaces". When the bands
  do not fit at their tightest it falls back to `buildPacked`: every track
  at a fixed pitch with ONE lane ladder per side, beyond all of them. That
  is a cliff, not a gradient. The board either gets inner lanes for every
  track or none for any, and having chosen none it does not go back and
  spend the room it just freed.
  What the picture asks for is a first pass that decides the layout from
  what each track actually needs and then keeps spending: bands where they
  fit, packing only the tracks that cannot have one, and the surplus back
  into the gaps between the rails rather than centred as whitespace. Pass 3
  already has the shape of this (`STEP_CAP`, `SEP_CAP`, grow while it still
  fits); it just never runs on the packed path, and packing is all or
  nothing per side.
  This is a rework of the solver, not a patch. Sizeable, and worth doing
  before more is layered on top of the current split.
- [x] **A11. Every "small view" in the layout suite was rendering full
  size.** Fixed in the harness (a half or a quadrant is a slot inside the
  screen, not a smaller screen). Left here as a note: any conclusion drawn
  from a small-view test before this is worth re-checking.

## B. The configuration that produced it

- [x] **B1. A calendar `name` silently becomes a line.** The AI named its
  feeds "Crew" and "Deliveries" and got two phantom lines next to the five
  people, then pinned them on the board with `hideIfEmpty: false`. The
  prompt must say what `name` does; the editor should warn when a calendar
  name is not also a track name.
- [x] **B2. "Let an AI do it" belongs at the top of the editor**, right
  after Start, not after the user has configured everything by hand.
- [x] **B3. The prompt should carry a full worked example** of an advanced
  configuration, not only the schema.
- [x] **B4. Drop `timeZone` and `locale` from the prompt.** They are account
  settings; an assistant guessing them makes the board wrong.
- [x] **B5. Remove `side` and `color` everywhere.** Both are automatic. Out
  of the editor UI, out of the prompt, out of the docs; `parseConfig` keeps
  reading them so existing configs do not break.

## C. Settings

- [ ] **C1. Move the demo settings into a Developer group.**
- [x] **C2. Remove the "6am 11pm" span pill from the header.** It says
  nothing the axis does not.
- [x] **C3. Quadrant and the small vertical views: "+3 earlier" does not
  fit** and collides with the clock badge. Show "+3" alone below some width.
- [x] **C4. Quadrant and half-horizontal (sm/md) waste a whole header band**
  on a logo and the word "Today". Collapse it on those views.
- [x] **C5. Temperature unit setting.** Auto (from locale) / Celsius /
  Fahrenheit. Overridable from the config JSON, but not surfaced in the
  editor or the AI prompt.

## D. Robustness

- [x] **D1. Timeouts and errors.** Every fetch needs its own timeout inside
  the serverless deadline, one slow feed must not cost the whole board, and
  a failed feed must not silently vanish.
- [x] **D2. Saved state** (https://help.trmnl.com/en/articles/16777795),
  as the earlier version of this plugin had it. Return `trmnl_state` and
  read `input.trmnl.state`:
  - last good weather, reused when the API fails, with a staleness flag
  - `calendarDown[url]`: first failure timestamp, so a feed that has been
    down more than ~2h is called out by name instead of quietly missing
  - `calendarNames[url]`: the last `X-WR-CALNAME`, so a feed that fails
    keeps its name instead of becoming "Calendar 2"
  - cached i18n payload
- [x] **D3. i18n as JSON files in the repo**, fetched by `transform.js`, so
  a new language is a pull request. English stays inline as the fallback for
  when GitHub is unreachable.
- [x] **D4. Demo weather data** in the demo configs, covering every weather
  event (rain start/stop, snow, storm, fog, sunrise, sunset) so they can be
  seen without waiting for real weather.
- [ ] **D5. Small screens: collapse secondary metadata before geometry.**
  On a board like OG half-vertical with 6+ short events on one track, drop
  location text, then start/end times, rather than bending the baseline.
- [x] **D6. Optimise the logo SVG per colour variant.**

## E. New features

> **E2, E3 and E4 assume a multi-day board, and this plugin has never drawn
> one.** There is one day in the payload (`day_start_min` / `day_end_min`),
> the weather is fetched with `forecast_days: 1`, and the template has no
> notion of a second day at all. A date RANGE header, a midnight terminal
> and a sleeper event spanning the night are all views of a thing that does
> not exist yet, so the day model comes first and is the largest single
> piece of work on this list. E4's axis compression is the exception: the
> scale already compresses quiet hours (`aFor`, EXPRESS_RATE), so the night
> express is an extension of something real.

- [x] **E1. The metro car should read as a train.** Outline it, hollow it
  out, or set the track's initial inside it.
- [ ] **E1b. One car, not one per line.** Instead of a train on every line,
  a single high-contrast car marking the current time for the whole board:
  riding the hour strip, or sitting on the active time position, as the "you
  are here". Worth trying against what is there now (a car per line, each
  carrying its line's initial, which says where each person is rather than
  only what time it is) and keeping whichever reads better on a panel.
- [ ] **E2. Dynamic date range header.** Single day: `Today · Thu 10 Sep ·
  07:00 - 21:00`. Multi-day: `Thu 10 Sep - Fri 11 Sep` with a small high/low
  and icon per day, side by side.
- [ ] **E3. Midnight terminal.** At 00:00 a full-height perpendicular double
  bar or a 180° rounded terminal loop into the next day's track, with an
  inline label on the baseline: `TRANSFER · FRIDAY 11 SEP`.
- [ ] **E4. Night express compression.** Active hours take ~85% of the axis,
  night is squashed into the rest, entered and left through tunnel portals,
  the compressed segment filled with a cross-hatch or chevrons. An event
  that spans the night runs through it as one continuous stroke with a
  station at each end.
- [ ] **E5. Preset library in the editor.** A one-click dropdown in Start:
  Family of 4, Work vs Personal, Solo Freelancer, so someone can see a board
  before they have any URLs.
- [x] **E6. Localized weather alert banner.** A settings group (`enabled`,
  `rain_threshold`, `snow_alert`, `temp_extremes`) using the account
  location and locale. When a threshold is breached, a full-width
  high-contrast banner along the bottom edge:
  `SERVICE ALERT · Heavy Rain Expected at 17:00 (80%)`, translated per
  locale. It collapses completely when nothing is breached, and the canvas
  reclaims the space.

---

## Notes

- **"Station" is now one thing.** The word had two meanings: the transit
  grammar sense (a point on a line: tick, ring, diamond, hub) and the
  config's `station: true` sense (a SPAN the line leaves the running line
  for). The second is called a **siding** everywhere now, which is what it
  draws. The config key is `siding: true`, the payload is `metro.sidings`,
  the constants are `SIDING_*`, and the fixtures are `siding-day` and
  `shared-siding`. `station` is still read by `parseConfig` and by the
  editor's importer, undocumented, so a config written before the rename
  still works; `data-metro-role="station-ring"` keeps its name because a
  hub ring really is the point sense.

- **The layout suite can render the Liquid side now.** The banner is drawn
  by Liquid from the build's own `metro:`, so no fixture could ever reach
  it: `layout(fixture, view, { service_alert: ... })` patches those keys
  into `.trmnlp.yml`, builds, and puts the file back, and a viewport may
  name a `page` (`quadrant`, `half_vertical`, ...) to render that view's own
  build rather than the full one scaled into a slot. The framework's type is
  not the same size in the two, which is why the German snow alert wraps in
  one and not the other. Anything else Liquid draws (the header) is now
  testable the same way.
- The layout suite's small views became real this session. `A7` (the mangled
  backwards branch on a quadrant) should be cheaper to chase now than it
  looked when it was written down.

- The header carries the feed-down and stale-forecast lines, so they are not
  shown on the views that have no header (quadrant, half-horizontal on an OG
  panel). Those are exactly the views where a missing line is hardest to
  explain, so this wants revisiting.

## Done

- [x] A configuration pasted from a chat window (markdown-escaped, fenced,
  smart quotes) is read rather than mistaken for a list of URLs, at both the
  plugin and the editor. The AI prompt now pins the reply format and forces
  the calendars to actually be fetched.
