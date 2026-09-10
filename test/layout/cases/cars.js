'use strict';

// One car per line, at the current time, in that line's colour. The map
// shows a whole day laid out flat; the car is the only mark that says which
// part of it you are in — so if it drifts off its own rail, or wears the
// wrong colour, it is pointing at the wrong person's day.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, textLabels, overlap, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');
  const busy = fixtures.find((f) => f.name === 'busy-day');

  function cars(rep) { return rep.circles.filter((c) => c.role === 'car'); }

  test('there is exactly one car per line', () => {
    const rep = layout(busy, ROOMY);
    const list = cars(rep);
    const owners = list.map((c) => c.owner).sort();
    const lines = rep.debug.bands.map((b) => b[0]).sort();
    assert(owners.length === lines.length,
      'expected a car for each of ' + lines.length + ' lines, found ' + owners.length);
    assert(owners.join(',') === lines.join(','),
      'cars belong to ' + owners.join(',') + ' but the lines are ' + lines.join(','));
  });

  test('each car sits on a rail belonging to its own line', () => {
    const rep = layout(busy, ROOMY);
    const adrift = [];
    for (const car of cars(rep)) {
      // The car straddles the line, so its centre is what has to sit on
      // the rail.
      const cx = car.x + car.w / 2, cy = car.y + car.h / 2;
      // its own track, or one of its own branches — never someone else's
      const mine = pathsWhere(rep, 'track').concat(pathsWhere(rep, 'branch'), pathsWhere(rep, 'fork'))
        .filter((p) => p.owner === car.owner);
      let best = Infinity;
      for (const p of mine) for (const pt of p.pts) {
        const d = Math.hypot(pt[0] - cx, pt[1] - cy);
        if (d < best) best = d;
      }
      if (best > 8) adrift.push(car.owner + ' off by ' + best.toFixed(1) + 'px');
    }
    assert(adrift.length === 0, adrift.length + ' car(s) off their own rail: ' + adrift.join('; '));
  });

  test('a car wears its own line colour', () => {
    // Compared against the line's own DRAWN stroke, not against the hue
    // token it was assigned: a colour can be a CSS variable now (black and
    // white resolve through the theme), so the token is not a colour and
    // only the rendered value can be checked against the rendered value.
    // The car is paper-filled with a heavy outline, like every other mark
    // on this map, so it is the OUTLINE that has to match: a solid block
    // read as a hole in the line rather than as something standing on it.
    const rep = layout(busy, ROOMY);
    const strokeOf = {};
    for (const t of pathsWhere(rep, 'track')) strokeOf[t.owner] = t.stroke;
    for (const car of cars(rep)) {
      assert(car.stroke, 'car for ' + car.owner + ' has no outline');
      assert(strokeOf[car.owner], 'car for a line with no track drawn: ' + car.owner);
      assert(car.stroke === strokeOf[car.owner],
        'car for ' + car.owner + ' is outlined ' + car.stroke + ', its line is ' + strokeOf[car.owner]);
      assert(car.fill && car.fill !== car.stroke,
        'car for ' + car.owner + ' is filled with its own outline colour, so it is a solid block again');
    }
  });

  // Five trains stacked in a column all mark the same minute, so position
  // cannot tell them apart. The letter can.
  test('a car carries its own line\'s initial', () => {
    const rep = layout(busy, ROOMY);
    const nameOf = {};
    for (const t of busy.metro.legend) nameOf[t.key] = t.name;
    for (const car of cars(rep)) {
      const want = (nameOf[car.owner] || '?')[0].toUpperCase();
      assert(car.text === want, 'the car on ' + nameOf[car.owner] + ' says "' + car.text
        + '", not "' + want + '"');
    }
  });

  test('a car rides the spur of whatever that person is doing right now', () => {
    const rep = layout(busy, ROOMY);
    const nowMin = busy.metro.now_min;
    // who is mid-event at now_min
    const busyNow = busy.metro.items.filter((i) => i.type === 'event'
      && i.start_min <= nowMin && i.end_min >= nowMin).map((i) => i.owner);
    assert(busyNow.length > 0, 'fixture has nobody mid-event at now_min — nothing to test');
    for (const owner of busyNow) {
      const car = cars(rep).filter((c) => c.owner === owner)[0];
      assert(car, 'no car for ' + owner);
      const cy = car.y + car.h / 2;
      const track = pathsWhere(rep, 'track').filter((p) => p.owner === owner)[0];
      assert(track, 'no track for ' + owner);
      const trackY = track.pts.map((p) => p[1]);
      const flat = trackY.reduce((a, b) => a + b, 0) / trackY.length;
      assert(Math.abs(cy - flat) > 3,
        owner + ' is mid-event but the car is still sitting on the trunk');
    }
  });

  // The car is the only thing on the board that moves, and before the day's
  // first event every line's car is parked at the head of its line — which
  // is where that line's NAME is, and right beside the hour river. Five cars
  // on five names, and the one nearest the spine wading into the water.
  const EARLY = JSON.parse(JSON.stringify(busy.metro));
  EARLY.now_min = EARLY.day_start_min + 5;

  test('no car sits on a line name', () => {
    const rep = layout({ name: 'busy-early', metro: EARLY }, ROOMY);
    const names = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-terminus ') >= 0);
    const bad = [];
    for (const car of cars(rep)) {
      for (const n of names) {
        if (overlap(car, n)) bad.push('a car covers "' + n.text + '"');
      }
    }
    assert(bad.length === 0, bad.length + ' car(s) over a line name: ' + [...new Set(bad)].join('; '));
  });

  test('no car sits on an event label', () => {
    for (const metro of [busy.metro, EARLY]) {
      const rep = layout({ name: 'busy-' + metro.now_min, metro: metro }, ROOMY);
      const bad = [];
      for (const car of cars(rep)) {
        for (const l of textLabels(rep)) {
          if ((' ' + l.cls + ' ').indexOf(' metro-terminus ') >= 0) continue;
          const o = overlap(car, l);
          // a glancing corner is the label's own padding; a real overlap
          // hides the train or the words
          if (o && o.w > 4 && o.h > 4) bad.push('a car covers "' + l.text.slice(0, 24) + '"');
        }
      }
      assert(bad.length === 0, bad.length + ' car(s) over a label: ' + [...new Set(bad)].join('; '));
    }
  });

  // Every car marks the SAME moment: they are five readings of one clock.
  // A per-line nudge (each car pushed clear of its own line's name, which
  // is a different width on every line) drew five trains at five different
  // times, on a board where the whole point of the car is where it is.
  test('every car marks the same moment', () => {
    for (const v of [ROOMY, byName('x-portrait'), byName('og-half')]) {
      const rep = layout(busy, v);
      const axis = (c) => (rep.debug.horizontal ? c.x + c.w / 2 : c.y + c.h / 2);
      const at = cars(rep).map(axis);
      const spread = Math.max.apply(null, at) - Math.min.apply(null, at);
      assert(spread <= 4, 'cars on ' + v.name + ' span ' + Math.round(spread)
        + 'px of the axis but all say "now"');
    }
  });

  test('no car wades into the hour river', () => {
    // The river is drawn wider than a plain band for looks. It may not be
    // drawn wider than the gutter reserved for it, or its banks land inside
    // the band of the track nearest the spine.
    for (const metro of [busy.metro, EARLY]) {
      const rep = layout({ name: 'busy-' + metro.now_min, metro: metro }, ROOMY);
      const river = (rep.paths || []).filter((p) => p.role === 'river');
      if (!river.length) continue;
      let lo = Infinity, hi = -Infinity;
      for (const p of river) for (const q of p.pts) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); }
      const bad = cars(rep).filter((c) => c.y + c.h > lo + 2 && c.y < hi - 2);
      assert(bad.length === 0,
        bad.length + ' car(s) inside the river band (' + Math.round(lo) + '-' + Math.round(hi) + ')');
    }
  });
};
