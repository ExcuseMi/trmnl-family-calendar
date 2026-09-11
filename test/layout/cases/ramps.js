'use strict';

// THE RAMP: the shape a line makes leaving its trunk for a lane, and coming
// back. Every departure and every rejoin on the board is this one shape with
// different arguments — 45 degrees or vertical, above the spine or below,
// forward or backward, horizontal board or vertical one. It has broken in
// most of those variations at least once, so it gets its own file.
//
// The two properties that matter and are easy to get wrong:
//
//   1. A ramp is part of its line, so it is drawn in that line's stroke. It
//      used to be forced solid, because the lead-in lies ON the trunk and a
//      dashed overlay starting its pattern from zero landed out of phase —
//      you could see the branch's dashes doubled on the main line before it
//      left. Solid hid that and gave every dashed line a solid elbow.
//   2. A ramp starts ON the trunk and ends flat in its lane. Detached at
//      either end it reads as a stray diagonal.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, eventsIn, assert } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');
  const VIEWS = ['x-landscape', 'og-landscape', 'x-portrait'].map((n) => VIEWPORTS.find((v) => v.name === n));

  // the tracks a fixture declares, by key
  function tracksOf(f) {
    const by = {};
    (f.metro.legend || []).forEach((t) => { by[t.key] = t; });
    return by;
  }

  function ramps(rep) {
    return pathsWhere(rep, 'fork').concat(pathsWhere(rep, 'branch')).filter((p) => p.len > 4);
  }

  // ---- 1. style -------------------------------------------------------

  for (const f of fixtures) {
    test('a ramp is drawn in its own line\'s stroke: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      // The COURSE, not the drawn runs. A trunk is broken wherever it
      // passes under something, so its ink has gaps in it and the nearest
      // drawn point to a departure can be on the far side of one. Where the
      // line goes is a different question from what is drawn, and the
      // course is the answer to the first.
      const trunks = {};
      for (const t of pathsWhere(rep, 'course')) trunks[t.owner] = t;
      const bad = [];
      for (const r of ramps(rep)) {
        const trunk = trunks[r.owner];
        if (!trunk) continue;
        if (r.dash !== trunk.dash) {
          bad.push('"' + r.owner + '" ramp is ' + (r.dash || 'solid')
            + ' where its line is ' + (trunk.dash || 'solid'));
        }
      }
      assert(bad.length === 0, bad.length + ' ramp(s) not in their line\'s stroke: '
        + [...new Set(bad)].slice(0, 4).join('; '));
    });
  }

  test('a hatched line\'s rungs carry a phase, so a ramp\'s lead-in falls on the trunk\'s own', () => {
    // Lines are solid; what tells them apart is the paper texture knocked
    // out of them, and for two of the four treatments that texture repeats.
    // A ramp's lead-in is drawn ON TOP of the trunk, so its rungs have to
    // land on the trunk's own or the overlay doubles them visibly. This can
    // only be checked as "a phase was computed at all" — that it is right is
    // what the eye checks — but a zero phase everywhere is the symptom of
    // the logic being dropped, which is how it regressed once already.
    const rep = layout(fixtures.find((x) => x.name === 'busy-day'), ROOMY);
    const rungs = (rep.overlays || []).filter((o) => o.dash);
    assert(rungs.length > 0, 'no hatched or beaded lines on the busy day at all');
    assert(rungs.some((o) => o.dashOffset > 0),
      'none of the ' + rungs.length + ' rung patterns has a phase: a ramp\'s lead-in '
      + 'will double the trunk it lies on');
  });

  test('every line is solid — the texture is knocked out of it, not made of gaps', () => {
    // A dashed line is mostly paper, so on e-ink it reads faint however dark
    // the ink is. Every line here keeps a continuous black envelope and is
    // told apart by weight and by what is punched out of it.
    const rep = layout(fixtures.find((x) => x.name === 'busy-day'), ROOMY);
    const dashedLines = pathsWhere(rep, 'track').concat(ramps(rep)).filter((p) => p.dash);
    assert(dashedLines.length === 0,
      dashedLines.length + ' line(s) drawn as dashes rather than solid: '
      + [...new Set(dashedLines.map((p) => p.owner))].join(', '));
  });

  // ---- 2. attachment --------------------------------------------------

  // Distance from a point to the nearest place ON a path, not to its
  // nearest VERTEX. A straight run has no vertices in the middle of it --
  // `roundedPath` emits the two ends and nothing between -- so a branch
  // leaving a trunk halfway along a long flat stretch measured as a
  // hundred pixels adrift while sitting exactly on the line. The bug this
  // guards against is a branch starting in mid-air, and mid-air is off the
  // LINE, not away from a corner.
  function distToPath(pt, pts) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(a[0] + dx * t - pt[0], a[1] + dy * t - pt[1]));
    }
    if (!pts.length) return best;
    return Math.min(best, Math.hypot(pts[0][0] - pt[0], pts[0][1] - pt[1]));
  }


  for (const v of VIEWS) {
    test('every ramp starts on its own trunk: ' + v.name, () => {
      const rep = layout(fixtures.find((x) => x.name === 'busy-day'), v);
      const trunks = {};
      for (const t of pathsWhere(rep, 'course')) trunks[t.owner] = t;
      const bad = [];
      for (const r of pathsWhere(rep, 'fork')) {
        const trunk = trunks[r.owner];
        if (!trunk || !r.pts.length) continue;
        const s = r.pts[0];
        const best = distToPath(s, trunk.pts);
        // sampled every 2px along both paths, so ~3px is exact contact
        if (best > 6) bad.push('"' + r.owner + '" starts ' + best.toFixed(1) + 'px off its line');
      }
      assert(bad.length === 0, bad.length + ' ramp(s) detached from their trunk: '
        + bad.slice(0, 4).join('; '));
    });
  }

  test('every ramp ends flat, in a lane', () => {
    const rep = layout(fixtures.find((x) => x.name === 'busy-day'), ROOMY);
    const bad = [];
    for (const r of pathsWhere(rep, 'fork')) {
      if (r.pts.length < 4) continue;
      // the last few samples must be level: the ramp turns before it stops,
      // it does not just stop mid-climb
      const tail = r.pts.slice(-4);
      const rise = Math.max(...tail.map((q) => q[1])) - Math.min(...tail.map((q) => q[1]));
      const run = Math.max(...tail.map((q) => q[0])) - Math.min(...tail.map((q) => q[0]));
      if (rise > 2 && rise > run) bad.push('"' + r.owner + '" still climbing at its end');
    }
    assert(bad.length === 0, bad.length + ' ramp(s) end mid-climb: ' + bad.slice(0, 4).join('; '));
  });

  // ---- 3. the two shapes ----------------------------------------------

  test('a ramp is either 45 degrees or vertical, never a squeezed diagonal', () => {
    // Steepening a 45-degree ramp to fit a deep lane looked like a mistake,
    // and easing a vertical one out to 45 made it leave an hour before its
    // event. So there are two shapes and nothing between: either the run
    // equals the rise, or there is no run at all.
    const rep = layout(fixtures.find((x) => x.name === 'busy-day'), ROOMY);
    const bad = [];
    for (const e of eventsIn(rep)) {
      if (e.status !== 'ok') continue;
      const run = Math.abs(e.elbow - e.diagFrom);
      const rise = Math.abs(e.laneDist - e.trackDist);
      if (run < 1) continue;                       // vertical: fine
      if (Math.abs(run - rise) <= 1) continue;     // 45 degrees: fine
      bad.push('"' + e.title + '" runs ' + Math.round(run) + ' over a rise of ' + Math.round(rise));
    }
    assert(bad.length === 0, bad.length + ' ramp(s) at neither angle: ' + bad.slice(0, 4).join('; '));
  });

  test('a deep dive goes vertical rather than leaving early', () => {
    // The bug this replaces: Saxophone Lesson at 16:00 left its line at
    // 15:00, because a 45-degree ramp to a lane a band away needs an hour of
    // run. Nothing may leave more than a couple of corner radii early.
    const bad = [];
    for (const f of fixtures) {
      const rep = layout(f, ROOMY);
      // LEAD_CAP as the layout computes it, not a copy of the number: the
      // two drifted apart the moment the corner radius grew for the
      // S-curves, and the copy was the one that was wrong.
      const cap = Math.max(2 * (rep.debug.corner || 0), rep.debug.minDiag || 0) + 1;
      assert(cap > 1, 'the layout did not report its corner radius');
      for (const e of eventsIn(rep)) {
        if (e.status !== 'ok' || e.dir < 0) continue;
        const lead = e.elbow - e.diagFrom;
        if (lead > cap) bad.push(f.name + ' "' + e.title + '" leaves ' + Math.round(lead) + 'px early');
      }
    }
    assert(bad.length === 0, bad.length + ' branch(es) leave too early: ' + bad.slice(0, 4).join('; '));
  });

  // A LEVEL CHANGE IS AN ORTHOGONAL STEP.
  //
  // This used to assert the opposite -- that a shallow drop still took a 45
  // rather than going vertical -- and that rule is gone. A 45 needs as many
  // pixels of axis as it has bands to climb, so on a board where the lines
  // sit bands apart it is not a gentle ramp, it is a diagonal across the
  // whole afternoon: Bart came out of the school day at three on one and
  // arrived at detention having crossed open canvas the entire way.
  //
  // Lines run flat until the moment they have to be somewhere else, and
  // then go there. Measured off the drawn courses rather than off any
  // event's numbers, because the claim is about what the board looks like:
  // no segment of any line may be long in BOTH directions at once.
  for (const f of fixtures) {
    test('a line runs flat or steps square, never on a long diagonal: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const corner = (rep.debug.corner || 8) * (rep.debug.Z || 1);
      const bad = [];
      for (const path of pathsWhere(rep, 'course').concat(pathsWhere(rep, 'track'))) {
        const pts = path.points || [];
        for (let i = 1; i < pts.length; i++) {
          const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
          const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
          // A fillet is short in both; a step is short in one. Only a run
          // that travels a long way in both is the diagonal being ruled out.
          if (dx > corner * 2.5 && dy > corner * 2.5) {
            bad.push(path.owner + ' runs ' + Math.round(dx) + 'x' + Math.round(dy)
              + ' at x' + Math.round(pts[i - 1][0]));
          }
        }
      }
      assert(bad.length === 0, bad.length + ' diagonal run(s): ' + bad.slice(0, 3).join('; '));
    });
  }

  // ---- 4. what a tick means -------------------------------------------

  for (const f of fixtures) {
    test('a start is a dot and an end is a tick: ' + f.name, () => {
      // A tick is a bar drawn ACROSS the line, and the start of a rail is
      // usually a bend — the ramp arrives at exactly that minute. A tick
      // there lay over the corner: on a vertical drop it read as the line
      // overshooting its own rail, on a 45° ramp as a blot. A dot sits ON
      // the line rather than across it, so it can mark a corner; a tick
      // cannot. Ends are always on flat rail, so they keep the tick.
      const rep = layout(f, ROOMY);
      const Z = rep.debug.Z || 1;
      const placed = eventsIn(rep).filter((e) => e.status === 'ok');
      const dots = rep.circles.filter((c) => c.role === 'stop-start');
      const ticks = rep.circles.filter((c) => c.role === 'stop');
      const bad = [];
      for (const t of ticks) {
        const cx = t.x + t.w / 2;
        const onStart = placed.some((e) => Math.abs(e.nodeA * Z - cx) < 6);
        const onEnd = placed.some((e) => Math.abs(e.endA * Z - cx) < 6);
        if (onStart && !onEnd) bad.push('a tick sits on a start at x' + Math.round(cx));
      }
      assert(bad.length === 0, bad.join('; '));
      assert(dots.length > 0, 'no start dots drawn at all');
    });
  }

  test('every placed event is marked at its start by a dot', () => {
    const rep = layout(fixtures.find((x) => x.name === 'busy-day'), ROOMY);
    const Z = rep.debug.Z || 1;
    const dots = rep.circles.filter((c) => c.role === 'stop-start');
    const interchange = new Set(fixtures.find((x) => x.name === 'busy-day').metro.items
      .filter((i) => i.type === 'event' && (i.co_owners || []).length).map((i) => i.title));
    const missing = eventsIn(rep).filter((e) => e.status === 'ok' && !interchange.has(e.title))
      .filter((e) => !dots.some((d) => Math.abs(d.x + d.w / 2 - e.nodeA * Z) < 8));
    assert(missing.length === 0,
      missing.length + ' event(s) with no start dot: ' + missing.map((e) => e.title).join(', '));
  });

  test('a line leaves its trunk once per run of events sharing a lane', () => {
    // Two ramps into one flat rail is a line dropping into a place it was
    // already lying. Counted as: no two ramps of the same owner arrive at
    // the same lane height within each other's rail.
    const rep = layout(fixtures.find((x) => x.name === 'busy-day'), ROOMY);
    const arrivals = {};
    for (const r of pathsWhere(rep, 'fork')) {
      if (!r.pts.length) continue;
      const end = r.pts[r.pts.length - 1];
      (arrivals[r.owner] = arrivals[r.owner] || []).push(end);
    }
    const bad = [];
    for (const owner of Object.keys(arrivals)) {
      const list = arrivals[owner];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (Math.abs(list[i][1] - list[j][1]) < 4 && Math.abs(list[i][0] - list[j][0]) < 40) {
            bad.push('"' + owner + '" ramps in twice at y' + Math.round(list[i][1]));
          }
        }
      }
    }
    assert(bad.length === 0, bad.length + ' duplicate ramp(s): ' + bad.slice(0, 3).join('; '));
  });

  // ---- 5. corners ------------------------------------------------------

  test('both of a ramp\'s corners are rounded to the same radius', () => {
    // roundedPath clamps each fillet to half its shorter adjacent segment.
    // Drawn as two paths, the fork took a fixed lead and left the branch
    // nothing, so the corner into the lane came out square beside a round
    // one. Measured as how far the drawn curve cuts the corner: a square
    // corner cuts nothing.
    const rep = layout(fixtures.find((x) => x.name === 'busy-day'), ROOMY);
    const bad = [];
    for (const r of pathsWhere(rep, 'fork')) {
      if (r.pts.length < 12) continue;
      const cuts = corners(r.pts);
      if (cuts.length !== 2) continue;
      const [a, b] = cuts;
      if (Math.max(a, b) > 1 && Math.min(a, b) < Math.max(a, b) * 0.45) {
        bad.push('"' + r.owner + '" corners cut ' + a.toFixed(1) + 'px and ' + b.toFixed(1) + 'px');
      }
    }
    assert(bad.length === 0, bad.length + ' ramp(s) with mismatched corners: '
      + bad.slice(0, 4).join('; '));
  });

  // How much the drawn path deviates from the straight-line corner at each
  // turn: sample the direction along the path, find where it swings, and
  // measure the largest gap between the samples and the corner point.
  function corners(pts) {
    const dirs = [];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      const l = Math.hypot(dx, dy);
      dirs.push(l < 0.01 ? null : [dx / l, dy / l]);
    }
    const turns = [];
    for (let i = 1; i < dirs.length; i++) {
      if (!dirs[i] || !dirs[i - 1]) continue;
      const dot = dirs[i][0] * dirs[i - 1][0] + dirs[i][1] * dirs[i - 1][1];
      if (dot < 0.999) turns.push(i);
    }
    // group consecutive turning samples into corners, and measure each
    // group's length along the path as a proxy for its radius
    const out = [];
    let run = [turns[0]];
    for (let i = 1; i < turns.length; i++) {
      if (turns[i] - turns[i - 1] <= 2) run.push(turns[i]);
      else { out.push(runLen(pts, run)); run = [turns[i]]; }
    }
    if (turns.length) out.push(runLen(pts, run));
    return out;
  }
  function runLen(pts, run) {
    let l = 0;
    for (let i = run[0]; i <= run[run.length - 1] && i < pts.length - 1; i++) {
      l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    return l;
  }
};
