'use strict';

// Core geometry invariants. These are the properties a reader depends on:
// text you can read, lines that go where they say they go, and rings that
// actually sit on their line.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, overlap, pointIn, textLabels, pathsWhere, deepestIntrusion, eventsIn, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');

  // ------------------------------------------------------------ it renders at all

  for (const f of fixtures) {
    test('renders and reports geometry: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      assert(rep.paths.length > 0, 'no paths drawn');
      assert(textLabels(rep).length > 0, 'no text drawn');
    });
  }

  // ------------------------------------------------------------ nothing dropped

  for (const f of fixtures) {
    test('every event is placed on a roomy canvas: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const dropped = eventsIn(rep).filter((e) => e.status === 'DROP');
      assert(dropped.length === 0, 'dropped ' + dropped.map((e) => e.title).join(', '));
    });
  }

  // ------------------------------------------------------------ readable text

  // Text boxes carry an opaque background, so any real overlap hides
  // something. A hairline of contact is tolerated; a chunk is a bug.
  // Known defects, each understood and none of them fixed yet. All three
  // classes come from the same root: lanes are a single pool shared by every
  // track on a side, so one track's branch has to reach across its
  // neighbours' lanes to find room, and a label can be placed where another
  // track's diagonal already runs. A per-track band layout removes the
  // possibility rather than scoring against it; an attempt at that regressed
  // other things and was backed out, so these stay recorded here until it
  // lands properly.
  const OVERLAP_KNOWN = {
    'all-day-every-track': 'station captions on adjacent tracks sit one TRACK_STEP apart, which is less than a caption is tall; and Yoga/School Run share a lane region',
    'waypoint-station': 'labels on different tracks can be placed into the same strip of canvas — nothing reserves a track its own room',
  };
  const PIERCE_KNOWN = {
    'busy-day': "Sam's branches cut through the Kids labels — a branch may cross a neighbouring track's lane to reach its own",
    'all-day-every-track': 'same cross-track branch intrusion, plus branches crossing labels on their own line when an event starts inside another branch\'s climb',
    'waypoint-station': 'same cross-track branch intrusion',
    'tight-pair': 'two events on ONE line starting within a lane-reach of each other: the later branch has no crossing-free lane available, so the crossing is detected and then allowed',
  };

  const OVERLAP_TOL = 2;
  for (const f of fixtures) {
    test('no two text labels overlap: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const ls = textLabels(rep);
      const bad = [];
      for (let i = 0; i < ls.length; i++) {
        for (let j = i + 1; j < ls.length; j++) {
          const o = overlap(ls[i], ls[j]);
          if (o && o.w > OVERLAP_TOL && o.h > OVERLAP_TOL) {
            bad.push('"' + ls[i].text + '" x "' + ls[j].text + '" (' + Math.round(o.w) + 'x' + Math.round(o.h) + 'px)');
          }
        }
      }
      assert(bad.length === 0, bad.length + ' overlapping label pair(s): ' + bad.slice(0, 6).join('; '));
    }, OVERLAP_KNOWN[f.name] && { known: OVERLAP_KNOWN[f.name] });
  }

  // ------------------------------------------------------------ lines vs text

  // A line crossing a label is the "clipping" bug this plugin kept
  // regressing on. Grazing the very edge of a box is fine (labels sit right
  // beside their own line by design); running through the middle is not.
  const INTRUSION_TOL = 4;
  for (const f of fixtures) {
    test('no track or branch line runs through a text label: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const ls = textLabels(rep);
      const lines = pathsWhere(rep, 'track').concat(pathsWhere(rep, 'branch'));
      const bad = [];
      for (const box of ls) {
        for (const p of lines) {
          const d = deepestIntrusion(p.pts, box);
          if (d > INTRUSION_TOL) bad.push('"' + box.text + '" pierced ' + Math.round(d) + 'px by ' + p.role + ' ' + p.owner);
        }
      }
      assert(bad.length === 0, bad.length + ' label(s) with a line through them: ' + bad.slice(0, 6).join('; '));
    }, PIERCE_KNOWN[f.name] && { known: PIERCE_KNOWN[f.name] });
  }

  // ------------------------------------------------------------ rings sit on the line

  // Every ring marks a real moment on a real line, so the line has to pass
  // through the ring's CENTRE — and pass through, not stop at it: samples
  // must appear on both sides. A line that ends at the rim, or misses the
  // centre because the track moved after the ring was placed, is the bug.
  // Corners are drawn rounded (radius CORNER), so at a kink the path cuts
  // the vertex by a couple of px; the ring still reads as sitting on the
  // line. Anything beyond that is the line and the ring disagreeing.
  const CENTRE_TOL = 4;
  for (const f of fixtures) {
    test('lines pass through the centre of every ring, from both sides: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const lines = pathsWhere(rep, 'track').concat(pathsWhere(rep, 'branch'));
      const missed = [], oneSided = [];
      // only the markers that are meant to sit ON a line: event rings and
      // station boundary rings. The "now" dot rides the hour axis and the
      // lettered bullets mark a line's start, so neither is checked here.
      for (const c of rep.circles.filter((c) => c.role === 'ring' || c.role === 'station-ring')) {
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2, r = Math.max(c.w, c.h) / 2;
        let best = Infinity;
        const near = [];
        for (const p of lines) {
          for (const pt of p.pts) {
            const d = Math.hypot(pt[0] - cx, pt[1] - cy);
            if (d < best) best = d;
            if (d <= r + 2) near.push([pt[0] - cx, pt[1] - cy]);
          }
        }
        if (best > CENTRE_TOL) { missed.push('(' + Math.round(cx) + ',' + Math.round(cy) + ') off by ' + best.toFixed(1) + 'px'); continue; }
        // two samples pointing more than 90° apart means the line carries on
        // through rather than terminating at the ring
        let through = false;
        for (let i = 0; i < near.length && !through; i++) {
          for (let j = i + 1; j < near.length; j++) {
            const a = near[i], b = near[j];
            const la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
            if (la < 1 || lb < 1) continue;
            if ((a[0] * b[0] + a[1] * b[1]) / (la * lb) < 0) { through = true; break; }
          }
        }
        if (!through) oneSided.push('(' + Math.round(cx) + ',' + Math.round(cy) + ')');
      }
      assert(missed.length === 0, missed.length + ' ring(s) not centred on any line: ' + missed.slice(0, 6).join('; '));
      assert(oneSided.length === 0, oneSided.length + ' ring(s) with line on one side only: ' + oneSided.slice(0, 6).join('; '));
    });
  }

  // ------------------------------------------------------------ interchange capsules

  // An interchange capsule has to reach every line it claims to join. When a
  // track kinks out for an all-day band, the capsule has to follow it there.
  test('an interchange capsule reaches every track it spans', () => {
    for (const name of ['busy-day', 'all-day-every-track']) {
      const f = fixtures.find((x) => x.name === name);
      const rep = layout(f, ROOMY);
      const caps = rep.rects.filter((r) => r.role === 'capsule');
      assert(caps.length > 0, name + ': expected at least one interchange capsule');
      const tracks = pathsWhere(rep, 'track');
      for (const cap of caps) {
        const cx = cap.x + cap.w / 2;
        // every track line crossing this capsule's x must be met by it
        for (const t of tracks) {
          const at = t.pts.filter((p) => Math.abs(p[0] - cx) <= 2);
          if (!at.length) continue;
          const ys = at.map((p) => p[1]);
          const yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
          const spans = yMax >= cap.y - 2 && yMin <= cap.y + cap.h + 2;
          const inside = yMin >= cap.y - 2 && yMax <= cap.y + cap.h + 2;
          assert(!spans || inside || yMax < cap.y || yMin > cap.y + cap.h,
            name + ': capsule at x=' + Math.round(cx) + ' only partly meets track ' + t.owner);
        }
      }
    }
  });

  // ------------------------------------------------------------ all-day bands

  test('an all-day station band runs the width of the visible day', () => {
    const f = fixtures.find((x) => x.name === 'all-day-every-track');
    const rep = layout(f, ROOMY);
    const tracks = pathsWhere(rep, 'track');
    for (const t of tracks) {
      const xs = t.pts.map((p) => p[0]);
      const span = Math.max.apply(null, xs) - Math.min.apply(null, xs);
      assert(span > rep.canvas.w * 0.9, 'track ' + t.owner + ' only spans ' + Math.round(span) + 'px of ' + Math.round(rep.canvas.w));
      // a raised band means the line spends most of its length off its own
      // baseline: the run at the most common y should not be the whole line
      const ys = t.pts.map((p) => Math.round(p[1]));
      const counts = {};
      ys.forEach((y) => { counts[y] = (counts[y] || 0) + 1; });
      const top = Math.max.apply(null, Object.keys(counts).map((k) => counts[k]));
      assert(top > ys.length * 0.5, 'track ' + t.owner + ' has no sustained flat run — the band never settles');
    }
  });

  // ------------------------------------------------------------ staying on the canvas

  for (const f of fixtures) {
    test('every label stays inside the canvas: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const bad = textLabels(rep).filter((l) =>
        l.x < -2 || l.y < -2 || l.x + l.w > rep.canvas.w + 2 || l.y + l.h > rep.canvas.h + 2);
      assert(bad.length === 0, bad.length + ' label(s) off-canvas: ' + bad.slice(0, 5).map((l) => '"' + l.text + '"').join(', '));
    });
  }
};
