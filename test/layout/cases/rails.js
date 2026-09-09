'use strict';

// A spur's job is to say when. Its length used to be set by how wide the
// label was, so it drew a line through time the event does not occupy — and
// then the label, being the longest thing, decided how long the event
// looked. The rail now runs from the event's start to its end, the ticks
// mark both, and the label is free to overhang.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, eventsIn, assert } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');

  // axis px per minute in the BUSY stretch — the quiet ends run compressed,
  // so the whole-day average would understate the scale events are drawn at
  function scale(rep) {
    const [from, to] = rep.debug.busy || rep.debug.win;
    return rep.canvas.w / (to - from);
  }

  test('a rail is as long as its event, not as long as its label', () => {
    const f = fixtures.find((x) => x.name === 'busy-day');
    const rep = layout(f, ROOMY);
    const pxPerMin = scale(rep);
    const byTitle = {};
    f.metro.items.filter((i) => i.type === 'event').forEach((e) => { byTitle[e.title] = e; });

    // the flat run of each branch, in axis px
    const flats = pathsWhere(rep, 'branch').map((p) => {
      const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
      return { len: Math.max.apply(null, xs) - Math.min.apply(null, xs),
               flat: Math.max.apply(null, ys) - Math.min.apply(null, ys) < 2 };
    }).filter((r) => r.flat && r.len > 1);

    assert(flats.length > 0, 'no flat spur runs found at all');

    // The longest event in the fixture is 90 minutes; nothing should draw a
    // flat rail dramatically longer than the longest event, which is what a
    // label-length rail did.
    const longestMin = Math.max.apply(null, f.metro.items
      .filter((i) => i.type === 'event').map((e) => e.end_min - e.start_min));
    const budget = (longestMin + 30) * pxPerMin;
    const over = flats.filter((r) => r.len > budget);
    assert(over.length === 0,
      over.length + ' rail(s) longer than the longest event (' + longestMin
      + 'min): ' + over.map((r) => Math.round(r.len) + 'px').join(', ')
      + ' vs a budget of ' + Math.round(budget) + 'px');
  });

  test('every event is marked at its start, and its end is either ticked or rejoined', () => {
    const f = fixtures.find((x) => x.name === 'busy-day');
    const rep = layout(f, ROOMY);
    const placed = eventsIn(rep).filter((e) => e.status === 'ok');
    // interchanges are marked with rings on each line they join, not ticks
    const interchange = new Set(f.metro.items
      .filter((i) => i.type === 'event' && (i.co_owners || []).length).map((i) => i.title));
    const solo = placed.filter((e) => !interchange.has(e.title));
    const ticks = rep.circles.filter((c) => c.role === 'stop');

    assert(solo.length > 0, 'fixture has no single-track events');
    // at least a start tick each
    assert(ticks.length >= solo.length,
      'expected a start tick for each of the ' + solo.length + ' single-track events, found '
      + ticks.length + ' tick(s)');
    // and some events must carry a second tick for the end — an event whose
    // rail rejoins the line has its end marked by the rejoin instead, so not
    // all of them do, but if NONE do the end is never being marked at all
    assert(ticks.length > solo.length,
      'no event carries an end tick: every end is unmarked (' + ticks.length
      + ' ticks for ' + solo.length + ' events)');
  });
};
