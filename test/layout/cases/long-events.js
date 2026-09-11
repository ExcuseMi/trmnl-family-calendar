'use strict';

// A LONG EVENT is a stretch of the day somebody spends in one place: a
// school day, a shift, a desk booking, a delivery run, an all-day holiday.
// Four hours or more, or all day, decided from the clock.
//
// It used to be a SIDING: its own array in the payload, drawn as a kink
// that took the line off its own lane for hours. Nine hours of "Desk
// booking" bent Ward's day away from his baseline, and the baseline is the
// one thing on the map that should never move. The loop that was tried
// first was worse: a siding leaving the line and an express running
// straight on at the baseline, which over a seven-hour school day drew the
// two side by side for most of the board and said the track was
// permanently split.
//
// Now a long event ONE person is at is drawn where that person already is,
// on the main track. It takes no rung on the lane ladder outward and draws
// no branch; the line stays where its name says it is, and the caption
// goes in a rung reserved on the track's inward side.
//
// A long event two people SHARE is not special at all. It is a shared
// event, which is a convergence, which is what two children at the same
// school all day look like.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, textLabels, deepestIntrusion, overlap, eventsIn, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');
  const TIGHT = byName('og-landscape');
  const BOTH = [ROOMY, TIGHT];

  // Four hours, the same number the client decides from. Every long block
  // in every demo calendar is a school day, a shift, a desk booking or a
  // delivery, and nothing under four hours is.
  const LONG_MIN = 240;
  const isEvent = (i) => i.type === 'event';
  const isLong = (i) => isEvent(i) && (i.all_day || i.end_min - i.start_min >= LONG_MIN);
  const longSolos = (f) => f.metro.items.filter((i) => isLong(i) && !(i.co_owners || []).length);
  const longShared = (f) => f.metro.items.filter((i) => isLong(i) && (i.co_owners || []).length);

  const solo = fixtures.find((f) => f.name === 'long-event-day');       // "Desk booking", work only
  const shared = fixtures.find((f) => f.name === 'shared-long-event');  // "School Day", sam + kids

  // Where a line's own lane is, in drawn pixels: the spine, plus the
  // distance the band solver gave that track, on that track's own side.
  // Read out of the same numbers the drawing used rather than guessed from
  // the ink, so "the line is at home" is a claim about the lane and not
  // about wherever the line happens to be flattest.
  function homeC(f, rep, owner) {
    const t = f.metro.legend.find((x) => x.key === owner);
    const b = (rep.debug.bands || []).find((x) => x[0] === owner);
    if (!t || !b) return null;
    return (rep.debug.spineC + (t.side === 'left' ? -1 : 1) * b[3]) * (rep.debug.Z || 1);
  }
  // The COURSE is where a line goes, one unbroken path per line. The drawn
  // line is cut wherever it passes under something, so the ink is in runs
  // and the course is what to ask about position.
  function courseOf(rep, owner) {
    return pathsWhere(rep, 'course').filter((p) => p.owner === owner)
      .sort((a, b) => b.len - a.len)[0];
  }
  function courseC(rep, owner, a) {
    const c = courseOf(rep, owner);
    if (!c) return null;
    let best = null;
    for (const q of c.pts) if (!best || Math.abs(q[0] - a) < Math.abs(best[0] - a)) best = q;
    return best && best[1];
  }
  // every cross-axis position the drawn LINE is at, at one axis position
  function heightsAt(rep, owner, x) {
    const out = [];
    for (const p of pathsWhere(rep, 'track')) {
      if (p.owner !== owner) continue;
      let best = null;
      for (const q of p.pts) if (!best || Math.abs(q[0] - x) < Math.abs(best[0] - x)) best = q;
      if (best && Math.abs(best[0] - x) <= 4) out.push(best[1]);
    }
    return out.sort((a, b) => a - b);
  }
  const spanOf = (rep, e) => [e.nodeA * (rep.debug.Z || 1), e.endA * (rep.debug.Z || 1)];
  const found = (rep, title) => eventsIn(rep).find((e) => e.title === title);

  // ------------------------------------------------------------ on the track

  test('a long solo event is drawn ON the line, and leaves no second copy of it', () => {
    // This assertion has been turned round twice, and both earlier answers
    // were the bug. First a long block was a LOOP: the line detoured into
    // it and an express ran straight on at the baseline, so a person at
    // school had a second copy of themselves at their desk. Then it was a
    // kink that took the whole line with it, which moved the one thing on
    // the board that must not move.
    //
    // What survives both is the claim underneath: there is never more than
    // one of this person. Now it is the LINE that is drawn, with the event
    // on it, so there is nothing to draw twice. At any minute inside a long
    // event its owner has exactly one rail, and the event has no lane and
    // no direction of its own, because a long solo event claims no rung on
    // the ladder outward and forks no branch.
    //
    // And where its owner shares nothing all day, that one rail is on its
    // own lane for the whole event: only a shared event moves a trunk
    // (rule 8), and a long solo event is not one.
    for (const f of fixtures) {
      assert(f.metro.sidings === undefined,
        f.name + ' still carries a `sidings` array: a long block is an ordinary event now');
      const longs = longSolos(f);
      if (!longs.length) continue;
      for (const v of BOTH) {
        const rep = layout(f, v);
        for (const item of longs) {
          const e = found(rep, item.title);
          assert(e, f.name + '/' + v.name + ': "' + item.title + '" was not laid out at all');
          assert(e.status === 'ok', f.name + '/' + v.name + ': "' + item.title + '" was dropped');
          assert(e.lane == null && e.dir == null, f.name + '/' + v.name + ': "' + item.title
            + '" took lane ' + e.lane + ' going ' + e.dir + ': a long solo event is drawn on the '
            + 'track, so it claims no rung outward and forks no branch');
          // does this line converge with anybody, anywhere on this board?
          const converges = f.metro.items.some((i) => isEvent(i) && (i.co_owners || []).length
            && (i.owner === item.owner || (i.co_owners || []).indexOf(item.owner) >= 0));
          const home = homeC(f, rep, item.owner);
          const [a0, a1] = spanOf(rep, e);
          let inked = 0;
          for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
            const a = a0 + (a1 - a0) * frac;
            const at = heightsAt(rep, item.owner, a);
            if (!at.length) continue;              // a dive-under gap, not a missing line
            inked++;
            const spread = at[at.length - 1] - at[0];
            assert(spread <= 3, f.name + '/' + v.name + ': ' + item.owner + ' is drawn at '
              + at.length + ' heights ' + Math.round(spread) + 'px apart inside "' + item.title
              + '": the line is drawn twice over its own event');
            if (converges) continue;
            const off = Math.abs(courseC(rep, item.owner, a) - home);
            assert(off <= 4, f.name + '/' + v.name + ': ' + item.owner + ' is ' + Math.round(off)
              + 'px off its own lane inside "' + item.title + '", and shares nothing all day: '
              + 'a long solo event is drawn on the line, it does not move it');
          }
          assert(inked >= 3, f.name + '/' + v.name + ': ' + item.owner
            + ' has almost no line left inside "' + item.title + '"');
        }
      }
    }
  });

  test('a long solo event runs its own span and nothing more', () => {
    // The old drawing displaced the line for the length of the block, so
    // this asked that the displacement stop at the block's own minutes and
    // the line be alone again outside them. Nothing is displaced now, and
    // what is left to say is that a long event is placed on the axis by the
    // clock like anything else, because it IS anything else: an ordinary
    // item in `items` that happens to be long. So wherever another event
    // starts or ends on the same minute, the two land on the same axis
    // position, to the pixel.
    //
    // A long block used to travel in an array of its own, with its own
    // start and end, and that is exactly how it came to be drawn across
    // more of the day than it covered.
    let checked = 0;
    for (const f of fixtures) {
      const longs = longSolos(f);
      if (!longs.length) continue;
      const others = f.metro.items.filter(isEvent);
      for (const v of BOTH) {
        const rep = layout(f, v);
        for (const item of longs) {
          const e = found(rep, item.title);
          for (const o of others) {
            // An all-day event is only ever compared with another all-day
            // one: it carries the minutes of the whole window rather than
            // a clock reading somebody typed, so sharing a minute with a
            // timed event is a coincidence of the window, not an agreement.
            if (o === item || !o.all_day !== !item.all_day) continue;
            const p = found(rep, o.title);
            if (!p) continue;
            if (o.start_min === item.start_min) {
              checked++;
              assert(Math.abs(p.nodeA - e.nodeA) <= 1, f.name + '/' + v.name + ': "' + item.title
                + '" starts at ' + Math.round(e.nodeA) + ' but "' + o.title
                + '", on the same minute, starts at ' + Math.round(p.nodeA));
            }
            if (o.end_min === item.end_min) {
              checked++;
              assert(Math.abs(p.endA - e.endA) <= 1, f.name + '/' + v.name + ': "' + item.title
                + '" ends at ' + Math.round(e.endA) + ' but "' + o.title
                + '", on the same minute, ends at ' + Math.round(p.endA));
            }
          }
        }
      }
    }
    // the fixtures have to keep offering the coincidence, or this passes by
    // never asking anything
    assert(checked >= 12, 'only ' + checked + ' long events share a minute with another event: '
      + 'the fixtures no longer pin the axis down');
  });

  // ------------------------------------------------------------ shared

  test('a long event two people share bends their lines into one corridor', () => {
    // A long event is only special while one person is at it. Two children
    // at the same school all day are TOGETHER, and together is a
    // convergence: the lines lean in, run alongside each other for the
    // length of it, and part again. Drawn as two sidings that happened to
    // share a name they kinked away from each other, which said the
    // opposite of what the calendar said.
    for (const item of longShared(shared)) {
      const owners = [item.owner].concat(item.co_owners || []);
      assert(owners.length === 2, 'this case is written for a pair');
      for (const v of BOTH) {
        const rep = layout(shared, v);
        const e = found(rep, item.title);
        const [a0, a1] = spanOf(rep, e);
        const gapAt = (a) => Math.abs(courseC(rep, owners[0], a) - courseC(rep, owners[1], a));
        const inside = gapAt((a0 + a1) / 2);
        const outside = gapAt(6);
        assert(inside < outside - 8, v.name + ': the two lines should close on each other inside "'
          + item.title + '", which they both attend: ' + Math.round(inside) + 'px inside vs '
          + Math.round(outside) + 'px at the start of the day');
        // and neither of them gets an express: there is nothing left
        // running straight, because both of them really are somewhere else
        for (const o of owners) {
          const at = heightsAt(rep, o, (a0 + a1) / 2);
          assert(at.length && at[at.length - 1] - at[0] <= 3,
            v.name + ': ' + o + ' is drawn at ' + at.length + ' heights inside the corridor it shares');
        }
      }
    }
  });

  // ------------------------------------------------------------ captions

  test('a long event\'s caption sits beside the line, not on it', () => {
    // The caption used to go in the space the kink vacated. There is no
    // kink now: a long event claims one rung on its track's INWARD side and
    // the gap between that track and the next widens to hold the words, so
    // the caption has a place of its own that belongs to it. It is still
    // one event, so it gets one caption, and the line it names must not be
    // drawn through it.
    for (const item of longSolos(solo)) {
      for (const v of BOTH) {
        const rep = layout(solo, v);
        const caps = textLabels(rep).filter((l) => l.text.indexOf(item.title) >= 0);
        assert(caps.length === 1, v.name + ': expected one caption for "' + item.title
          + '", found ' + caps.length);
        const bad = [];
        for (const p of pathsWhere(rep, 'track')) {
          const d = deepestIntrusion(p.pts, caps[0]);
          if (d > 4) bad.push(p.owner + ' by ' + Math.round(d) + 'px');
        }
        assert(bad.length === 0, v.name + ': "' + item.title
          + '" has a line through it: ' + bad.join(', '));
      }
    }
  });

  // A long event's caption is not part of the lane bookkeeping in the way a
  // branch's is: it sits in a rung reserved on the inward side, where
  // nothing else on the board is looking for room, and it does not know
  // about the other captions either.
  //
  // On a packed board two of them want the same strip of canvas. One
  // beside its own line sits just off it; a corridor caption sits just
  // outside the outermost line it joins; where the long event's line IS
  // that outermost line, those are the same place. Drawn one line at a
  // time, "Lab Rotation" was written across "Delivery Run".
  //
  // 2px, the same tolerance the general label test uses: text carries a
  // paper outline, so a hairline of contact is invisible and a chunk hides
  // a word.
  const CAP_TOL = 2;
  for (const f of fixtures) {
    const longs = longSolos(f).concat(longShared(f));
    if (!longs.length) continue;
    for (const v of BOTH) {
      test('a long event\'s caption lands on nothing else: ' + f.name + '/' + v.name, () => {
        const rep = layout(f, v);
        const others = textLabels(rep);
        const bad = [];
        for (const item of longs) {
          for (const c of others.filter((l) => l.text.indexOf(item.title) >= 0)) {
            for (const o of others) {
              if (o === c) continue;
              const ov = overlap(c, o);
              if (ov && ov.w > CAP_TOL && ov.h > CAP_TOL) {
                bad.push('"' + c.text + '" x "' + o.text + '" (' + Math.round(ov.w)
                  + 'x' + Math.round(ov.h) + 'px)');
              }
            }
          }
        }
        assert(bad.length === 0, bad.length + ' caption collision(s): ' + bad.slice(0, 6).join('; '));
      });
    }
  }
};
