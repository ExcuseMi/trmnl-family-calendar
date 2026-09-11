'use strict';

// A siding is a stretch of the day someone spends in one place. Drawn as a
// kink it displaced that person's whole line for the length of it: nine
// hours of "Desk booking" bent Ward's day off its own baseline, and the
// baseline is the one thing on the map that should never move.
//
// So a SOLO siding is a loop: the main line carries straight on at its own
// height and the siding leaves it and comes back, the express/local pair a
// transit map draws. A siding two people share is a different thing: there
// the bend is the point, because it puts their two lines alongside each
// other for the length of what they are both at.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, textLabels, deepestIntrusion, overlap, hasClass, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');
  const solo = fixtures.find((f) => f.name === 'siding-day');   // "Desk booking", work only
  const shared = fixtures.find((f) => f.name === 'shared-siding');   // "School Day", sam + kids

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

  test('a solo siding TAKES the line with it, and leaves nothing behind', () => {
    // This used to assert the opposite, and the opposite was the bug. A
    // siding was drawn as a LOOP: the line detoured into it and an express
    // ran straight through at the baseline, the way a transit map shows a
    // loop with a through service. That reads as one line while a trunk is
    // level and a siding is a local kink in it. It stopped reading the
    // moment trunks started going places -- over a seven-hour school day
    // the detour and the express run side by side for most of the board,
    // and the drawing says the track is permanently split. A person at
    // school is at school; there is no second copy of them at their desk.
    const rep = layout(solo, ROOMY);
    const st = solo.metro.sidings.find((s) => !s.group);
    const owner = st.owner;
    const w = rep.canvas.w;
    const outside = heightsAt(rep, owner, w - 20);
    assert(outside.length >= 1, 'no track drawn for ' + owner);
    const baseline = outside[0];
    const inside = heightsAt(rep, owner, w * 0.5);
    assert(inside.length >= 1, 'no line at all inside the siding');
    const straight = inside.filter((y) => Math.abs(y - baseline) <= 3);
    assert(straight.length === 0, straight.length + ' line(s) still running at the baseline '
      + 'inside the siding: the line is drawn twice over its own span');
    const siding = inside.filter((y) => Math.abs(y - baseline) > 3);
    assert(siding.length >= 1, 'no siding drawn at all');
  });

  test('the siding runs its own span and nothing more', () => {
    const rep = layout(solo, ROOMY);
    const st = solo.metro.sidings.find((s) => !s.group);
    const w = rep.canvas.w;
    const baseline = heightsAt(rep, st.owner, w - 20)[0];
    assert(baseline != null, 'no track drawn for ' + st.owner);
    // outside the siding's own span the line is alone again
    for (const x of [20, w - 20]) {
      const at = heightsAt(rep, st.owner, x);
      assert(at.length >= 1, 'no track drawn at x=' + x);
      const off = at.filter((y) => Math.abs(y - baseline) > 3);
      assert(off.length === 0, 'a siding is still drawn at x=' + x + ', outside its own span');
    }
  });

  test('a shared siding still bends its lines into one corridor', () => {
    // the bend earns its place when it puts two people alongside each other
    const rep = layout(shared, ROOMY);
    const owners = [...new Set(shared.metro.sidings.map((s) => s.owner))];
    const w = rep.canvas.w;
    const gapAt = (x) => {
      const ys = owners.map((o) => heightsAt(rep, o, x)[0]);
      return Math.abs(ys[0] - ys[1]);
    };
    assert(gapAt(w * 0.5) < gapAt(8) - 8,
      'the two lines should close on each other inside the siding they share');
    // and they do NOT get an express line: there is nothing left running
    // straight, because both of them really are somewhere else
    for (const o of owners) {
      assert(heightsAt(rep, o, w * 0.5).length === 1,
        'a shared siding drew a loop as well as the corridor');
    }
  });

  test('a siding caption sits in the loop, not on the line', () => {
    for (const v of [ROOMY, byName('og-landscape')]) {
      const rep = layout(solo, v);
      const caps = textLabels(rep).filter((l) => /Desk booking/.test(l.text));
      assert(caps.length === 1, 'expected one siding caption, found ' + caps.length);
      const lines = pathsWhere(rep, 'track');
      const bad = [];
      for (const p of lines) {
        const d = deepestIntrusion(p.pts, caps[0]);
        if (d > 4) bad.push(p.owner + ' by ' + Math.round(d) + 'px');
      }
      assert(bad.length === 0, v.name + ': the caption has a line through it: ' + bad.join(', '));
    }
  });

  // The kink's corners are drawn ROUNDED, so the trunk starts leaving its
  // baseline a corner radius BEFORE the siding's own start and does not
  // come back until a radius after its end. A siding drawn between the bare
  // start and end vertices therefore begins after the trunk has already
  // lifted off, and the two do not meet: the ink's lower edge steps at the
  // join and the main line reads as interrupted. Homer's rail visibly broke
  // where "Desk booking" began.
  //
  // Stated as the join itself: where a siding starts and stops, the trunk
  // has to still be ON the baseline, within its own stroke. That is what
  // makes the two read as one line rather than as two that nearly meet.
  test('a siding meets the trunk it runs beside, at both ends', () => {
    for (const f of [solo, fixtures.find((x) => x.name === 'five-lines')]) {
      for (const v of [ROOMY, byName('og-landscape')]) {
        const rep = layout(f, v);
        const bad = [];
        for (const owner of [...new Set(pathsWhere(rep, 'track').map((p) => p.owner))]) {
          const mine = pathsWhere(rep, 'track').filter((p) => p.owner === owner);
          if (mine.length < 2) continue;                 // no siding on this line
          const ends = heightsAt(rep, owner, 6).concat(heightsAt(rep, owner, rep.canvas.w - 6));
          if (!ends.length) continue;
          const base = ends.reduce((a, b) => a + b, 0) / ends.length;
          // the trunk is the one that runs the width of the board; a siding
          // is flat, on the baseline, and shorter
          const trunk = mine.slice().sort((a, b) => b.len - a.len)[0];
          for (const sd of mine) {
            if (sd === trunk) continue;
            const ys = sd.pts.map((q) => q[1]);
            if (Math.max.apply(null, ys) - Math.min.apply(null, ys) > 2) continue;   // not flat
            if (Math.abs(ys[0] - base) > 3) continue;                                 // not on the baseline
            const xs = sd.pts.map((q) => q[0]);
            const reach = (sd.width * (rep.debug.Z || 1)) / 2 + 1;
            for (const end of [Math.min.apply(null, xs), Math.max.apply(null, xs)]) {
              // how far the trunk is from the baseline where the siding ends
              let best = Infinity;
              for (const q of trunk.pts) {
                if (Math.abs(q[0] - end) > 2) continue;
                best = Math.min(best, Math.abs(q[1] - base));
              }
              if (best !== Infinity && best > reach) {
                bad.push(owner + ': the trunk is ' + best.toFixed(1) + 'px off the baseline where its '
                  + 'siding ends at x' + Math.round(end) + ', more than the ' + reach.toFixed(1) + 'px it is wide');
              }
            }
          }
        }
        assert(bad.length === 0, f.name + '/' + v.name + ': ' + bad.join('; '));
      }
    }
  });

  // ---------------------------------------------------------- captions

  // A siding caption is not part of the lane bookkeeping: it sits in the
  // space its own kink vacated, so nothing else on the board knows to keep
  // out of its way, and it does not know about the other captions either.
  //
  // On a packed board two of them want the same strip of canvas. A solo
  // caption too tall for its own loop sits just outside it; a corridor
  // caption sits just outside the outermost line it joins; where the solo
  // siding's line IS that outermost line, those are the same place. Drawn
  // one line at a time, "Lab Rotation" was written across "Delivery Run".
  //
  // 2px, the same tolerance the general label test uses: text carries a
  // paper outline, so a hairline of contact is invisible and a chunk hides
  // a word.
  const CAP_TOL = 2;
  for (const f of fixtures) {
    for (const vname of ['x-landscape', 'og-landscape']) {
      test('a siding caption lands on nothing else: ' + f.name + '/' + vname, () => {
        const rep = layout(f, byName(vname));
        const caps = textLabels(rep).filter((l) => hasClass(l, 'metro-caption'));
        const others = textLabels(rep);
        const bad = [];
        for (const c of caps) {
          for (const o of others) {
            if (o === c) continue;
            const ov = overlap(c, o);
            if (ov && ov.w > CAP_TOL && ov.h > CAP_TOL) {
              bad.push('"' + c.text + '" x "' + o.text + '" (' + Math.round(ov.w)
                + 'x' + Math.round(ov.h) + 'px)');
            }
          }
        }
        assert(bad.length === 0, bad.length + ' caption collision(s): ' + bad.slice(0, 6).join('; '));
      });
    }
  }
};
