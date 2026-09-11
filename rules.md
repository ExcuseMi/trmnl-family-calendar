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
    school; a second copy of them at their desk reads as the track being
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
    when it is needed.** What is between them is straight track, which is the
    only thing straight track should mean.
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
19. **Lines leaving a corridor stagger.** They peel off a couple of corners
    apart, furthest-to-travel first so it clears the others before they move.
    Five corners on one minute is a knot.
20. **A line that crosses another dives under it.** The one further from its
    own baseline gives way and is drawn with a gap; the line running where it
    always runs keeps its ink. The gap is set by how fast the two close, so a
    shallow crossing opens a longer one.
21. **A sliver between two gaps is not drawn.** The eye carries a line through
    a gap and can make nothing of a fragment.

## 4. Events

22. **A person's own event is a branch.** It leaves the line, runs a lane
    carrying its caption, and either rejoins or ends in a terminus bar.
23. **A shared event is a convergence.** The lines lean in, run together for
    the length of it, and part again.
24. **A convergence falls back to a bundle** only when the lines cannot all be
    free at that minute -- one of them is already converging elsewhere. A
    siding is not a reason: being on Spring Break has never stopped anybody
    having dinner.
25. **Four hours or more is a siding**, decided from the clock. Every long
    block in every demo calendar is a school day, a shift, a desk booking or a
    delivery, and nothing under four hours is.
26. **The vocabulary of marks is fixed.** A filled dot is a stop the line
    calls at; a tick across the rail is where it stops being there; a hollow
    ring is an interchange; a capsule spans every line at a convergence. A
    moment (no duration) gets one mark, not two.
27. **A tick stands square to the rail it marks**, not to the clock.
28. **A convergence ends in a tick on one rail**, in that line's own colour --
    not a bar across the corridor, which says the lines all stop there.
29. **A convergence gets a leader to its name**, because it has no rail of its
    own to carry one.

## 5. Words

30. **A caption belongs beside its own rail**, on the outside, starting at the
    stop it names.
31. **Nothing is written over anything.** Captions are placed against the
    board: the other captions, the rails, the moving trunks, the line names,
    the clock badge.
32. **A caption gives way by sliding along its own rail first**, then by
    changing sides, and only then by moving further out.
33. **A caption may not walk past another line to find room.** A name on the
    far side of somebody else's rail reads as theirs.
34. **A line behind words is untidy; an event not on the board is worse.**
    Every caption carries a paper outline, so a rail passing behind it is a
    last resort that is still better than dropping the event.

## 6. Which order the lines go in

35. **Fewest crossings.** Every line sitting between two people who share an
    event is a line their lines must cross to reach each other, and since a
    shared event moves the trunks that crossing is real ink. The order with
    the fewest is chosen exactly for up to eight lines; greed above that.
36. **Closest pairs adjacent** breaks a tie between orders that cross equally
    often.
37. **A weave is a tie-break, never part of the score.** An order that is only
    good once somebody weaves it is not good, because the client decides
    weaves for itself and nothing upstream can promise one.
38. **The order survives to the drawing.** Renumbering to close the gaps left
    by dropped lines sorts by the offset the solver gave, or every ordering
    decision is thrown away one function later.

## 7. What the configuration may say

39. The config names lines, routes events onto them, renames, hides, and says
    which lines share an event. That is all.
40. **It may not ask for a siding.** `siding` and the `station` it shipped as
    are gone; a long block is a siding because it is long. A config carrying
    either key still loads, with the key ignored.
41. **It may not set a side, a colour or a pattern** beyond naming them: side,
    hue and texture follow the order the solver picks.

## 8. Panels

42. **The same board at four sizes**, plus half and quadrant slots. Nothing is
    laid out twice: the layout measures the canvas it is given.
43. **Spare depth is spent on separating the lines**, then on lane pitch.
44. **An event that will not fit is dropped and counted**, at the end of the
    axis, rather than drawn on top of something.

---

## Rules that are stated but not kept

Known gaps, so nobody reads this as a description of a board that exists:

- **31** is the weakest. Nine captions on the layout suite still have a line
  through them, nearly all of them a trunk crossing a caption that the lane
  machinery placed against a board of level lines.
- **16/17** is newly written and newly implemented; the clearance it keeps is
  a fixed fraction of a track step rather than anything measured against the
  events that need the space.
- **E10** in `issues.md`: an event during a diagonal run should be a mark on
  the run, not a branch drawn beside it. Tried once, reverted.
