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
      // The car stands ON the line, so what has to touch the rail is its
      // WHEELS, not its middle. Measured at the centre it now reads as half
      // a car-height adrift by design.
      const cx = car.x + car.w / 2, cy = car.y + car.h;
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
    const rep = layout(busy, ROOMY);
    const strokeOf = {};
    for (const t of pathsWhere(rep, 'track')) strokeOf[t.owner] = t.stroke;
    for (const car of cars(rep)) {
      assert(car.fill, 'car for ' + car.owner + ' has no fill');
      assert(strokeOf[car.owner], 'car for a line with no track drawn: ' + car.owner);
      assert(car.fill === strokeOf[car.owner],
        'car for ' + car.owner + ' is ' + car.fill + ', its line is ' + strokeOf[car.owner]);
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
