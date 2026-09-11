'use strict';

// MARKS: short events drawn ON the line as a dot and an end tick, with the
// name set against the line rather than hung off a rung.
//
// The whole point of the shape is that it is cheap. A branch costs its track
// a lane, and a lane costs that track's band a ring's clearance plus a lane
// step plus a label's thickness; a mark costs the gap beside the line and
// nothing else. Get that wrong in either direction and the board is ruined
// in a way that is hard to read back from a picture:
//
//   - charge a mark a RUNG and every track books one, the ladder wants half
//     again as much board as the board has, and the solver packs. The marks
//     are still drawn, so the picture looks like the shape is working while
//     the text steps down a tier at a time trying to make it fit.
//   - charge a mark NOTHING and the tracks ask for no depth at all, the
//     bundle is drawn at minimum pitch, and the caption pass goes looking
//     for paper beside a line that has none. Every name ends up rows away
//     from the line it belongs to.
//
// Both of those shipped. These cases are the arithmetic that says so in
// milliseconds instead of a browser round trip per question.

module.exports = function (test, h) {
  const { solve, board, buildSide, consts, assert, laneCount } = h;

  test('a mark costs its track a caption gap, not a rung', () => {
    const k = consts({ S: 2 });
    const bare = buildSide(k, [{ key: 'a' }], () => 0, k.laneStep, 0, {});
    const mark = buildSide(k, [{ key: 'a', marks: 1 }], () => 0, k.laneStep, 0, {});
    const rung = buildSide(k, [{ key: 'a', needIn: 1 }], () => 0, k.laneStep, 0, {});
    assert(mark.extent > bare.extent,
      'a mark asked for no room at all, so its name has nowhere to sit beside the line');
    assert(mark.extent < rung.extent,
      'a mark was charged a whole rung: ' + mark.extent + ' against ' + rung.extent);
  });

  test('however many marks a track carries, it pays for the gap once', () => {
    // The caption pass slides names along the line past each other; what it
    // cannot do is find board that was never reserved.
    const k = consts({ S: 2 });
    const one = buildSide(k, [{ key: 'a', marks: 1 }], () => 0, k.laneStep, 0, {});
    const many = buildSide(k, [{ key: 'a', marks: 6 }], () => 0, k.laneStep, 0, {});
    assert(Math.abs(one.extent - many.extent) < 0.001,
      'six marks cost six times one: ' + many.extent + ' against ' + one.extent);
  });

  test('a board of marks bands where the same board of shelves packs', () => {
    // This is the regression. Six tracks, one short event each. Drawn as
    // branches they need a lane apiece and the board cannot hold them;
    // drawn as marks they need the gap beside each line and it can.
    // Deeper than it was. Every caption now keeps twelve pixels of paper
    // from every rail, so a mark's gap costs a third more than it did and a
    // board that only just fitted does not any more. The claim is not about
    // one depth, it is that the mark board fits where the shelf board does
    // not -- so the depth moves and the claim stays.
    const shelves = board(['a:1', 'b:1', 'c:1'], ['d:1', 'e:1', 'f:1'],
      { depth: 820, S: 2, maxLabelThick: 36 });
    const marks = board(['a:0|mark', 'b:0|mark', 'c:0|mark'],
      ['d:0|mark', 'e:0|mark', 'f:0|mark'],
      { depth: 820, S: 2, maxLabelThick: 36 });
    assert(solve(shelves).packed, 'the shelf board was supposed to be the one that does not fit');
    assert(!solve(marks).packed, 'the same board drawn as marks still packed');
  });

  test('marks leave the lanes for the tracks that still want them', () => {
    // A board where most events are marks and one track still has real
    // branches: that track should get its lanes, because the marks are no
    // longer bidding against it.
    const b = board(['busy:3', 'a:0|mark', 'b:0|mark'], ['c:0|mark', 'd:0|mark'],
      { depth: 820, S: 2, maxLabelThick: 36 });
    const out = solve(b);
    assert(!out.packed, 'banding failed on a board with one busy track and four of marks');
    assert(out.alloc.busy === 3, 'the busy track was trimmed to ' + out.alloc.busy
      + ' on a board whose other tracks asked for nothing');
  });

  test('a nine hour booking and a fifteen minute sync are the same shape', () => {
    // There is no "long event" any more. An event on the line is an event
    // on the line: the same dot, the same tick, the same span between them,
    // the same name against the rail, and so the same one gap asked of the
    // board. Two names for one shape is two places for the same rule to be
    // got wrong, which is how a track came to be charged for both.
    const k = consts({ S: 2 });
    const one = buildSide(k, [{ key: 'a', marks: 1 }], () => 0, k.laneStep, 0, {});
    const mixed = buildSide(k, [{ key: 'a', marks: 4 }], () => 0, k.laneStep, 0, {});
    assert(Math.abs(one.extent - mixed.extent) < 0.001,
      'a track carrying events of different lengths was charged more than once: '
      + mixed.extent + ' against ' + one.extent);
  });

  test('the gap a mark books is wide enough for the name that goes in it', () => {
    // Whatever else changes, this is the claim the shape rests on: the room
    // reserved beside the line has to hold a label of the thickest size on
    // the board, or the caption pass steps outward and the name comes loose.
    for (const thick of [17, 32, 36, 42, 58, 106]) {
      const k = consts({ S: 2, maxLabelThick: thick });
      const mark = buildSide(k, [{ key: 'a', marks: 1 }], () => 0, k.laneStep, 0, {});
      // the track's own distance off the middle IS the gap it booked
      assert(mark.dist.a >= thick + k.lineGap,
        'at thickness ' + thick + ' a mark booked only '
        + Math.round(mark.dist.a) + 'px of gap');
    }
  });

  test('marks never cost a board more than the same board of shelves', () => {
    // A cheaper shape that costs more somewhere is the bug this file exists
    // for, so it is asked across the whole spread rather than at one size.
    //
    // Measured at a FIXED pitch, not from a solved board's `need`: a board
    // that fits grows to fill whatever it was given, so two boards that
    // both fit report the same need whatever they actually required.
    for (const thick of [17, 36, 58, 106]) {
      const k = consts({ S: 2, maxLabelThick: thick });
      const tracks = ['a', 'b', 'c', 'd'];
      const shelf = buildSide(k, tracks.map((key) => ({ key: key })),
        () => 1, k.laneStep, 0, {});
      const mark = buildSide(k, tracks.map((key) => ({ key: key, marks: 1 })),
        () => 0, k.laneStep, 0, {});
      assert(mark.extent <= shelf.extent + 0.001,
        'at thickness ' + thick + ' four mark tracks took ' + Math.round(mark.extent)
        + ' against four shelf tracks\' ' + Math.round(shelf.extent));
    }
  });
};
