# Status

Last updated: 2026-09-08, commit `efe0ee0`. Everything below is committed, pushed to
`origin/main`, and deployed to the live TRMNL plugin (`trmnlp push -f` already run).

## What's working

- Terminology: config schema is `tracks`/`track` now (was `people`/`person`). Legacy
  `people`/`person` configs still parse and resolve identically — don't need to touch
  the user's live device config for this alone.
- Empty tracks (a configured person with nothing scheduled that day) get no line/legend
  entry — no wasted spine width, no gaps.
- `everyoneTrack` fallback fixed: an unruled calendar falls back to its own name before
  the first `tracks[]` entry, not instead of it.
- `not` matcher (`{"type":"not","matcher":{...}}`) for "one of these, except that one"
  with zero backslash-escaping.
- **Stations** (new): a rule action `"station": true` — a timed event's own track kinks
  out to a raised level for its span instead of branching into a lane, for a
  status/location block (e.g. "Desk booking") that shouldn't compete with real meetings
  for lane space. All-day events now render this way too (station only, no more header
  strip — `metro.all_day` is always `[]`, kept for shape compatibility).
- Station captions match real event-label styling (bold title + gray location, opaque
  white background so a crossing line doesn't run through readable text), pinned to the
  smallest text tier so they can't grow big enough to clip their own track's ramp.
- An all-day station's width shrinks to stay clear of that track's own next real
  event/station instead of a fixed width that can collide.
- Diagonal branches now also avoid/penalize crossing straight through another line's
  flat run in an inner lane (previously only checked for crossing through text).

## Known limitation — not fixed, understood

**A crossing that's only avoidable by swapping which event gets the inner vs. outer
lane** (seen with "Feedback for LSTM..." vs "standup 26-19" on Ward's real config) is
still there. Root cause: lanes are assigned strictly in chronological order
(`DESIGN.md`'s "earlier event keeps the inner lane"), so a later event forced outer by
an earlier event's long flat line will structurally cross it regardless of which outer
lane it tries — going further out doesn't help, since `diagonalCrosses` checks all inner
lanes below the candidate.

Real fix needs a genuine **lane-swap pass**: after normal chronological placement,
detect a flagged crossing, find the specific inner-lane event actually causing it, and
try re-`settle()`-ing both events at each other's lane index, committing the swap only
if both come out clean. Not attempted yet — this file's own layout code
(`plugin/src/shared.liquid`) has no unit tests, only screenshot-based verification, so
this needs care rather than a rushed pass. Ask before starting if picking this back up.

## Config editor

`tools/config-editor.html` has a "station" checkbox on every rule (exports/imports
`station: true`), alongside the existing not/comma-value UI. Config editor tests:
`test/config-editor/` (jsdom-based), 18/18 passing.

## Testing

- `cd test/transform && node run.js` — 54/54 passing. No Docker; a plain
  `vm.runInContext` sandbox (see `test/transform/run.js`).
- `cd test/config-editor && node run.js` — 18/18 passing. jsdom-based.
- Visual verification: no unit tests for `shared.liquid`'s SVG/layout geometry — always
  render and screenshot before claiming a layout fix is done (see the now-updated
  `~/.claude/skills/claude-skill-trmnl/topics/testing.md` for the exact pipeline: cached
  Chromium binary, cached framework CSS/JS, injected `screen--*` classes, the
  `data-metro-debug` attribute for introspecting layout decisions).

## Deploy

- `git push` and `trmnlp push -f` (from `plugin/`) are independent — always do both when
  shipping. `trmnlp push -f` still prompts interactively despite `-f`; pipe
  `echo "y" | trmnlp push -f`. This is a live/production action — confirm with the user
  first.
- The user's real `calendar-config.json` (repo root, gitignored — never committed) is a
  per-device custom field value on the TRMNL dashboard, not something `trmnlp push` can
  set. After any change to it, send the user the updated JSON to paste in themselves.

## Where things stand with the user

The user has been iterating rapidly and testing on their real device between each fix.
The last few rounds were: rename to tracks → stations feature → all-day-as-station →
caption covered/too-big/header-duplicated → all now fixed and deployed. No open user
request as of this checkpoint besides the lane-swap crossing fix mentioned above, which
was offered but not yet confirmed.
