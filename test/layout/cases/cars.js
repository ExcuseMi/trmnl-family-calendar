'use strict';

// One car per line, at the current time, in that line's colour. The map
// shows a whole day laid out flat; the car is the only mark that says which
// part of it you are in — so if it drifts off its own rail, or wears the
// wrong colour, it is pointing at the wrong person's day.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, assert } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');
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
      const cx = car.x + car.w / 2, cy = car.y + car.h / 2;
      // its own track, or one of its own branches — never someone else's
      const mine = pathsWhere(rep, 'track').concat(pathsWhere(rep, 'branch'))
        .filter((p) => p.owner === car.owner);
      let best = Infinity;
      for (const p of mine) for (const pt of p.pts) {
        const d = Math.hypot(pt[0] - cx, pt[1] - cy);
        if (d < best) best = d;
      }
      if (best > 6) adrift.push(car.owner + ' off by ' + best.toFixed(1) + 'px');
    }
    assert(adrift.length === 0, adrift.length + ' car(s) off their own rail: ' + adrift.join('; '));
  });

  test('a car wears its own line colour', () => {
    const rep = layout(busy, ROOMY);
    const hue = {};
    (rep.debug.colors || []).forEach((c) => { const [k, v] = c.split('='); hue[k] = v; });
    for (const car of cars(rep)) {
      assert(car.fill, 'car for ' + car.owner + ' has no fill');
      const line = busy.metro.legend.filter((t) => t.key === car.owner)[0];
      assert(line, 'car for an unknown line: ' + car.owner);
      assert(car.fill === hue[line.hue],
        'car for ' + car.owner + ' is ' + car.fill + ', its line is ' + hue[line.hue]);
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
};
