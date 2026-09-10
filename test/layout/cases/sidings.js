'use strict';

// A station is a stretch of the day someone spends in one place. Drawn as a
// kink it displaced that person's whole line for the length of it: nine
// hours of "Desk booking" bent Ward's day off its own baseline, and the
// baseline is the one thing on the map that should never move.
//
// So a SOLO station is a siding: the main line carries straight on at its
// own height and the station is the loop that leaves it and comes back —
// the express/local pair a transit map draws. A station two people share is
// a different thing: there the bend is the point, because it puts their two
// lines alongside each other for the length of what they are both at.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, textLabels, deepestIntrusion, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');
  const solo = fixtures.find((f) => f.name === 'waypoint-station');   // "Desk booking", work only
  const shared = fixtures.find((f) => f.name === 'shared-station');   // "School Day", sam + kids

  // every cross-axis position a line is drawn at, at one axis position
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

  test('a solo station leaves the main line running straight through', () => {
    const rep = layout(solo, ROOMY);
    const st = solo.metro.stations.find((s) => !s.group);
    const owner = st.owner;
    const w = rep.canvas.w;
    // the line's own height well outside the station, at both ends of the day
    const outside = heightsAt(rep, owner, w - 20);
    assert(outside.length >= 1, 'no track drawn for ' + owner);
    const baseline = outside[0];
    // and inside it: the express line still at that height, plus a siding
    const inside = heightsAt(rep, owner, w * 0.5);
    assert(inside.length >= 2,
      'expected an express line and a siding inside the station, found ' + inside.length + ' line(s)');
    const straight = inside.filter((y) => Math.abs(y - baseline) <= 3);
    assert(straight.length >= 1, 'the main line is ' + Math.round(Math.min.apply(null,
      inside.map((y) => Math.abs(y - baseline)))) + 'px off its own baseline inside the station');
    const siding = inside.filter((y) => Math.abs(y - baseline) > 3);
    assert(siding.length >= 1, 'no siding drawn for the station');
  });

  test('the siding runs the station and nothing more', () => {
    const rep = layout(solo, ROOMY);
    const st = solo.metro.stations.find((s) => !s.group);
    const w = rep.canvas.w;
    const baseline = heightsAt(rep, st.owner, w - 20)[0];
    assert(baseline != null, 'no track drawn for ' + st.owner);
    // outside the station's own span the line is alone again
    for (const x of [20, w - 20]) {
      const at = heightsAt(rep, st.owner, x);
      assert(at.length >= 1, 'no track drawn at x=' + x);
      const off = at.filter((y) => Math.abs(y - baseline) > 3);
      assert(off.length === 0, 'a siding is still drawn at x=' + x + ', outside the station');
    }
  });

  test('a shared station still bends its lines into one corridor', () => {
    // the bend earns its place when it puts two people alongside each other
    const rep = layout(shared, ROOMY);
    const owners = [...new Set(shared.metro.stations.map((s) => s.owner))];
    const w = rep.canvas.w;
    const gapAt = (x) => {
      const ys = owners.map((o) => heightsAt(rep, o, x)[0]);
      return Math.abs(ys[0] - ys[1]);
    };
    assert(gapAt(w * 0.5) < gapAt(8) - 8,
      'the two lines should close on each other inside the station they share');
    // and they do NOT get an express line: there is nothing left running
    // straight, because both of them really are somewhere else
    for (const o of owners) {
      assert(heightsAt(rep, o, w * 0.5).length === 1,
        'a shared station drew a siding as well as the corridor');
    }
  });

  test('a station caption sits in the loop, not on the line', () => {
    for (const v of [ROOMY, byName('og-landscape')]) {
      const rep = layout(solo, v);
      const caps = textLabels(rep).filter((l) => /Desk booking/.test(l.text));
      assert(caps.length === 1, 'expected one station caption, found ' + caps.length);
      const lines = pathsWhere(rep, 'track');
      const bad = [];
      for (const p of lines) {
        const d = deepestIntrusion(p.pts, caps[0]);
        if (d > 4) bad.push(p.owner + ' by ' + Math.round(d) + 'px');
      }
      assert(bad.length === 0, v.name + ': the caption has a line through it: ' + bad.join(', '));
    }
  });
};
