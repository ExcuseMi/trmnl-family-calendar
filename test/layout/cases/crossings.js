'use strict';

// How many lines a shared event has to cross to reach the lines it joins.
//
// A crossing is not a drawing fault, it is an ORDERING one: a shared event
// crosses a line when that line sits between two of its participants and is
// not one of them. Which lines sit where is chosen once, for the whole day,
// from affinities summed over the whole day (`affinityChain` in
// transform.js), and there are days no single order can draw.
//
// This is the measuring stick for A18. It asserts the count on a board
// built to be unsatisfiable, so that when a line can change level the
// number moves and this test says so.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, assert, assertEqual } = h;

  // The lines a shared event must cross, read off the board that was
  // actually drawn. Distance is measured from the spine OUTWARD on each
  // side, so the two sides are mirror images: signed by side they lie on
  // one axis, and "between" means what it says.
  function forcedCrossings(f, rep) {
    const side = {};
    for (const t of f.metro.legend) side[t.key] = t.side === 'right' ? 1 : -1;
    const at = {};
    for (const b of rep.debug.bands) at[b[0]] = (side[b[0]] || 1) * b[3];
    const keys = Object.keys(at);
    const out = [];
    for (const it of f.metro.events) {
      if (it.type !== 'event' || !it.co_owners || !it.co_owners.length) continue;
      const mine = [it.owner].concat(it.co_owners).filter((k) => at[k] != null);
      if (mine.length < 2) continue;
      const ds = mine.map((k) => at[k]);
      const lo = Math.min.apply(null, ds), hi = Math.max.apply(null, ds);
      const crossed = keys.filter((k) => mine.indexOf(k) < 0 && at[k] > lo && at[k] < hi);
      if (crossed.length) out.push(it.title + ' crosses ' + crossed.join(', '));
    }
    return out;
  }

  // The same count, but reading where each line is AT THE MINUTE of each
  // event rather than where it started the day.
  function forcedCrossingsWeaveAware(f, rep) {
    const side = {};
    for (const t of f.metro.legend) side[t.key] = t.side === 'right' ? 1 : -1;
    const start = {};
    for (const b of rep.debug.bands) start[b[0]] = (side[b[0]] || 1) * b[3];
    const moved = {};
    for (const w of rep.debug.weave || []) moved[w.key] = w;
    const at = (key, a) => {
      const w = moved[key];
      return w ? (a >= w.atA ? w.to : w.from) : start[key];
    };
    const keys = Object.keys(start);
    const out = [];
    for (const it of f.metro.events) {
      if (it.type !== 'event' || !it.co_owners || !it.co_owners.length) continue;
      const mine = [it.owner].concat(it.co_owners).filter((k) => start[k] != null);
      if (mine.length < 2) continue;
      // the axis position of the event, to ask where everybody is then
      const a = eventAxis(rep, it.title);
      if (a == null) continue;
      const ds = mine.map((k) => at(k, a));
      const lo = Math.min.apply(null, ds), hi = Math.max.apply(null, ds);
      const crossed = keys.filter((k) => mine.indexOf(k) < 0 && at(k, a) > lo && at(k, a) < hi);
      if (crossed.length) out.push(it.title + ' crosses ' + crossed.join(', '));
    }
    return out;
  }
  // where an event was drawn along the axis, by name
  function eventAxis(rep, title) {
    const row = (rep.debug.events || []).find((e) => e[0] === title);
    return row ? row[5] : null;
  }

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);

  test('the day no single order can draw is drawn by swapping two lines once', () => {
    // A18. Alex and Sam exchange places at teatime, so the morning's
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
    // is not with. FOUR is the price of deciding the order once. A18 would
    // pay ONE instead, swapping Alex and Sam at teatime, and when it lands
    // this test should read one and say what it cost.
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
