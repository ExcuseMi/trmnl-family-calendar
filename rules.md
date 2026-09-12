# Rules

Every rule the board draws by, in one place. Written as statements with the
reason attached, because the reason is what tells you whether a rule still
applies when something changes.

`DESIGN.md` says what the thing looks like. This says what it must do.
Where the two disagree, this one is newer.

---

## 1. The board

1. **Time runs along the long side.** Horizontal on a landscape panel,
   vertical on a portrait one. Everything below is written for horizontal;
   "along" means the time axis and "across" means the other one.
2. **Quiet hours are compressed, not cut.** The scale runs faster through
   stretches with nothing on them, and the change of rate is drawn on the
   hour strip and on the lines (the speed marks).
2a. **A quiet day is drawn with the next one.** Two events or fewer STILL TO
   COME on the day being shown and the board runs on to six the following
   evening, because a day with one appointment left on it spends most of the
   board on hours nobody has anything in, and what is coming is the thing
   such a day still has to say. A busier one is the single day it always was.
2a-i. **The board gains tomorrow once a day, on an hour, and never gives it
   back.** The window may not be read from the clock continuously: the panel
   refreshes every fifteen minutes and a board keyed to "now" slides every
   event left four times an hour under whoever is reading it. So the window
   moves exactly once, at four in the afternoon -- the day's own start until
   then, four o'clock after that -- and nothing on the board slides.

   The COUNT is a different question and is taken on the hour. Sharing the
   window's boundary made the board blind: counted once at four, a day with
   three or more things after four never reached tomorrow at all, and a real
   panel was still drawing only Saturday at a quarter past eight with one
   event left on it. Taking the count more finely is safe in a way that
   drawing more finely is not, and the reason is the whole rule: the set of
   events still to come only ever SHRINKS, so the answer can go from "busy" to
   "quiet" and never back. The board gains a day and cannot lose one.

   The window may therefore draw more than the count counted, and that
   direction is the safe one: at eight the count sees one event left and the
   window still opens at four, so the evening stays on the board. The
   direction that is not safe is a board that counts itself quiet and then
   draws a morning it had decided to leave behind.

   This is what the old "switch over at nine" setting was for, and why it is
   gone: it reached tomorrow by DELETING today, at an hour that was wrong for
   any day but the one it was tuned on. Four because noon is the middle of a working day and not of a
   family's: at 12:01 most of what a household does is still ahead of it.
   What falls before the window is not lost, it is counted at the leading
   edge as "+N earlier" -- on the same terms as the date marker, which is to
   say the clock badge has first claim on that spot and the count appears
   once the badge has moved along. The one shape change this allows is a gain; losing
   today, which the evening switch-over does, is a different rule and a
   blunter one.
2b. **The night is not drawn.** It was, for a long time: ten at night to
   six in the morning as a corridor of upright hairlines the depth of the
   board, because a board covering two days is one continuous scale and
   "the midnight bar alone is a line, not a duration".

   It never read as a duration on the board that needed it. A rolling board
   compresses the night hardest, so the zone it is meant to draw is exactly
   where there is least room to draw one, and it came out as a handful of
   vertical rules bunched a thumb apart beside the midnight bar. Thinning it
   twice -- a fractional pitch, no stroke on top of the midnight -- made it
   quieter without making it legible, and the question it kept prompting
   from the person reading the actual panel was "what are all these vertical
   lines?". A mark nobody can name is not a quiet mark, it is noise.

   ONE VERTICAL IN THE NIGHT, AND IT IS THE MIDNIGHT. What is left says the
   same things better and all of it was already load-bearing: the midnight
   bar says where the day changes, the day badges on the strip name which
   day each side of it is, the hour labels jump from 9:33pm to 4am to 8am,
   and the express hatch and the speed marks say those hours are compressed.
   The night was the only one of the five that had to be explained.

   The hatch and the speed marks therefore cover the night rather than
   standing off it: the stand-off existed because two marks over one stretch
   of time say two different things are happening to it, and with the
   corridor gone the hatch is the only thing saying the scale changes there.
   The express portals still stand off a night, for the opposite reason --
   the midnight bar is in the middle of that stretch and it should be the
   only vertical the reader has to name.

   The model still tracks the night. It is how the axis knows a run has one.
2c. **Each day names itself on the hour strip, and the strip is the
   header.** An hour label says only the time, and "09:00" on a 36-hour
   board is two different mornings, so the day a midnight opens is written
   at that midnight, among the hours rather than loose on the map -- as a
   badge carrying that day's date, what the day IS, and what the sky is
   doing on it. The day the board opens on is named the same way at the head
   of the axis, on every board, including a board that never leaves its own
   day.

   There was a band above the map: a logo, the word "Today", a date and a
   forecast, 58px deep on every panel, an eighth of an 800x480 board. Four
   of the five things it did the strip was already doing -- what time it is
   now, which day each half of a two-day board is, what has scrolled off
   either end, where the scale changes rate -- and the fifth, the weather,
   is a fact about a DAY and belongs at that day's own end of the scale.
   What the band really was, was the map paying for something on the map's
   behalf.

2d. **A badge is an annotation on the scale, not a tenant of it.** So it
   gives way in a stated order as the axis runs out: which day of a holiday
   range this is, then the forecast, then the name of the day, then the long
   date for a short weekday, then the badge for a bare date, then nothing.
   Two hard limits under all of that: no badge takes more than about a third
   of the whole scale, and none reaches past the midnight that ends the day
   it is naming. And the date is asked for BEFORE the clock, which wants the
   same corner whenever a board is read in the first minutes of its window:
   the hours along the whole strip already say what time it is, and the next
   refresh moves the clock clear by itself, whereas nothing else anywhere on
   the board says which day this is.
3. **One line per person, parallel to the axis**, at a fixed distance from
   the spine that is decided once per board.
4. **A line is named at its own head**, and the name and the line must agree:
   a line starts the day on its own lane for that reason and no other.

## 2. Telling lines apart

5. **Four textures, all the same weight.** Solid; dashed, where the paper
   core is as wide as the line so it cuts all the way through and what is
   left is ink in lengths; dotted, paper dots inside a whole line; and short
   ink dots with wide gaps. Weight alone cannot carry it on a 1-bit panel.
6. **No texture may read as two lines.** A tramline (a continuous paper core)
   was tried and removed: two rails running together is what a shared event
   is drawn as, so nothing else may look like it.
7. Five lines on four textures means one repeat. The repeat is placed at
   opposite ends of the board and given a different weight.

## 3. Where a line goes

8. **Only a shared event moves the trunk.** A line moving on the board should
   mean something spatial. Two people being in the same place is spatial; "she
   had a meeting at eleven" is not, and a trunk that climbs for it says
   something the calendar never said while costing the map its straight
   running.
9. **A siding is a hold like any other.** A long block -- a school day, a
   shift, a delivery -- says the same thing a convergence says: this line is
   over here, from this minute to that one. One model owns where a line goes.
10. **A shorter siding wins inside a longer one.** Two can cover the same
    minutes; the more specific is the shorter, so they are laid down longest
    first and each new hold cuts the ones already there.
11. **A siding takes the line with it and leaves nothing behind.** There is no
    express running straight through at the baseline. A person at school is at
    school; a second copy of them at their desk reads as the line being
    permanently split.
12. **Only 0, 45 and 90 degrees.** A line runs straight, and where it changes
    lane it does it in one deliberate 45 with the two knees rounded, then runs
    straight again.
13. **90 is the last resort, not a way of making room.** Where a gap cannot
    pay for a 45, the line goes as far as the gap buys and holds there rather
    than taking a right angle to arrive.
14. **No curves.** A knee may eat at most a third of a move, so there is
    always a straight 45 between the two arcs. Allowed half, the arcs meet and
    the move becomes a smooth S.
15. **A line leaves a hold as soon as it is over and arrives at the next one
    when it is needed.** What is between them is straight line, which is the
    only thing straight line should mean.
16. **Going home is for clearance, not for tidiness.** Between two holds a
    line heads back toward its own lane so that it has room around it and its
    events have space of their own to hang captions in. It does not have to
    get all the way there.
17. **It does not go home if that means crossing.** Anything lying between the
    line and its lane would be passed twice, once each way, for a detour a
    reader cannot name a reason for. The detour stops a clearance short of
    whatever is in the way.
18. **A line does not have to end on its own lane.** It has to start there,
    because that is where its name is. After the last thing somebody did there
    is nothing more to say, so the run home happens if there is room to draw
    it properly and otherwise the line ends where its day ended.
19. **The lines that do not make it home finish evenly spaced.** The run home
    is worth whatever 45 degrees can buy in the minutes left, which is the
    same distance for everybody, so a bundle that breaks up late keeps its
    own spacing all the way to the edge and the end bars overlap. The ends
    are spread evenly across the board instead, between the innermost line's
    reach and the outermost line's, and no line is aimed at a place it
    cannot get to. Arriving is worth less than being apart.
20. **Lines leaving a corridor stagger.** They peel off a couple of corners
    apart, furthest-to-travel first so it clears the others before they move.
    Five corners on one minute is a knot. Not on the run home: there is no
    next hold to be on time for, the minutes left are the scarce thing, and
    rule 19 has already given each line a different height to turn at.
21. **A line that crosses another dives under it.** The one further from its
    own baseline gives way and is drawn with a gap; the line running where it
    always runs keeps its ink. The gap is set by how fast the two close, so a
    shallow crossing opens a longer one.
22. **A sliver between two gaps is not drawn.** The eye carries a line through
    a gap and can make nothing of a fragment.

## 4. Events

23. **A person's own event is a branch.** It leaves the line, runs a lane
    carrying its caption, and either rejoins or ends in a terminus bar.
24. **A branch does not leave before the shared event before it is over.**
    The departure walks back along the trunk looking for the point where its
    45 works out, and a deep clean at eight found that point at ten to six,
    which drew the rail up across the whole of a six o'clock coffee with
    somebody else. Whoever is in one place cannot be on their way to
    another. Where no 45 is left by then, the branch takes the other legal
    angle at the event's own minute.
25. **A shared event is a convergence.** The lines lean in, run together for
    the length of it, and part again.
26. **A convergence falls back to a bundle** only when the lines cannot all be
    free at that minute -- one of them is already converging elsewhere. A
    siding is not a reason: being on Spring Break has never stopped anybody
    having dinner.
27. **Four hours or more is a siding**, decided from the clock. Every long
    block in every demo calendar is a school day, a shift, a desk booking or a
    delivery, and nothing under four hours is.
28. **The vocabulary of marks is fixed, and it is sized, not filled.** A
    small paper-filled dot is a stop the line calls at; a tick across the
    rail is where it stops being there; a larger paper-filled ring is an
    interchange; concentric rings are an all-day landmark; a capsule spans
    every line at a convergence. A moment (no duration) gets one mark, not
    two. Every shape is paper inside with a heavy outline and they differ by
    SIZE, which is the Mini Metro convention: a mark filled with its own
    line's ink is the one mark that cannot be seen, because it is the same
    ink as the rail it sits on. (This rule used to say "a filled dot", which
    the drawing has never done and never should.)
28a. **A capsule names its members only where something else is inside it.**
    The Underground draws one circle per line inside a multi-line
    interchange, so you can count who is there. Measured across every
    capsule on every fixture and all three viewports -- sixty of them --
    exactly ONE spans a rail that is not a member. That is structural, not
    luck: our lines come TO the event, so a convergence pulls its members
    into a tight corridor and the pill it spans holds nobody else. A real
    transit map's lines stay where they are and its interchange symbol
    reaches across whatever lies between, which is why it needs the circles
    and we almost never do.
    So the members are marked on the board that needs it and nowhere else.
    A mark that answers a question nobody can ask is just ink, and on the
    other fifty-nine it came out as a dotted stripe down a pill that was
    perfectly clear without it.

29. **A tick stands square to the rail it marks**, not to the clock.
30. **A convergence ends in a tick on one rail**, in that line's own colour --
    not a bar across the corridor, which says the lines all stop there.
31. **A convergence gets a leader to its name**, because it has no rail of its
    own to carry one.

29a. **Two angles, and they mean different things.** A 90 is abrupt: it says
    the line has ARRIVED somewhere, and it is the mark of an interchange,
    which is the only thing on this map worth interrupting a baseline for.
    A 45 is a lane change, the line adjusting where it runs rather than
    doing anything. Making everything a 90 says every adjustment is an
    event; making everything a 45 turns a four-band move into a diagonal
    across the whole afternoon.
29f. **A convergence takes the 90 by preference, not by defeat.** 29b reads
    as though the right angle into a family event were a compromise the
    arithmetic forced, and measuring the board makes it sound worse than it
    is: about a third of all track ink is vertical and under three per cent
    is at 45. Nearly every one of those right angles is a line arriving at a
    shared event or leaving one, and that is the mark 29a says a 90 IS.

    It is also what we would choose with the room to spare. A long diagonal
    into a family event eats an hour of axis on the way in, and it takes the
    captions with it: every name along that stretch is pushed together, and
    the shallower the approach the harder the line is to follow with an eye,
    because it spends the whole run between two rows instead of on one.
    Straight in, turn, arrive is less true to how the day felt and easier to
    read, and easier to read wins. Where a 45 WOULD fit into a convergence,
    it is still not automatically the better mark.

    This does not license the 90 anywhere else. Rule 13 stands: outside a
    convergence, a move that cannot pay for its 45 holds short instead of
    turning square.

    Measured, once 29g could ask the question of a FINISHED board. Let the
    convergence 90s be candidates and there are 206 of them across the 32
    landscape boards; of those, seven can be softened without moving a
    single thing, and the seven are not an improvement. Maggie leaves her
    nap at half past two and reaches dinner at seven on one unbroken
    diagonal, which draws four and a half hours of travelling where she was
    at home. The rest are refused because something is hung on the stretch
    of rail that would move -- 97 a branch's foot or a mark, 23 a name.
29b. **45 by default, 90 when the day runs out.** A 45 costs one pixel of
    axis for every pixel it climbs, so whether it is available is
    arithmetic, not preference: where the remaining runway is shorter than
    the climb, the move is a 90. Leaving Family Dinner at eight, Homer is
    310px from his own line with 130px of board left; there is no 45 there
    and a shallower angle is not a compromise, it is a fourth angle this
    map does not have.
    Never by starting the move early to buy runway. A line leaving an
    interchange before the event ends says the person left early, and the
    board would be lying about the one thing it exists to state.
29g. **A 90 that could be a 45 for free becomes one.** The angles are not
    interchangeable (29a) and a 90 has to be earned: by arriving at a
    convergence, or by there genuinely being something in the way, or by the
    runway genuinely running out. Where none of those is true any more once
    everything else is placed, the move takes the 45 it should have had.
    This is a RECLAIM, not a preference. Rule 13 already governs the forward
    decision -- do not turn square to make room -- and this covers the case
    that rule cannot see: a move squared against a condition that was true
    when it was decided and is not true of the finished board. The commonest
    is a line squared to avoid crossing a neighbour's BASELINE while that
    neighbour was itself up in a corridor and its baseline was empty.
    Nothing may move to make this possible. Not the labels, not the other
    lines, not the minute the move starts or ends: if taking the 45 disturbs
    anything at all, the 90 stands.
29d. **A 45 may not cross another line's baseline.** A 45 that changes lane
    inside the gap between two lines is a lane change; a 45 that travels
    ACROSS a line runs alongside it at a shallow converging angle for its
    whole length, and the two read as meeting. The Professor's morning
    climb passed through Amy that way for three hours. Where anything lies
    between here and there the move goes square, which crosses in one place
    at a right angle and is unmistakably a crossing rather than a merge.
29e. **A start is a dot, an end is a tick, and a tick needs level rail.**
    A dot sits ON the line, so it can mark a corner: a start usually lands
    on a bend and the dot reads as a mark on this line rather than as a
    second line crossing it. A tick stands SQUARE to the rail, which means
    that where the rail is vertical the tick is horizontal -- a stray bar
    lying flat in open paper with the line running past it. Book Club ends
    at ten and Marge is dropping toward the school run at ten.
    So a tick is drawn only where the rail is running level, and where the
    end lands on a fillet or a transition it is not drawn at all. The event
    still has its dot, its name and its times, and a glyph that has to be
    explained is worse than no glyph.
29c. **A line ends on a 45 slash.** Its own mark, not the crossbar an
    event's end tick uses: three different things drawn with one glyph can
    only be told apart by position. Nothing else on this map is drawn at 45,
    which is what makes it read.

## 5. Words

32. **A name on a slope is set on the slope.** A mark on a climbing trunk
    has no horizontal anything to sit beside, so a horizontal name beside it
    points at paper rather than at the rail. Set at the rail's own angle,
    starting past the end tick and running outward, it reads as belonging to
    the line the way a station name on a transit map does, and it lives in
    the WEDGE between two lines, which is paper no lane can use. That last
    part is the reason to do it at all: a lane costs the board a lane-step
    of depth and a wedge costs nothing.
33. **Clearance from a slope is measured perpendicular to it**, and it
    includes half the words' own height, or they straddle the rail they
    name.
33a. **Octagonal angles only.** Every rail on this map runs flat, upright or
    at 45, and a name is part of the same drawing. A name set at the angle
    a trunk happens to be passing through at that minute, taken off an eased
    corner, comes out at something like 41 degrees and reads as a mistake,
    because here it is one.
33b. **A name leans away from its own line as it reads.** There are two
    orientations and the side of the line the words sit on chooses between
    them:
    - set BELOW the line, the name runs north west to south east: down to
      the right.
    - set ABOVE the line, the name runs south west to north east: up to the
      right.
    Either way it leaves the rail at its first letter and has open paper
    for the rest. Leaning the other way turns the name back towards the line
    it came from, so it ends up along its own rail or across it, and it
    walks into the band where that line's neighbour and all of its labels
    are instead of into the empty wedge beside it.
33c. **The side decides it even on a slope.** Rule 32 says a name beside a
    moving trunk is set ON the slope, and that is about the ANGLE. Which of
    the two 45s it takes is still 33b's answer, not the trunk's: a name
    above a rail that happens to be falling is still above it, and sending
    it down after the rail runs the words back across the wedge they were
    put in and out the far side.
33e. **Either orientation, out of necessity.** 33b is a preference, not a
    law. Where the preferred lean cannot be placed without crossing a rail
    or another name, the name takes the other 45 rather than being pushed
    away from the mark it belongs to: a name leaning the less good way
    beside its own stop still says which stop it is, and a name shoved a
    band away to keep its slope does not. Swim Training is the case: the
    only clean run out of it is the one 33b would not have picked.
33d. **These rules are for a name set against a LINE**, which is what a mark
    and a convergence have. A shelf's name belongs flat beside its own rail
    (rule 34). An event that changes shape gives up the caption that went
    with the old one.

34. **A caption belongs beside its own rail**, on the outside, starting at the
    stop it names.
33e. **A line is named at BOTH ends, where there is room.** A transit map
    letters both termini; this board lettered only the head, so on a wide
    panel the far end of a line is a hand's span of paper away from the one
    thing that says whose line it is. The tail name is drawn into the gap
    that happens to be there -- after the last caption and the last ink on
    its row, and short of its own end mark -- rather than into a reserved
    column, because reserving axis at both ends costs every board the width
    whether it can spare it or not. A busy line therefore does not get one,
    which is the right answer: a name crammed against the last event of the
    day is worse than no second name.

33f. **A caption may not be written across a midnight.** Position along this
    axis means WHEN, and the midnight bar is the one place on the board
    where it also means WHICH DAY, so a name that straddles it is read on
    the wrong side of it. Reported from a panel as an event being on the
    wrong day: it was not, a Sunday afternoon had slid far enough right that
    its words sat in Monday.
    Nothing else catches this and nothing else can. A caption is allowed to
    slide along its line to find paper (34e), the bar is three pixels of
    ink, and every clash test the slide passes on the way is telling the
    truth -- it is not written over anything. It is written over a DATE.
    Corrected rather than priced, and that is the point: a rail through a
    name is untidy and a name on the wrong day is WRONG, and no amount of
    crowding makes the wrong side the right answer. Where the correction
    puts the words against something else, that is a worse-looking board and
    a truthful one.

34a. **Six pixels of paper round every rail and every caption**, its own
    rail included, descenders included. Merely not touching is not enough:
    a name dropped into the slot between two close lines is clear of both
    and reads as belonging to neither. Two rings, and they are not worth the
    same -- the ink is hard and nothing may be written over it, the paper
    round it is a preference the search may squeeze into. The band solver
    books the identical allowance, not just the caption pass: asked for a
    slot nobody reserved, the pass finds none at any text size, and the tier
    loop, shown a board equally bad however small the words get, keeps the
    biggest ones.
34g. **A name that has travelled is ticked back to its stop.** A caption
    against its own rail begins at the ring and needs no pointer. One pushed
    out to a lane, or slid along the line to find paper, is the one the eye
    cannot pair with a dot, and it gets a thin tick in its line's own
    colour: five pixels clear of the ring, so the two do not read as one
    lollipop, and short of the words, so it points at the name rather than
    underlining it. Only where the standoff already has room for one --
    widening every caption to make room cost six boards and fixed five, and
    no measure of how roomy a board is separates the two sets, because what
    decides it is what is on the board. The tick gives way to any other
    caption it would cross, because it is a nicety and rule 35 is not. Its
    LEAN is capped at half the name's own width -- rule 34e's own limit,
    scaled to the name because the slide is -- so it never becomes a shallow
    diagonal running parallel to the rails. Straight out across the board it
    may go as far as it likes: what stops pointing is travel along the axis.
34d. **A leader is a tick, not a tether.** Past about thirty pixels a stem
    stops pointing at anything -- the eye pairs the words with whatever rail
    is nearest, which by then is somebody else's. Charged steeply beyond
    that rather than forbidden: cut off hard, a caption that really needs
    the outer rung slides until it collides instead, and a long stem is
    untidy where two names on each other is one name gone.
34e. **Sliding stops where pointing stops.** Sliding along the line is the
    cheaper answer than a longer stem, but only as far as a name can slide
    and still name something -- about half its own width, which is the same
    limit rule 35 calls adrift. Past that, pay for the stem.
34f. **A time range says am or pm once** when both ends fall in the same
    half of the day: "9 - 10:00am", not "9am - 10:00am". A caption's width
    is what the band solver reserves through `markRoom`, so four characters
    of repetition are booked as board. Across noon both halves are named,
    because there the repetition is carrying information.
34b. **An enclosure's name goes above its pill, centred**, and everything
    whose words overlap that pill goes BELOW it. The region becomes one
    stack with the interchange named at the top of it.
34c. **A stack runs in start-time order, earliest highest.** This needs no
    sort of its own: captions are placed in start-time order and each takes
    the nearest free rung, and below a pill the nearest rung is the highest
    one.
35. **Nothing is written over anything.** Captions are placed against the
    board: the other captions, the rails, the moving trunks, the line names,
    the clock badge.
36. **A caption gives way by sliding along its own rail first**, then by
    changing sides, and only then by moving further out.
37. **A caption may not walk past another line to find room.** A name on the
    far side of somebody else's rail reads as theirs.
38. **A line behind words is untidy; an event not on the board is worse.**
    Every caption carries a paper outline, so a rail passing behind it is a
    last resort that is still better than dropping the event.

## 6. Which order the lines go in

38a. **A rule THROUGH a name is not the same fault as a rail behind it.**
    Rule 38 lets a line pass behind words because every caption carries a
    paper outline and the words stay readable. That is about a rail running
    ALONG under a line of text. A vertical crossing them at a right angle
    cuts the name in half, and the placement search cannot be allowed to
    treat the two alike -- which it did for as long as it priced obstacles
    by overlap AREA, because a vertical is thin by definition and so scored
    cheaper than the harmless case. A drop is charged by how much of the
    caption's HEIGHT it crosses, squared, against the caption's own area: a
    clipped corner is nearly free and a full cut costs more than the words
    are worth.

38b. **A badge nobody can tell from another badge is not a badge.** The
    letter in a car is the first character of the line's name, and a
    household is exactly where that collides: Marge and Maggie both came out
    `M`. The two cars then sat a few rows apart carrying the same letter,
    with only the texture of the row to tell them apart -- which is the very
    thing the badge exists to disambiguate, because the car is what you look
    at when you cannot trace the row. A guessed letter grows a character at a
    time until it is unique, and only for the names that clash, so a line
    with an unambiguous initial keeps its single letter. A badge somebody
    ASKED for is never rewritten: their board, their letter, and a collision
    they can see is theirs to fix.

39. **Fewest crossings.** Every line sitting between two people who share an
    event is a line their lines must cross to reach each other, and since a
    shared event moves the trunks that crossing is real ink. The order with
    the fewest is chosen exactly for up to eight lines; greed above that.
40. **Closest pairs adjacent** breaks a tie between orders that cross equally
    often.
41. **A weave is a tie-break, never part of the score.** An order that is only
    good once somebody weaves it is not good, because the client decides
    weaves for itself and nothing upstream can promise one.
42. **The order survives to the drawing.** Renumbering to close the gaps left
    by dropped lines sorts by the offset the solver gave, or every ordering
    decision is thrown away one function later.

## 7. Panels

43. **The same board at four sizes**, plus half and quadrant slots. Nothing is
    laid out twice: the layout measures the canvas it is given.
44. **Spare depth is spent on separating the lines**, then on lane pitch.
45. **An event that will not fit is dropped and counted**, at the end of the
    axis, rather than drawn on top of something.

## 8. All-day events

An all-day event has no hour, so it has no place on a scale of hours. It is
a state a line is in, not a place it goes at a time.

54. **It is declared at the line's head**, in a second row under the name,
    with concentric rings. Nothing whatever is drawn for it between the
    first hour and the last. Drawn as an event spanning the visible window,
    the board printed its own window back as the event's hours: "6am - 11pm
    / Spring Break" is when the board started looking, not when the holiday
    is.
55. **Both ends of that line become open chevrons.** A terminus slash says
    the line stops there, and a day that is a slice of something longer did
    not begin at the first hour on the scale.
56. **One title shared by several lines is one origin**, named once, with a
    dashed out-of-station tie down to the other heads. Three people are not
    on three holidays.
57. **It still counts as content.** A line whose whole day is a holiday
    scores as occupied when the board decides which lines to keep, or the
    one line with something to say about today would be the first dropped.

## 9. Holidays

A public holiday is not one person's state. It has no hour and no owner:
it is what THE DAY is, the way the date is which day it is.

58. **Where a holiday is drawn follows from whose day it changes.** The
    config already answers that: a rule naming lines has said whose, a rule
    naming none has said nobody's. So `holiday` does not mean "the day
    badge", it means this is a STATE rather than an appointment -- rule 54's
    distinction -- and the place falls out. Christmas Day is nobody's and
    goes to the day; half term is the children's and not the parent's who
    still works, so it goes to their heads like any other state, named once
    with the tie between them. Only an explicit `line` counts: the fallback
    chain is what put a country's Christmas on whoever was first in the
    list.

59. **A holiday nobody owns is stated beside the date, on the date's own
    row.** Which is to say on the day badge (rule 2c). The three other
    places costed all charge the map for it. A band or a marker on the hour
    scale puts a thing with no hour on a scale of hours, which is what
    rule 54 already refuses for an all-day event, and it prints the board's
    own window back as the holiday's hours. A row at a line's head says
    that line's owner is on holiday, which on Christmas Day is true of
    everybody and so says nothing about anybody. A line of its own is the
    worst of the three: a line costs a band of the cross axis, it gets a
    name and a texture like a person, and on a cramped panel it can be kept
    while a real one is dropped. The badge is the one thing on the board
    already answering "what day is this", it stands at the boundary that day
    begins at, and it costs the map nothing because the strip under it was
    being drawn anyway.
60. **It costs nothing on a day without one.** Like the service banner: no
    holiday, no element, and the same board as before -- same canvas height,
    same rails, and a badge no taller than the one row it always was. That
    is the other half of the reason it is beside the date rather than on the
    map.
61. **Inside a range it says which day of it this is.** "Spring Break" runs
    a week and the board draws one day. Day 3 of 5 is the only thing
    telling the Monday from the Thursday, and it is the fact a household
    wants, because it answers when the thing ends. A one-day holiday has no
    ordinal, and "Day 1 of 1" is a sentence about nothing.
62. **A holiday opens nobody's ends.** Rule 55's chevrons say THIS LINE's
    day is a slice of something longer, which is a claim about a person.
    On a public holiday every line still starts and ends on that day.
63. **The day gets ONE name, however many feeds carry it.** Two people in
    a house subscribe to the same national calendar and the day did not
    happen twice. Where a day genuinely carries two (a public holiday and
    a school one), the badge still names one: it already carries a date and
    a forecast, and two names on it came out as "Christmas D" and "School
    Holid", each cut mid word with the ordinal wrapped underneath. Naming
    the day is the badge's job; enumerating it is not.
64. **It rides with the date.** Where the badge gives way to a bare date --
    a board standing up, where the strip is only as wide as an hour label --
    the holiday goes with it. A board with no room for the words that say
    what the day is still has to say which day it is, and a second home for
    a holiday would be a second thing to keep in step.

---

## Rules that are stated but not kept

Known gaps, so nobody reads this as a description of a board that exists:

- **35** is the weakest. Ten captions on the layout suite still have a line
  through them, nearly all of them a trunk crossing a caption that the lane
  machinery placed against a board of level lines.
- **32/33** are drawn but not yet MEASURED. The layout suite reads a label's
  box with getBoundingClientRect, which for a turned label is the upright box
  around it: at 45 degrees that is half again as big as the words in it, so
  three cases now report an overlap that is not there. The tests need the
  turned quad, not the box around it, before their verdict on an angled name
  means anything.
- **13 between two abutting holds.** Where a corridor ends on the same minute
  the next one starts there is no gap to turn in, so the line climbs dead
  vertical: Bart and Lisa go straight up out of the school run into the
  school day. The rule says hold short instead, and nothing does -- and with
  nothing to turn in, every line doing it turns on one x, which is the same
  defect from the other side. `issues.md` A4 has the diagnosis and the two
  ways of buying the turn some axis that were tried and measured.
- **16/17** is newly written and newly implemented; the clearance it keeps is
  a fixed fraction of a line step rather than anything measured against the
  events that need the space.
- **29g** is kept, and on today's boards it takes nothing back: every 90 on
  every one of the 32 landscape boards is a convergence's, which is 29f's
  and not this rule's to take. `reclaimDiagonals` in `shared.liquid` says
  what it costs to keep a pass that does nothing -- a walk over the spans,
  and no more unless there is something to reclaim -- and why it cannot be
  asked any earlier than it is. Portrait boards are out of it entirely,
  because `labelBoxes` has nothing to say there: see the 32/33 gap above.
- **E10** in `issues.md`: an event during a diagonal run should be a mark on
  the run, not a branch drawn beside it. Tried once, reverted. Rule 24 makes
  it matter more: where the gate leaves no 45, the branch takes a right
  angle, and a mark on the diagonal would be the better drawing.
- **E11** in `issues.md`: a long event should be a band along the main line
  rather than a siding that moves it, and should become a branch only when a
  shared event needs the line. Rules 9 to 11 and 26 describe the siding
  model that is there now.
