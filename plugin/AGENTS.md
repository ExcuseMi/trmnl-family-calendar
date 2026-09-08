# AGENTS.md — Metro Calendar plugin guidelines

## Core Design Philosophy & Constraints

* **Platform:** Non-touch 1-bit / high-contrast e-Paper display (TRMNL).
* **Aesthetic:** Authentic London Underground / NYC Subway transit diagram geometry.
* **Strictly Prohibited:** HTML/CSS card containers, pill buttons, polygon boxes, diagonal background hatching, gray fill blocks, and box-border frames around event text.
* **Core Rule:** Render events as **pure typographic signage** anchored by continuous, single-stroke SVG track paths.

## Data Sources

* `transform.js` is a real **TRMNL Serverless** entry point — exported function must be named `run(input)`, not `transform` (renaming it breaks the live plugin even though local `trmnlp serve`/`build` doesn't care, since `transform_runtime: disabled` bypasses it entirely).
* Two sources, chosen by the **Use Demo Data** boolean setting: the hardcoded demo events (default, no network), or a pasted **Calendar Config (JSON)** — same shape as this repo's `calendar-config.json`/`demo-config.json` — fetched as real ICS and parsed with a hand-rolled parser (no ICS library available in Serverless).
* RRULE support is a **bounded subset**: only `FREQ=WEEKLY` (+ optional BYDAY/UNTIL) is evaluated against today. Other patterns (DAILY/MONTHLY/YEARLY, COUNT) and all-day events are not shown. A `RECURRENCE-ID` override IS honored: it suppresses the master's occurrence on that date, otherwise an edited/moved single instance of a standing meeting renders twice ("standup twice").
* The **rule engine** (is covered by `test/transform/` (`npm test` there, no Docker): match types `any`/`all`, `exact`, `word`, `contains`, `regex`, `status`, `weekday`, `and`/`or`; actions `person` (string or list), `rename` (defaults true, but false on an any/all match), `rewrite`/`rewriteFull`, `hide`, `allDay`; top-level `rules` run before each calendar's own (calendar wins ties); the first `people[]` entry is the `everyonePerson` fallback; calendars may be bare URL strings; non-JSON config text is a newline-separated URL list; per-calendar `headers` go on the fetch. A `person` list becomes an interchange (`owner` + `co_owners`). Per-calendar `includeDescription: true` is the only thing that makes DESCRIPTION get parsed and matched — off by default.
* People/tracks are **dynamic** in config mode, not the fixed 3 from demo data — discovered from `config.people` (a `color` there overrides the auto hue cycle) plus any calendar whose events resolve to no rule-assigned person (that calendar's own name becomes a fallback track, so nothing silently vanishes). A calendar literally named `"Work"` decides who renders left; everyone else renders right.

---

## Layout (see ../DESIGN.md for the full algorithm)

* **All geometry is client-side** in `shared.liquid`'s `<script>`: `transform.js` returns raw facts only (events with `start_min`/`end_min`, `owner`/`co_owners`, `side`, `hue`, `track_offset`, `line_width`, `line_style`; weather milestones with `at_min`; `now_min`, `date_label`, `orientation`). No pixel or percentage positions come from the backend — it can't know the canvas size, the zoom factor, or how wide a title renders.
* **Orientation:** the `orientation` setting (`auto`/`horizontal`/`vertical`); auto = horizontal on a landscape canvas. One algorithm in axis coordinates serves both.
* **Spine:** every person's line runs full-bleed along the axis in one bundle; the hour labels live in a gutter in the middle of the bundle (work lines one side, family the other) so branches never cross them. Work is black and 4px; everyone else cycles `hue-40` tokens (resolved via `TRMNLPaint.stroke`) and dash patterns solid/dashed/dotted/dash-dot per side. On 1-bit screens every line is black — patterns identify them.
* **Stations:** a ring at the true start time, never moved. Interchanges are capsules spanning the involved lines.
* **Branches:** 45° diagonal to a lane, a run along the lane carrying the label, and — for events long enough — a 45° return that rejoins the line at the end time; otherwise a terminus bar. Rounded bends.
* **Lanes:** labels are measured as real DOM boxes, then placed chronologically, innermost lane first. Same-owner branches that overlap in a lane share one spur (the label slides along it; the ring feeds into it). Another owner's line or text blocks the lane. Overrunning the axis end drops the time tag, then ellipsises the title, and only then allows a backward branch. Unplaceable events are counted in "+N more".
* **Small screens:** text tier ladder (drop location → smaller title → drop time) retried until the fewest events are lost; the visible window narrows around now when hours get too dense; hour labels thin out; header compacts by canvas size, not view name.
* **TRMNL X zoom:** the framework zooms high-density screens ~2×. Work in layout px (`offsetWidth`) and divide `getBoundingClientRect()` measurements by the zoom factor; scale constants with `TRMNLPaint.px(1, {kind:'ui'})`.
* **Line names:** in horizontal mode each line starts at its own named terminus and fans into the bundle at 45° (at the start of the axis, or the end if the morning is busy); otherwise lettered bullets mark the lines. The legend stays in the header.
* **Sky band:** sunrise/sunset and rain start/stop markers (icon + text) sit in a band along the top edge in horizontal mode, beside the bundle in vertical mode, each with a guide line across the map.
* **Text size:** the tier ladder starts as big as the canvas allows (`title--xlarge` on TRMNL X) and steps down only while that improves layout quality (drops, crossings, slid elbows, backward branches).
* **i18n:** strings live in `I18N` in `transform.js` (en/fr/es/de/nl) and reach the template as `metro.i18n`; dates use Intl with the account locale; `time_format` auto = 12h only for US-style locales.
* **Prohibited:** cards, pills, boxes or borders around text; hardcoded hex colours (use `TRMNLPaint`, black for 1-bit); moving per-pixel layout back into `transform.js`.
* **Debug:** the canvas's `data-metro-debug` attribute lists the chosen orientation, window, spine position, lane counts, resolved colours and every event's placement. Read it with headless Chrome `--dump-dom` on a `trmnlp build` with the device's `screen--*` classes injected.
* **Local preview:** `.trmnlp.yml` mirrors the demo data (transform runtime disabled) — regenerate it after changing `DEMO_EVENTS` (command in the file's header). `trmnlp lint` reports `lat_lon` as an unknown field type; that is the local linter lagging behind the server.
