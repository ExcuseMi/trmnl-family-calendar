'use strict';

// A18: one pair of neighbours exchanging places partway through the day.
//
// A crossing is an ORDERING fault: a shared event crosses a line when that
// line sits between two of its participants and is not one of them. The
// order is picked once for the whole day, and there are days no single
// order can draw. The canonical one is two parents who swap which child
// they have after school: the pairings form a cycle, and a cycle cannot be
// laid along a line without breaking one of its links.
//
// What is deliberately NOT here is a free reordering. What a transit map
// is for is tracing a line with a finger, so this offers exactly one swap,
// and only when it is strictly cheaper than standing still.

module.exports = function (test, h) {
  const { CrossSolver, assert, assertEqual } = h;

  // Marge takes Bart and Homer takes Lisa in the morning; after school
  // they swap, and Marge has Lisa while Homer has Bart, twice each.
  const REGROUP = {
    sides: { A: [{ key: 'mar' }, { key: 'bar' }], B: [{ key: 'hom' }, { key: 'lis' }] },
    dist: { mar: 10, bar: 122, hom: 10, lis: 319 },
    events: [
      { atMin: 480, members: ['mar', 'bar'] },
      { atMin: 500, members: ['hom', 'lis'] },
      { atMin: 1020, members: ['mar', 'lis'] },
      { atMin: 1050, members: ['hom', 'bar'] },
      { atMin: 1110, members: ['mar', 'lis'] },
      { atMin: 1140, members: ['hom', 'bar'] },
    ],
  };
  const weave = (over) => CrossSolver.weave(Object.assign({}, REGROUP, over || {}));

  test('the day no single order can draw is drawn by swapping once', () => {
    const w = weave();
    assert(w, 'no swap found on a board where standing still costs four crossings');
    assertEqual([w.a, w.b].sort(), ['hom', 'mar'], 'the pair that has to exchange places');
    assertEqual(w.stay, 4, 'what the fixed order costs');
    assertEqual(w.cost, 1, 'one crossing, made on purpose, and nothing else');
    assertEqual(w.before + w.after, 0, 'every event is adjacent on one side of the swap or the other');
  });

  test('the swap happens between two events, never inside one', () => {
    const w = weave();
    const times = REGROUP.events.map((e) => e.atMin);
    assert(times.indexOf(w.atMin) < 0, 'the swap landed on an event');
    const before = times.filter((t) => t < w.atMin).length;
    assert(before > 0 && before < times.length, 'the swap is at one end of the day, so it changes nothing');
  });

  test('a day one order can draw asks for no swap', () => {
    // Marge with Bart all day and Homer with Lisa all day: the chain already has
    // an answer, and a swap could only cost.
    const w = weave({ events: [
      { atMin: 480, members: ['mar', 'bar'] },
      { atMin: 1020, members: ['mar', 'bar'] },
      { atMin: 1080, members: ['hom', 'lis'] },
    ] });
    assertEqual(w, null);
  });

  test('a swap that only breaks even is refused', () => {
    // ONE crossed event in the evening. Swapping fixes it and costs one, so
    // the board is no better off and the reader has a line that moved for
    // nothing.
    const w = weave({ events: [
      { atMin: 480, members: ['mar', 'bar'] },
      { atMin: 1020, members: ['mar', 'lis'] },
    ] });
    assertEqual(w, null);
  });

  test('what a swap costs is an input, and raising it refuses more', () => {
    assert(weave({ swapCost: 3 }), 'saving four for three is still worth it');
    assertEqual(weave({ swapCost: 4 }), null, 'saving four for four is not');
  });

  test('only neighbours exchange places', () => {
    // Bart and Lisa are the outermost lines on either side. Swapping them
    // would mean each crossing everything in between, which is not a swap,
    // it is two lines moving house.
    const w = weave();
    const order = ['bar', 'mar', 'hom', 'lis'];
    assertEqual(Math.abs(order.indexOf(w.a) - order.indexOf(w.b)), 1);
  });

  test('nothing to fix, nothing offered', () => {
    assertEqual(weave({ events: [] }), null, 'no shared events at all');
    assertEqual(weave({ events: [{ atMin: 600, members: ['mar', 'bar'] }] }), null, 'one shared event');
  });
};
