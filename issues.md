# Open work

Everything outstanding, highest priority first. Tick a box only when the fix
is on `main` **and** on the device, with a test or a screenshot behind it.

Order of attack: **P** first, then the board being wrong in front of the user
(A), the configuration that produced it (B), settings and robustness (C, D),
and new features (E). Nothing in E starts while anything in A is open.

Anything finished is one line under **Done** at the foot of the file. The
reasoning behind a finished item does not live here: it is in the comment
beside the code that does it, in `rules.md`, or in the commit that shipped
it, which is where somebody changing that code will be standing.

---

## P. Next

---

## A. The board is wrong right now

- [ ] **A4. Two lines turn on one column where a corridor ends on the
  minute the next one begins.** Three boards, and the suite has carried it
  as known since it learned to measure runs: `crew-day` (amy and fry at
  x=462 and 463), `five-lines` (bar and lis, 1px), `regroups` (mar and hom,
  4px). Two rails on one column read as one line with a gap in it.

  The original report named two branch stubs at 07:30 on `crew-day`. Those
  are both marks on their own trunks now and the stubs are gone; the defect
  is the same shape one level down, and this is what it actually is.

  NOT a missing stagger. Every convergence hands its members a staggered
  exit and entry (`lead`/`trail`/`rank` on the hold, a corner and a bit
  apart) and it works everywhere there is a gap to spend it in. Where Good
  News Everyone ends at 09:00 and the Delivery Run starts at 09:00 there is
  no gap at all, and two things follow. `routeRaiseAt` never asks for the
  transition -- it returns the first hold's level up to its end and the
  second hold's from its start, so the span between them, staggered or not,
  is not drawn. And the span itself came back with a NEGATIVE run, because
  `from` was staggered past `to`; that one is fixed, since `corridorBlocks`
  reads it.

  Both ways of finding the stagger some axis were tried and measured:

  - Let the turn finish INSIDE the hold it arrives at (`routeRaiseAt`
    honouring a span that overruns). The line is then mid-move at the
    event's own `_nodeA`, which is where `recomputeLineDists` measures the
    branch origin, so every distance the band solver is given is wrong: the
    board collapsed into a third of the canvas at the largest text.
  - Take it from the hold before instead, leaving a corner early. Rule 24
    forbids it in words -- a branch does not leave before the shared event
    is over -- and it is the lie 29b names.

  So the axis has to come from somewhere else, or the two corridors have to
  be reconciled into one move. rules.md carries the same gap under rule 13
  ("13 between two abutting holds"), which is this entry seen from the
  rules' side; whatever fixes one closes the other.

- [ ] **A10. A branch and a station ramp meeting at the same minute graze
  each other.** With the car no longer a solid block the junction reads, but
  the branch still leaves tangent to the corner rather than out of it, and a
  spike of the flat rail pokes out from under the kink.
  A12 has been done since this was written and it is the same elbow from the
  other side: the lead-in is now the fillet and nothing more, and the
  departure's halo no longer lies on the line it is leaving. Look again
  before building anything -- on `moment-day`, the only board in the suite
  with a 45 degree departure, what is left is a small nick of paper just
  past the divergence.

- [ ] **A15. A track should carry events on BOTH sides of its line.**
  Every lane a track owns sits OUTWARD of it, so a line at the edge of the
  bundle has all of its labels on one side and the gap between it and its
  neighbour goes unused.

  The sharpest case, carried over from the old tracker: a spur on a
  converged shared station sits in the corridor between the two lines. Bart's
  "Field Trip" branch lands in the space School Day opens between him and
  Lisa. That is not a stray -- for the INNER member of a shared station the
  outward side IS the corridor -- and branching it the other way needs
  exactly the both-sides support this entry asks for. The outer line is
  capped so it never crosses into the inner line's band, which is as far as
  it goes without that change. On the everyday board, Work has six events stacked
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
  **Measured, 2026-09-10.** Seven of the layout suite's failures are one
  caption sliding most of its own width off its elbow ("1:1 with Priya" is
  86px from its branch, and the label is 88px wide). They are not a
  placement bug and three separate attempts to treat them as one all
  failed, which is what says this is the fix:
  1. The axis is not the problem. `contentPad` hands 150 minutes of
     full-rate axis to nothing, and taking it back gives the busy stretch
     12% more width; that cleared exactly one of the seven and broke three
     other cases, one of them a correctness test.
  2. The interchange dodge is not the problem either, though it has its own
     flaw: it accepts a move measured from where the caption has already
     been slid to rather than from its branch. Fixing that changed nothing.
  3. The placer is not choosing badly. `settle` caps the slide with
     `MAX_SHIFT`, a fraction of the whole axis, so a short caption may ride
     250px and still be placeable. Making the cap scale with the label
     (`textLen * 0.55`, the reach the rest of the layout already agrees on)
     took the seven to one, and cost two "line through a text label"
     failures instead, because for these seven EVERY attached placement
     crosses something. By this file's own ranking, a pierced word costs
     the reader more than a loose caption, so that is a worse board with a
     better scoreboard, and it was reverted.
  What is left is that these boards have nowhere to put the label: the
  lanes on one side are full, so the caption either slides or the branch
  dives past somebody's words. Both A15 and A17 are about the same missing
  room, which is why the seven belong to them and not to a placement fix.
  **DONE, with one gate left.** A track carries events on both sides of
  its line: `settle` reads a signed reach, `_labelSign` puts the words on
  the far side of the rung from the line, and every lane item carries the
  side its text runs to. What is still gated off is a track that is in a
  CORRIDOR: a bundle is planned after the lanes are handed out and its
  caption is placed outside the lane grid, so it is the one thing a lane
  cannot be checked against, and it sits in exactly the gap an inward rung
  wants. Lift that gate by making a bundle's caption an obstacle the grid
  can see, at which point every line on the board can use both sides.
  Worth knowing for whoever picks this up: it takes TWO busy lines on one
  side before any of it is reachable. A track only wants a second lane when
  two of its own events run at once, the sides are balanced busiest-first
  so the busiest line is always innermost, and the innermost line's inward
  neighbour is the spine rather than a line. `overlapping-day` is the
  fixture for it.
  **The first attempt, for the record.** `CrossSolver` splits a
  track's rungs across both sides of its line and `test/cross` covers it;
  `bothSides` is off at the call site because turning it on makes the board
  worse. What a rung on the inward side needs, beyond the sign work already
  written and reverted (a signed `dy` and `rowDist` in `settle`, a `side` on
  every lane item so `diagonalCrosses` reads the text band on the right
  side of the rung, and `_labelSign` for `band()` and the box placement):
  1. The caption passes still assume a label hangs away from the spine.
     `capClamp`, the interchange dodge and the bundle-caption slide all
     compute `want` from the elbow with the event's own `_sign`, so an
     inward label is measured against a position on the other side of its
     own rail.
  2. Two tracks' labels now share one gap from opposite directions. The
     solver reserves the room, but the collision grid keys obstacles by
     LANE INDEX, and an inward rung of the outer track and an outward rung
     of the inner one are different indices in the same physical band.
  3. The reach that keeps a caption "beside its own branch" is measured
     along the axis and is side-agnostic, but a label that flipped sides
     also flipped which neighbours it can collide with, and nothing
     re-checks that.
  Evidence, on the demo board with it switched on: "School Run" written
  through "Assembly", "Skate Park" into "Family Dinner", "Saxophone Lesson"
  into "Mensa Meeting", and the layout suite 13 to 14. Fix those three
  before turning it back on, and check the picture before the count: the
  suite moved by one and the board fell apart.

- [ ] **A16. Two commitments back to back should not send the line home in
  between, and the orchestrator should order the tracks so they don't have
  far to go.** Reported off a zoomed morning: Bart and Lisa ride the School
  Run bundle at 08:00, drop all the way back to their own rails, and
  immediately dive out again for the School Day siding at 08:30. The return
  is drawn, costs two ramps and a crossing, and says nothing: nobody went
  home for those thirty minutes.
  Two halves, and they want doing in this order.
  **Ordering.** The machinery is already there and is simply not being told
  about time. `registry.link(names, weight)` takes a weight and
  `affinityChain` lays the tracks out as one chain, strongest link first,
  so the board order genuinely optimises for who belongs beside whom. But
  `linkMerged` adds a flat 1 per shared event, so two people sharing the
  school run at 08:00 and the school day at 08:30 count exactly as much as
  two people sharing one thing at opposite ends of the day. Weight a link
  by how close in time the shared things are, so consecutive ones pull
  harder. One function, and it is declared as affinity rather than baked
  into the drawing.
  **Connecting through.** When the gap between two of a track's own
  commitments is too small to return into, run the rail straight from one
  to the next instead of rejoining the trunk and leaving again.
  The threshold is a DRAWN DISTANCE, not a clock reading. "Less than an
  hour" was the first instinct and it is the one thing to get right here:
  since compression landed an hour is not a width. An hour of the small
  hours is a handful of pixels and an hour of a busy morning is wide, so a
  fixed hour would connect through a gap that is plainly visible on an
  expanded stretch and refuse to connect two things three minutes apart
  inside a compressed one, which is backwards. Ask instead whether there is
  room to come back: if the gap is narrower than the two ramps a return and
  a fresh departure would take, run through. That scales itself, needs no
  constant to tune per board, and is the same reasoning `sidingGeom`
  already uses when it caps a ramp at `span / 3`. It also keeps the rule
  honest, because the only gaps it hides are ones too small to have drawn.
  Two things it runs into. A connection between a bundle above the trunk
  and a siding below it crosses the track's own line, so it buys a tunnel
  by the crossing rule in `plugin/AGENTS.md` (a rail crossing a line it does
  not belong to is broken for it): prefer a connection that stays on one
  side and take the tunnel only when there isn't one. And it wants A15
  first, because a track that can carry events on both sides lets the
  orchestrator put the school run on the same side as the school day,
  where the connection is short and crosses nothing. Landing this first
  means it spends its time fighting the side assignment.

- [ ] **A17. A shared bundle asks the board for nothing, so a squeezed
  board draws it on top of the lines.** Reported off a five-line board with
  the alert banner up: the bundle rails and their captions sit across
  Marge, Bart and Lisa, and the line names are down on their own rails.
  The bundle already knows exactly what it needs. `drawSharedBundle`
  computes `need = block + 2 * LINE_GAP`, where the block is the rails plus
  the caption that hangs off them, then hunts for the widest gap between
  two participating lines, sampled across the whole run so a line that
  kinks out mid-caption cannot close it, and avoiding the stretches another
  caption already owns. All of that happens AFTER the cross solver has
  handed out positions, so it can only ever pick the least bad gap. When
  every gap is narrower than `need` it takes the widest one anyway and
  overflows, which is the picture.
  Nothing upstream reserves that room, and deliberately so: folding shared
  events into `_sidings` inflated every band by a kink the line never
  makes, so `ownSidings(p)` counts only the track's own sidings now. That
  was the right fix for the wrong charge, but it left the corridor charging
  nothing at all.
  The missing idea is a demand the solver cannot currently express. Lanes
  and sidings grow ONE track's band outward; a bundle needs a MINIMUM GAP
  BETWEEN TWO ADJACENT TRACKS, which no `demand[key]` can say. So
  `CrossSolver` wants a second input beside the per-track demand: a list of
  `{a, b, px}` between adjacent tracks on the same side, met before the
  spare depth is spent on anything else. Do it against `test/cross`, where
  it is arithmetic and answers in milliseconds.
  And a board can be too small to afford it however the depth is spent, so
  there has to be a fallback shape rather than an overflow: below the width
  a bundle needs, the event drops back to the tie, which is the shape short
  shared events already keep. One event drawn as a tie on a crowded board
  is still a board; a bundle written across three lines is not.
  It wants doing WITH A15, not after it. A15 puts a track's inward rungs in
  the gap between it and its neighbour, which is the same space this needs,
  so the two are competing for one piece of board and only the solver can
  referee. Landing them apart means the second one re-opens the first.

- [ ] **A18. A line's cross position is decided once for the whole day, so
  the order that suits the morning has to do for the evening too.** The
  orchestrator should be able to MOVE a track between events when that
  buys fewer crossings than leaving it where it is.
  Where it stands: `affinityChain` picks one order for the board, from
  affinities summed over the whole day, and the cross solver gives each
  track a single `_dist`. Two people who share the school run at 08:00 and
  nothing else are adjacent at 18:00 as well, and everybody who meets
  anybody later reaches them by crossing whoever sits in between.
  The drawing is ALREADY capable of this and nothing else is. `lineCAt(p,
  a)` is a function of the axis position, not a constant, and is documented
  as the single source of truth for where a line is: sidings move a line to
  a different cross position for a span and back, and every ring, tick and
  caption follows because they all ask it. A permanent change of level is
  the same move without the return. What does not exist is a solver that
  CHOOSES to make one.
  The shape of the answer is a known one. Take each event time as a layer,
  order the lines within each layer, and minimise the crossings between
  consecutive layers: the median/barycentre sweep of layered graph drawing,
  refined by adjacent swaps. It is arithmetic, so it belongs in a pure
  model beside `CrossSolver` with `test/cross` counting crossings on the
  demo boards before any of it is drawn. Measure first: if the count does
  not fall on real boards, the idea is wrong and costs nothing.
  Three constraints, or it makes the map worse than it is:
  1. **Moving is itself a crossing.** A line cannot pass another without
     crossing it, so the objective is not zero crossings but the fewest
     weighted ones: one now to avoid three later is a win, one now to avoid
     one later is churn.
  2. **A line has to stay followable.** What a transit map is FOR is
     tracing one line with a finger. Allow a change only where the line is
     already leaving its baseline for an event, never mid-run, and cap the
     changes per line per day at one or two. A line that wanders is worse
     than a crossing.
  3. **The name is at the terminus.** A line that ends the day at a
     different level is named at a level it is no longer on, so this needs
     the name at both ends, or a bullet where it settles.
  **The board that makes the case, measured.** `regroups` in the layout
  fixtures: two parents and two children who regroup after school. Alex
  takes Ben and Sam takes Ivy in the morning; in the evening Alex has Ivy
  at football and homework while Sam has Ben at swimming and a bedtime
  story. Every one of those is a shared event and every one wants its two
  lines adjacent, and they cannot all have it: the four pairings form a
  CYCLE (Alex-Ben, Ben-Sam, Sam-Ivy, Ivy-Alex), and a cycle cannot be laid
  along a line without breaking one of its links.
  So the morning is clean and every evening event reaches past the parent
  it is not with. `cases/crossings.js` counts it off the drawn board and
  asserts the number: FOUR, all of them after teatime, plus two pierced
  labels that come with them (marked known in geometry.js). One swap at
  teatime pays ONE instead: the morning wants Alex-Ben and Sam-Ivy
  adjacent, the evening wants Alex-Ivy and Sam-Ben, and those two orders
  differ by exchanging one adjacent pair.
  That is the whole argument in one board. When a line can change level,
  this test should read one crossing instead of four and the two known
  markers should come off, and the suite will say so.
  After A15 and A17: those two decide how the cross-axis budget is spent,
  and this changes what "adjacent" means over the day, so doing it first
  means solving the same argument twice. It also subsumes the ordering half
  of A16, which weights the one-shot chain by how close in time a shared
  event is; that is this problem with a single layer.

- [ ] **A19. The orchestrator should SCORE boards, not just produce one.**
  The frame the four above are all inside. Asked for: fewest crossings,
  efficient use of the depth without cramping, every label legible and
  everything visible, and the orchestrator working out which arrangement
  breaks the fewest of those.
  What there is now is a pipeline of greedy passes: sides balanced by event
  count, order from `affinityChain`, three passes of the cross solver,
  lanes, labels, and the bundles drawn last out of whatever is left. Each
  pass commits and the ones after it live with the result. A17 (a bundle
  that cannot ask for room) and A18 (an order fixed for the whole day) are
  both that same shape of bug, and each is being written as its own patch
  because there is nothing that can say "this board is better than that
  one".
  **Build the score first, on its own.** It is the cheap half and it is
  useful immediately: `test/layout/run.js` already extracts labels, paths,
  rects and a debug dump of the bands out of a rendered board, so a scorer
  consumes a report that exists rather than a new measurement path. With
  it, every argument in this file stops being two screenshots and a
  judgement and becomes a number on the demo boards across every view.
  Do NOT start with the search.
  **Feasibility is not a penalty term.** "Every label legible, everything
  visible" has to be a test a board passes or fails, because as a weighted
  cost the optimiser will happily buy fewer crossings with a hidden label,
  which is the one trade nobody wants. Boards too small to satisfy it fall
  back to the degradation ladder in D5 (drop the location, then the times,
  before bending any geometry): that ladder is the ordered list of what may
  be surrendered, each rung costing more than the last, and it is only
  consulted once feasibility has actually failed.
  **Cramping is a two-sided term.** "Efficient" cannot mean minimising the
  depth used, or the best board is the tightest one, which is the picture in
  A17. Score each GAP against what that gap has to hold (A17's `need` is
  exactly this number for a corridor), require every gap to reach it, and
  then reward spreading the surplus rather than banking it.
  **Stability belongs in the score.** A board that rearranges itself every
  morning is worse to live with than one that is slightly worse every day,
  because the household learns where its own line is. Yesterday's order can
  be carried in `trmnl_state`, which already persists across renders, and
  differing from it should cost something.
  **Calibrate the weights, do not invent them.** Pick them so the scorer
  agrees with boards already judged by eye: the cramped five-line board in
  A17 has to come out worse than the same day drawn roomy. A weight nobody
  can defend is a number that will be tuned forever.
  **One measurement at two fidelities, and the fast one has to be checked
  against the slow one.** The two paragraphs above do not fit together as
  first written: a score read off a RENDERED board cannot be what a search
  evaluates, because every candidate would then cost a render. So there are
  two, and the relationship between them is the whole design.
  The RENDERED score is the truth, read off the report the layout harness
  already produces. The MODEL score is an estimate computed from the
  solver's own numbers with no DOM at all: crossings counted from the
  order, gaps against what each has to hold, label demand against the room
  its band was given. The search only ever evaluates the model score.
  A model score that disagrees with the rendered one is not an
  approximation, it is a thing you optimise a board into being worse
  against. So the two get compared, on every demo board and every view, and
  they have to agree on the RANKING: if the model prefers board A to board
  B, so must the render. That comparison is the same discipline the cross
  solver is already held to, where the extracted pure model has to match
  what is drawn.
  **And the rendered score costs nothing extra, because the suite already
  renders all of it.** `node run.js` walks every board and every view
  already; the score comes out of the same pass as a by-product, printed as
  a table beside the pass/fail. There is no second harness to build and no
  second minute to wait.
  **The search budget is the DEVICE's, not the suite's.** The board is laid
  out client side, once, inside the panel's own render. That is what makes
  the arithmetic requirement non-negotiable: it would still hold if the
  test suite were instant. The pure models are the right size for it
  (`test/cross` runs 400 seeded cases in one), so the search evaluates
  candidate side splits, orders and allocations there and the panel draws
  exactly one board: the winner.

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

## B. The configuration that produced it

## C. Settings

## D. Robustness

- [ ] **D5. Small screens: collapse secondary metadata before geometry.**
  On a board like OG half-vertical with 6+ short events on one track, drop
  location text, then start/end times, rather than bending the baseline.

## E. New features

- [ ] **E25. A rolling board draws tomorrow's appointments but not tomorrow's
  all-day states, and not its holiday.** So a board that reaches into Boxing
  Day shows the day's meetings and does not say it is Boxing Day, and a line
  whose owner is on leave tomorrow is drawn as if they were not.

  `allDayEvents` and `holidays` are filtered to day 0, which was right while
  the board drew exactly one day and the reader could pick which. Nothing
  picks a day now: a rolling board is today PLUS tomorrow, and the second day
  arrives with its timed events, its own forecast and its own date badge but
  none of its states.

  Found by removing the Show setting: two cases in `cases/holidays.js` proved
  tomorrow's holiday and tomorrow's leave DID reach a board when that board
  was set to tomorrow, and there is no longer any way to ask. They are gone
  and this is what they were holding.

  The fix is not just widening the filter. The day badge draws
  `METRO.holidays[0]` against the run's first day, so a holiday belonging to
  the borrowed day needs to travel with a day index and be drawn on that day's
  own badge -- which is the shape rules 59 to 64 already describe, applied to
  a day the board reached rather than the day it opened on.

- [ ] **E24. On a crowded line, every position for some name is a graze, a
  pierce or a gap, and the prices only decide which.** Six boards out of the
  layout suite's sixty-odd end this way, and they are pinned known against
  this entry.

  The caption assignment (E23) scores three faults against each other: a pair
  of names that TOUCH (0.3 of a name's area, plus the area they actually
  cover), a rail drawn THROUGH the words (0.4), and a name NOT DRAWN at all
  (0.35, and a line's head counts it as "+2"). All four orderings were
  measured on the whole suite:

  | shed | pierce | boards failing |
  |---|---|---|
  | 0.35 | 0.4 flat | **6** (kept) |
  | 0.35 | by length | 8 |
  | 0.35 | 0.5 + length | 10, and the sheds it bought put a "+2" at a line's head on that line's own rail |
  | 0.50 | 0.4 flat | 8, the sheds gone and the pierces up |

  Grading a pierce by how much of the name it crosses is the obvious idea and
  it measured worse twice, in both directions: by length alone a six-pixel
  graze came out cheaper than stepping out one rung; with a fixed part dear
  enough to fix that, the fixed part passed what not drawing the name costs.

  So this is not a tuning problem, and the remaining six are not going to be
  priced away. What would actually fix them is more ROOM -- which is E21, the
  eighty to a hundred and sixty pixels of depth the solver reserves and the
  drawing never uses. A caption pass with another corridor to put a name in
  does not have to choose between three bad answers.

- [ ] **E21. The solver reserves 80 to 160px more depth than the drawing
  uses, so every board thinks it is fuller than it is.**

  MEASURED AGAIN after the caption rework, and the shape is narrower than
  this entry first said. `data-metro-debug` now carries `why`: what each
  track's band is made of. On every board, every track EXCEPT the last one on
  its side asks for no rungs at all and costs eleven pixels; the last one
  carries the whole side's ladder, because `_laneOwner` is whichever track is
  outermost at that minute.

  | board | last track | band | of which |
  |---|---|---|---|
  | five-lines / X | lis | 346 -> 470 | 124 |
  | crew-day / X | bender | 242 -> 468 | 226 |
  | seven-lines / OG | amy | 217 -> 405 | 188 |

  That band is `start + (lanes - 1) * step + lineGap + maxLabelThick`: the
  outermost rung occupied, at the thickest label on the board. The ink stops
  about 99px short of it on average, so the outermost rung is reserved and not
  used. The fix wants a feedback pass -- draw, measure the rung actually
  reached, reserve to that, and keep the better board -- in the shape
  `attemptOnce` already uses for the terminal bars.

  THE BUDGET FOR THAT PASS IS NOT FREE, and the obvious place to take it from
  does not give it up. `attempt` draws every tier twice, once with the
  captions offered from each end of the day, purely to blunt the greedy pass
  that E23 replaced. Removing it looked safe and cost five boards, so it goes
  back: the order captions are OFFERED in is still the order the annealing
  starts from, and on a board where the search cannot reach a clean answer the
  starting point still decides which one it settles for.
 Measured on four
  fixtures at both landscape sizes, comparing `needB` (what the cross solver
  reserved below the spine) with how far the drawing actually reaches:

  | board | reserved | drawn | wasted |
  |---|---|---|---|
  | five-lines / OG | 249 | 169 | 80 |
  | seven-lines / OG | 367 | 208 | 159 |
  | busy-day / X | 571 | 466 | 105 |
  | long-event-day / X | 567 | 468 | 99 |

  `needOf` is `max(extent, extent + nameH/2) + edge`, and `extent` comes from
  `buildSide`: `start + (nLanes - 1) * step + lineGap + maxLabelThick`. It
  assumes every allocated lane is occupied at the thickest label the board
  carries. Most are not: an event drawn as a mark on its own line needs no
  rung at all, so the lanes are reserved and then not used.

  The empty strip at the bottom of the OG board is the visible half of this.
  The expensive half is invisible: `fits()` compares that inflated need
  against the room, so the board trims lanes it did not need to trim, packs
  when it did not need to pack, and the tier loop then scores a crowded board
  and steps the text down. The 800x480 demo board draws five lines in the top
  half, stacks its captions in three lanes underneath and leaves about 150px
  of canvas empty, while reporting itself packed.

  Worth suspecting behind: the small text on boards with obvious room (the
  tier loop sees a full board), some of E19's caption pressure (less room
  offered than exists), and the crowding that E20's captions are walking past
  each other to escape.

  TRIED: the re-solve, and it changes nothing. `laneCap`, the downward twin
  of `laneFloor`: draw once, count the lanes each line actually used, cap the
  demand at that and solve again, keeping the tighter board only if it scores
  better. Reserved-versus-drawn came out IDENTICAL on all eight boards, and
  it cost one new overlap on regroups/og-landscape. Reverted.

  RULED OUT: per-lane thickness. Every label on a board is the same
  thickness, because a label is one text row at whatever tier the attempt is
  drawing, so charging a lane for what it holds rather than for
  `maxLabelThick` reclaims nothing. Measured on ten boards: OG at
  `label--small` is 14px for every label, OG at `title--small` 30, X at
  `title--small` 34, X at `title--base` 40, and the largest saving available
  anywhere across all their lanes was 1px.

  WHERE IT ACTUALLY GOES: rungs booked by CONVERGENCES that are then drawn as
  corridors. Every solo event is a mark on its own line now, so a convergence
  is the only thing left that asks for a rung -- and a convergence is normally
  drawn as a corridor between the participants' own rails with its name above
  the pill, which uses no rung at all. On seven-lines/OG, bender's ladder is
  four rungs deep and reaches 348px from the spine; its three shared events
  hold lanes 0 and 2, and the drawing stops at 208.

  TRIED, and it is half a fix: skip shared events in the `used` count
  `placeSide` returns, so they book no rung. seven-lines/OG goes from three
  lines crammed into the top 60% at `label--small` to three lines spread over
  the whole panel two text tiers larger, with the times and the locations
  back. It costs 21 layout failures: six boards with overlapping labels, seven
  with a rail through a label. Reverted.

  The phantom rung was paying for something real. A corridor's name goes
  above the bundle, and nothing else books that paper -- the rung booked on
  one owner's outward ladder was standing in for it, in the wrong place and
  at the wrong size.

  BUILT, ON THE BRANCH `e21-corridor-room`, and not ready. The narrow rule:
  a bundle closing up frees the paper its top member vacates (half the
  group's span, less half the fan), and where that is more than the name
  needs, the rung is waste and is given back; where it is less, the paper had
  to come from the rung, so it keeps it. Plus a pass after `buildTrunks` that
  hands the booking back for a convergence that came out a BUNDLE rather than
  a corridor (two of the 54 these fixtures draw), and a gate that draws the
  board both ways at the winning tier and keeps the cleaner one.

  It works and it is a net loss: seven-lines/OG goes from three lines in the
  top 60% at the smallest text to three lines over the whole board with their
  times and locations back, and the suite goes from 4 failures to 9. The
  freed room is room the caption pass cannot yet use: what breaks is captions
  landing on each other and rails through names, on five boards, which is
  E19 and E20 exactly. That pass has to come first.

  Two findings from the attempt, both worth keeping:

  - Every solo event is a mark on its own line now, so CONVERGENCES ARE THE
    ONLY RUNG CUSTOMERS LEFT on these boards. The lane ladder is almost
    entirely theirs.
  - ATTEMPTS ARE NOT IDEMPOTENT. Each one feeds on the last one's routes and
    `capBlocks`, and `_noBooking` accumulates, so "draw it both ways and keep
    the better" is only trustworthy when the two drawings are adjacent.
    Deciding at the first tier and deciding at the winning tier gave
    different boards, and neither matched a straight re-run.

- [ ] **E18. TRMNL Companion: blocked upstream, one line of their Swift away.**
  Companion is an iOS app that reads the phone's own calendars through
  EventKit and POSTs them to a plugin, which would remove this plugin's
  worst friction at a stroke: finding five ICS links is what makes people
  give up, and ticking five calendars in an app is not.

  It cannot work today, because the merged feed does not say which calendar
  an event came from. The README calls the field `calendar_identifier` and
  the payload calls it `calname` -- the same name TRMNL's own convention
  uses for a calendar's NAME, and the same one `parseIcs` reads
  `X-WR-CALNAME` into here -- but the value is
  `event.calendarItemExternalIdentifier`, which is a per-EVENT iCalendar
  UID. Their own comment says so: it is there for deduplication.
  `event.calendar.title` is read only by the phone's own mapping UI and is
  never sent. A line on this map IS a calendar, so five people's calendars
  arrive as one undifferentiated list and every event lands on one line.
  Nothing on this side can work around its absence.

  Two more blockers behind that one. Companion's `getPluginSettings`
  defaults to the plugin id `"calendars"`, so a private or serverless plugin
  never appears in its mapping list (their issue #5 asks for this). And a
  plugin instance is ONE strategy: this one is `polling`, which Serverless
  requires, so a webhook means a second plugin, which cannot call this
  `run(input)` at all. The documented webhook cap is 2kb (5kb for TRMNL+)
  against a 37-day window of a household's events, which is off by an order
  of magnitude either way.

  Worth knowing for when it unblocks: the seam here is clean. Everything
  downstream of `applyCalendarRules` is source-agnostic, so the adapter is
  one function turning the pushed events into `parseIcs`'s own
  `{ timed, allDay, calName }` shape, grouped by source calendar. About 310
  lines of ICS parsing get bypassed out of 3219, and EventKit has already
  expanded recurrences, so the FREQ=WEEKLY-only limitation would go with it.
  `calendarDown`/`calendarNames` are keyed by feed URL and would need to
  become "no push since".

  What would change the answer: Companion sending `event.calendar.title` or
  `calendar.calendarIdentifier` per event. Ask TRMNL in the same breath
  whether a serverless `run(input)` can be fed a pushed payload at all, and
  whether the 2kb cap applies to the endpoint Companion posts to.

> **E2, E3 and E4 assume a multi-day board, and this plugin has never drawn
> one.** There is one day in the payload (`day_start_min` / `day_end_min`),
> the weather is fetched with `forecast_days: 1`, and the template has no
> notion of a second day at all. A date RANGE header, a midnight terminal
> and a sleeper event spanning the night are all views of a thing that does
> not exist yet, so the day model comes first and is the largest single
> piece of work on this list. E4's axis compression is the exception: the
> scale already compresses quiet hours (`aFor`, EXPRESS_RATE), so the night
> express is an extension of something real.

- [ ] **E1b. One car, not one per line.** Instead of a train on every line,
  a single high-contrast car marking the current time for the whole board:
  riding the hour strip, or sitting on the active time position, as the "you
  are here". Worth trying against what is there now (a car per line, each
  carrying its line's initial, which says where each person is rather than
  only what time it is) and keeping whichever reads better on a panel.

- [ ] **E2. Dynamic date range header.** Single day: `Today · Thu 10 Sep ·
  07:00 - 21:00`. Multi-day: `Thu 10 Sep - Fri 11 Sep` with a small high/low
  and icon per day, side by side.

- [ ] **E14b. Three boards now reuse a drop column at a morning convergence.**
  `five-lines` turns Bart and Lisa 1px apart leaving the school run;
  `crew-day` gives Amy and Fry the same column leaving the delivery; and
  `regroups` turns Marge and Homer 3px apart, which appeared when the header
  band came off and every line on the board moved. The first two are pinned
  known in `test/layout/cases/fan-out.js`; the third is the same defect on a
  board that had been missing it by a few pixels.

  Not the run home, which is fixed: these lines have most of the day still to
  come, so the hold they are leaving is not their last and the stagger that
  was extended to the last hold does not reach them. The stagger itself is
  applied (`prev.trail`, `routeSpan`), so the likely cause is that these two
  are not in one bundle at all -- two events at the same minute, each
  staggering its own members correctly and neither knowing about the other.

  If that is right the fix is a board-wide pass rather than a per-event one:
  collect every turn the board is about to draw and space them, instead of
  each convergence spacing only its own.

- [ ] **E13. Standing up, captions are never slid or laddered along the axis.**
  Found by `test/layout/cases/standing.js`, which is the first case file to
  check a portrait board at all: 17 of its 28 cases are marked known.

  Lying down, a caption's width runs along the time axis and its height
  across the board, so two events twenty minutes apart are naturally far
  apart and the solver's job is to stop their two-row boxes touching across
  the lines. Standing up that swaps: the width now comes out of the SAME
  axis the rails are spread along, and the height eats the time axis. A
  two-row caption is about 77px tall where twenty minutes is about 60px, so
  two events on one line twenty minutes apart overlap by construction.

  The machinery to fix it already exists and is simply not reached in this
  orientation: the caption pass slides a mark's name along its own line past
  its neighbours (see `markRoom`, which charges for one column per track on
  the understanding that the pass does exactly this), and the lane ladder
  gives a second column further out when sliding is not enough. Both are
  written against the flat case.

  What to touch: the slide search in `placeSide` and the lane assignment
  that feeds `_textStart`, so that "how far may this caption move" and "is
  there a rung further out" are asked in axis terms rather than in
  horizontal ones. `colW` is already correct -- it is sized so one column
  per rail plus one beyond each side fits the cross axis, clearance
  included.

  Known debt: none added. This is a description of what the board does now.

- [ ] **E11. Long events on the main track, and no more sidings.** A long
  block -- a school day, a shift, a delivery run -- is drawn as a siding:
  the line leaves its lane, runs a corridor for the length of the block and
  comes back. The rule that replaces it:

  - A long event is drawn ON the main track. The line does not move for it;
    the band and its end marks say where the person is and for how long.
  - An own event inside it branches off the main track as any own event
    does, and rejoins.
  - A shared event inside it needs the main track to move, so there the
    long event becomes the branch instead: the line leaves for the long
    event and the trunk is free to go and meet somebody.

  That removes sidings as a separate thing entirely. What goes with them:
  `SIDING_*`, `sidingGeom`, `sidingPath`, `sidingRaiseAt`, the `siding: true`
  holds in the route model, the siding markers and captions, and the
  `siding-day` / `shared-siding` fixtures and their cases. What has to be
  built: a band drawn along a trunk that may itself be moving, a caption
  that can sit beside it, and the test that says a long block moved the
  trunk only when a shared event asked it to.

  Note the ordering conflict with rule 24: a long event that becomes a
  branch because of a shared event inside it must still not leave before
  that shared event is over, which means the branch is the SECOND half of
  the block, not the whole of it.

- [ ] **E10. Events on a diagonal run.** An event can only be drawn one way:
  a horizontal rail in a lane, with the line branching out to it and back.
  That was fine while trunks were level. They are not any more -- a line
  climbing back from the school run or leaning down towards dinner spends a
  good part of the day at 45 -- and where an event happens DURING one of
  those runs, the branch draws a second version of a move the line is
  already making. Marge's Book Club at 9am sits on a little horizontal shelf
  beside her own 45, as though the two were unrelated. It should be a dot on
  the diagonal, a tick further up it, and the caption alongside.

  The rule is easy to state and I got it wrong once already: "if the trunk
  is on the move for the length of the event, the event is a mark ON the
  trunk". Applied as written it swallows nearly every event on the board,
  because with convergences the trunks are moving for much of the day, and
  every caption then has to be placed against a sloping line with nothing
  to hang off. It needs to be narrower -- probably "the run the line is
  making is the same move the branch would have made", measured, plus a
  caption placer that can work beside a 45 -- and the caption side of it is
  the real work, not the marks.

  Also wanted, from the same picture: where an event genuinely cannot go on
  the diagonal, the branch it gets should leave and MERGE BACK quickly
  rather than running on to a terminus, so a short detour reads as a short
  detour.

- [ ] **E9. Drop `siding` from the config; let the algorithm find them.**
  A siding is currently something the user declares (`siding: true`, read
  into `metro.sidings`), and it is the last piece of layout the config still
  dictates. It should not be: a siding is "this line is somewhere else for a
  stretch of the day", and that is a fact about the EVENTS, not a setting.
  An all-day or most-of-day event on one line, a long block that swallows
  several shorter ones, a stretch two lines spend together -- the layout can
  see all of it and decide, the way it now decides convergences.

  Two reasons it matters beyond tidiness. A declared siding is a promise the
  drawing has to keep even when the board has no room for it, which is where
  several of the standing layout failures live. And it was a declared siding
  that broke the device: an all-day "Spring Break" counted as a clash and
  turned every convergence on the board back into a dead-end bundle, because
  the code had two ideas of where a line goes and only one of them knew
  about the other.

  Removing it touches `parseConfig`, the editor's importer, `metro.sidings`,
  `CONFIG.md`, and the `siding-day` / `shared-siding` fixtures. `station:
  true` is already kept as an undocumented alias for configs written before
  the rename, so there is a precedent for reading the old key and ignoring
  it.

- [ ] **E17. The rejoin branch is unreachable, and two rules disagree because
  of it.** A solo event of four hours or more is `_onLine`
  (`runTooLongForAShelf`, shared.liquid): it is drawn along its own line
  with a leader back from the caption, and never takes a lane. The rejoin
  gate needs four hours too -- `MIN_REJOIN_MIN`, the same 240 -- so by the
  time an event is long enough to loop back to its line it is long enough
  never to have left it. Measured: zero rejoins across all fourteen
  fixtures at both landscape sizes.

  So `if (best.dir > 0 && !best.joined && !shared && longEnough)` and
  everything under it is dead, and both `plugin/AGENTS.md` ("only a solo
  event of four hours or more climbs back") and the ramp-builder comment
  above it describe a shape the board no longer draws.

  Not removed here, deliberately: it is forty lines of layout code that
  nothing can currently exercise, so deleting it is a change no test can
  confirm. It wants doing as its own commit, with the two documents fixed
  in the same breath. `test/layout/cases/rails.js` now pins what the board
  really does, so the deletion cannot quietly change behaviour.

- [ ] **E14. The two biggest text tiers ignore the device's font setting.**
  Carried over from the old tracker. The device's Font Family setting
  (Default / Classic / TRMNL) only redefines `--title-*` and `--label-*` for
  the roles it names, and `title--xlarge` / `title--large` -- the two tiers a
  TRMNL X actually uses -- are not among them, so those stay on Inter
  whatever the device is set to. Verified locally with the framework
  webfonts downloaded and the CSS font paths rewritten.

  Needs a decision rather than a fix: cap the tier ladder at `title--base`
  so the setting always applies, or leave the big tiers alone.

- [ ] **E8. Thicker tracks on the large panel.** Line weights are chosen in
  layout px and then multiplied by `S`, so a TRMNL X at 1872x1404 draws the
  same rail the OG panel does, only bigger -- which means it reads as
  THINNER, because there is far more board around it. A metro map's line
  weight is a share of the page, not a constant. The big panel should carry
  visibly heavier track (and heavier marks with it, since `markOut` and
  `NODE_STROKE` are sized off the rail), so a full-size board looks like a
  poster rather than a small diagram enlarged.

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

---

## Done

One line each; the reasoning is in the code, in `rules.md`, or in the commit.

- P2. The 45 reclaim runs after the captions now, and takes nothing (29g)
- A7. The backwards branch on an X quadrant, looked at on a real quadrant
- A8. A line's name and the first caption of the day wanted the same paper
- A12. A junction drew its own main line twice to get a fillet out of it
- A14. Line names overlapped because a zero-height measurement disabled the column
- A20. The shed count is part of the name block, not an annotation stuck on after
- P1. A solo event during a shared one: 26a, and nobody is in two places
- P3. A late arrival joins the corridor, and the capsule spans who is in it
- C1. The demo settings are in a Developer group, and the suite says so
- A1. Tracks squashed into a third of the board
- A2. Line names sitting on their own rails
- A3. Station captions collide
- A5. WITHDRAWN, this was a misreading
- A6. Terminator tick misplaced on a backwards branch
- A13. A stretch of rail floating in the middle of the board
- A9. The trunk was interrupted where a siding began
- A11. Every "small view" in the layout suite was rendering full
- B1. A calendar `name` silently becomes a line
- B2. "Let an AI do it" belongs at the top of the editor, right
- B3. The prompt should carry a full worked example of an advanced
- B4. Drop `timeZone` and `locale` from the prompt
- B5. Remove `side` and `color` everywhere
- C2. Remove the "6am 11pm" span pill from the header
- C3. Quadrant and the small vertical views
- C4. Quadrant and half-horizontal (sm/md) waste a whole header band
- C5. Temperature unit setting
- D1. Timeouts and errors
- D2. Saved state (https://help.trmnl.com/en/articles/16777795),
- D3. i18n as JSON files in the repo, fetched by `transform.js`, so
- D4. Demo weather data in the demo configs, covering every weather
- E26. The demo board's line order is a hand-written guess
- E27. A vertical through a caption is charged by area
- D6. Optimise the logo SVG per colour variant
- E23. The captions were placed by the strategy the literature calls
- E22. The board was laid out against a font it was not drawing in
- E20. Captions walk past a neighbouring rail, so they read as
- E19. The caption overlaps cannot be priced away
- E1. The metro car should read as a train
- E3. Midnight terminal
- E4. Night express compression
- E12. An all-day event belongs at the line's head, not on the axis
- E15. A public holiday belongs to the day, not to a line
- E16. The rule editor has no control for `allDay` or for deleting the
- E5. Preset library in the editor
- E6. Localized weather alert banner
- A configuration pasted from a chat window (markdown-escaped, fenced,
