'use strict';

// How many lines a shared event has to cross to reach the lines it joins.
//
// A crossing is not a drawing fault, it is an ORDERING one: a shared event
// crosses a line when that line sits between two of its participants and is
// not one of them. Which lines sit where is chosen once, for the whole day,
// from affinities summed over the whole day (`affinityChain` in
// transform.js), and there are days no single order can draw.
//
// This is the measuring stick for the weave. It asserts the count on a board
// built to be unsatisfiable, so that when a line can change level the
// number moves and this test says so.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, assert, assertEqual } = h;

  // Both counters live in ../score.js, because the board's own score has to
  // count a crossing the same way this case does: one definition, used by
  // the thing that asserts and by the thing that measures.
  const { forcedCrossings, forcedCrossingsWeaveAware } = require('../score');

  // where an event was drawn along the axis, by name
  function eventAxis(rep, title) {
    const row = (rep.debug.events || []).find((e) => e[0] === title);
    return row ? row[5] : null;
  }

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);

  test('the day no single order can draw is drawn by swapping two lines once', () => {
    // Alex and Sam exchange places at teatime, so the morning's
    // pairings and the evening's are both adjacent, and the price is the
    // one crossing they make passing through each other.
    const f = fixtures.find((x) => x.name === 'regroups');
    const rep = layout(f, byName('x-landscape'));
    const w = rep.debug.weave || [];
    assertEqual(w.length, 2, 'a swap is two lines exchanging places, so both carry it: ' + JSON.stringify(w));
    assertEqual(w.map((x) => x.key).sort(), ['hom', 'mar'], 'the pair that had to move');
    // and they really do exchange, rather than both drifting somewhere
    assertEqual(w[0].from, w[1].to, 'the first ends where the second started');
    assertEqual(w[1].from, w[0].to, 'and the other way about');
  });

  test('and then nothing else on that day crosses anything', () => {
    // The whole point. Four crossings before, none now, at the cost of the
    // one the two lines make between them.
    const f = fixtures.find((x) => x.name === 'regroups');
    const bad = forcedCrossingsWeaveAware(f, layout(f, byName('x-landscape')));
    assertEqual(bad, [], 'still crossing: ' + bad.join('; '));
  });

  test('a day that no single order can draw costs four crossings without the swap', () => {
    // Marge takes Bart to school and Homer drops Lisa at band practice;
    // after school they swap. The four pairings form a cycle, and a cycle
    // cannot be laid along a line without breaking one of its links.
    //
    // So the morning is clean and every evening event crosses the parent it
    // is not with. FOUR is the price of deciding the order once, and it is
    // the number the weave is worth measuring against: the test above reads
    // the same board weave-aware and finds none, at the cost of the single
    // crossing the two lines make passing through each other.
    const f = fixtures.find((x) => x.name === 'regroups');
    assert(f, 'the regroups fixture is gone; it is the only board here that is unsatisfiable');
    // forcedCrossings reads the bands, which is where each line STARTS the
    // day: it is the count the board would pay if nothing could move, and
    // it is what makes the swap worth its own crossing.
    const bad = forcedCrossings(f, layout(f, byName('x-landscape')));
    assertEqual(bad.length, 4, 'crossings the fixed order would force: ' + bad.join('; '));
    // and all four are in the evening: the morning's pairings are the ones
    // the chosen order does satisfy
    assert(bad.every((s) => /Jazz Club|Skate Park|Homework|Bedtime/.test(s)),
      'a morning event is crossing something, so the order is not the one described: ' + bad.join('; '));
  });

  test('the boards that can be drawn in one order are', () => {
    // The counterpart, and the reason four is a fact about the DAY rather
    // than about the layout: every other board here has an order that
    // satisfies every shared event on it, and the chain finds it.
    for (const name of ['five-lines', 'crew-day', 'shared-long-event']) {
      const f = fixtures.find((x) => x.name === name);
      if (!f) continue;
      const bad = forcedCrossings(f, layout(f, byName('x-landscape')));
      assertEqual(bad.length, 0, name + ': ' + bad.join('; '));
    }
  });
};
