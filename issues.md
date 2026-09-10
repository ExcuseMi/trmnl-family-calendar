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
- [ ] **A3. Station captions collide.** "Lab Rotation" wraps to two lines
  and lands on "Delivery Run" and on two rails.
- [ ] **A4. Simultaneous branches on different lines overlap.** "Coffee
  (100 cups)" (Fry, 07:30) and "Bend Some Girders" (Bender, 07:30) drop
  their stubs at the same axis position, a few px apart.
- [ ] **A5. A station shared by five lines draws five separate pills.**
  "Delivery Run" and "Ship Inspection" are `station: true` across the whole
  crew and come out as a stack of unrelated blobs. A shared station is one
  corridor, the way a shared event is one interchange.
- [x] **A6. Terminator tick misplaced on a backwards branch.** "Walk
  Nibbler" (17:30 to 18:15) puts its end tick in the wrong place.
- [ ] **A7. Quadrant on TRMNL X: a backwards branch is mangled.** "Family
  Dinner" on the Simpsons board. Its stub runs the wrong way and detaches.
- [ ] **A8. A long wrapped track name overlaps the first event label.**
  Known, carried over: "Demo - Planet / Express Crew" touches "07:30 - 08:15
  Bender: Bend Some Girders". The name is not an obstacle to label placement.

- [x] **A9. The trunk was interrupted where a siding began.** The kink's
  corners are rounded, so the trunk leaves its baseline a corner radius
  before the station's own start; the siding began at the bare vertex, and
  the two did not meet.
- [ ] **A10. A branch and a station ramp meeting at the same minute graze
  each other.** With the car no longer a solid block the junction reads, but
  the branch still leaves tangent to the corner rather than out of it, and a
  spike of the flat rail pokes out from under the kink.
- [ ] **A11. Every "small view" in the layout suite was rendering full
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

- [x] **E1. The metro car should read as a train.** Outline it, hollow it
  out, or set the track's initial inside it.
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
- [ ] **E6. Localized weather alert banner.** A settings group (`enabled`,
  `rain_threshold`, `snow_alert`, `temp_extremes`) using the account
  location and locale. When a threshold is breached, a full-width
  high-contrast banner along the bottom edge:
  `SERVICE ALERT · Heavy Rain Expected at 17:00 (80%)`, translated per
  locale. It collapses completely when nothing is breached, and the canvas
  reclaims the space.

---

## Notes

- The header carries the feed-down and stale-forecast lines, so they are not
  shown on the views that have no header (quadrant, half-horizontal on an OG
  panel). Those are exactly the views where a missing line is hardest to
  explain, so this wants revisiting.

## Done

- [x] A configuration pasted from a chat window (markdown-escaped, fenced,
  smart quotes) is read rather than mistaken for a list of URLs, at both the
  plugin and the editor. The AI prompt now pins the reply format and forces
  the calendars to actually be fetched.
