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
  // Known defects: real, understood, not fixed. The band layout removed the
  // cross-track ones (a branch can no longer reach into a neighbour's lanes,
  // and lines no longer converge across the map to reach their names). What
  // is left is a track crossing ITSELF: when the next event's ring lands
  // under the previous event's label, the later branch has to climb through
  // that label to reach any lane further out, and swapping the pair — which
  // fixes the tightest version — reorders long runs badly enough to cost
  // more events than it saves.
  const OVERLAP_KNOWN = {};
  // Three fixtures came off this list when a pierce stopped scoring cheaper
  // than sliding a label. The one left is geometry, not scoring.
  // On the 800x480 panel the whole map is half the size but the text is
  // not: a lane is about a line-height deep, so a branch diving to the next
  // lane out passes within a few px of the label already sitting there. The
  // pierces below are all 6-10px grazes of that kind, and the only cures
  // are fewer lanes (fewer events shown) or smaller text than the panel can
  // carry. Listed so they cannot get worse without the suite saying so.
  const PIERCE_KNOWN_VIEW = {
    'busy-day/og-landscape': 'a 480px-deep board packs four lines and three lanes a side: Work\'s rail runs under Alex\'s name, and one kids branch grazes another kids label by 8px.',
    'all-day-every-track/og-landscape': 'same packing, with every line kinked out for an all-day band on top of it: four branches graze a neighbouring label by 6-8px.',
    'waypoint-station/og-landscape': 'same packing again, plus a waypoint caption: five 6-8px grazes.',
    'five-lines/og-landscape': 'five lines on a 480px-deep board leaves each of them about a line-height of band: three branches graze a neighbouring label by 7-8px.',
  };
  const PIERCE_KNOWN = {
    'tight-pair': 'two 15-minute meetings 20 minutes apart on one line: the second has to reach a deeper lane, and its branch now drops at its own minute rather than easing in from before, so it passes through the first label — which is 20x wider than the gap between them at any text size. The alternatives are a label 500px from the rail it belongs to, or a branch that lies about when the meeting starts.',
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
    for (const vname of ['x-landscape', 'og-landscape']) {
    test('no track or branch line runs through a text label: ' + f.name + '/' + vname, () => {
      const rep = layout(f, byName(vname));
      const ls = textLabels(rep);
      const lines = pathsWhere(rep, 'track').concat(pathsWhere(rep, 'branch'), pathsWhere(rep, 'fork'));
      // A line's NAME is set on the line it names — that is the design, and
      // its paper outline masks the rail behind it. Only somebody else's
      // line through a name is a fault.
      const owns = {};
      for (const t of f.metro.legend) owns[t.name] = t.key;
      const bad = [];
      for (const box of ls) {
        for (const p of lines) {
          if (owns[box.text] && owns[box.text] === p.owner) continue;
          const d = deepestIntrusion(p.pts, box);
          if (d > INTRUSION_TOL) bad.push('"' + box.text + '" pierced ' + Math.round(d) + 'px by ' + p.role + ' ' + p.owner);
        }
      }
      assert(bad.length === 0, bad.length + ' label(s) with a line through them: ' + bad.slice(0, 6).join('; '));
    }, (PIERCE_KNOWN_VIEW[f.name + '/' + vname] || PIERCE_KNOWN[f.name])
       && { known: PIERCE_KNOWN_VIEW[f.name + '/' + vname] || PIERCE_KNOWN[f.name] });
    }
  }

  // ------------------------------------------------------------ rings sit on the line

  // Every ring marks a real moment on a real line, so the line has to pass
  // through the ring's CENTRE — and pass through, not stop at it: samples
  // must appear on both sides. A line that ends at the rim, or misses the
  // centre because the track moved after the ring was placed, is the bug.
  // Corners are drawn rounded (radius CORNER), so where a ring sits on a
  // kink the drawn path cuts the vertex — by up to ~0.4x the corner radius,
  // which at 2x device scale is a few px. The ring still reads as sitting on
  // the line there. This has to absorb that and nothing more: the bug this
  // guards against put rings tens of px from their own track.
  // Corner rounding at a station kink pulls the drawn line up to about a
  // corner radius off the ideal one, and a ring sitting on that kink is
  // measured against the drawn path. The bug this guards against put rings
  // 58-68px from their own track.
  const CENTRE_TOL = 10;
  for (const f of fixtures) {
    test('lines pass through the centre of every ring, from both sides: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      // Forks count as line. Where a branch dives only a lane's minimum the
      // whole diagonal fits inside the fillet, so the "branch" path collapses
      // to a point at the elbow and the fillet IS the line the marker sits
      // on. Leaving it out reported a tick as adrift by exactly the length of
      // the diagonal it was sitting on.
      const lines = pathsWhere(rep, 'track').concat(pathsWhere(rep, 'branch'), pathsWhere(rep, 'fork'));
      const missed = [], oneSided = [];
      // every marker that is meant to sit ON a line: the tick of a local
      // stop, the ring of an interchange, a station junction. The "now" dot
      // rides the hour axis and the lettered bullets mark a line's start,
      // so neither is checked here.
      for (const c of rep.circles.filter((c) => c.role === 'ring' || c.role === 'station-ring' || c.role === 'stop' || c.role === 'stop-start')) {
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
        // A stop tick may legitimately be the LAST thing on its rail — the
        // rail ends when the event does — so only the markers that are
        // always mid-line have to have line on both sides of them.
        if (!through && c.role !== 'stop' && c.role !== 'stop-start') oneSided.push('(' + Math.round(cx) + ',' + Math.round(cy) + ')');
      }
      assert(missed.length === 0, missed.length + ' ring(s) not centred on any line: ' + missed.slice(0, 6).join('; '));
      assert(oneSided.length === 0, oneSided.length + ' ring(s) with line on one side only: ' + oneSided.slice(0, 6).join('; '));
    });
  }

  // ------------------------------------------------------------ junctions

  // Where a branch leaves its line it must actually TOUCH that line. The
  // fork's height was taken at the event's own minute while the fork is
  // drawn earlier, so wherever the line was still ramping out of a station
  // in between, the branch began at one height and the line was at another:
  // it started in mid-air and crossed the ramp instead of forking off it.
  for (const f of fixtures) {
    test('every branch leaves its line from a point on that line: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const forks = pathsWhere(rep, 'fork');
      assert(forks.length > 0, 'no junction fillets drawn at all');
      const adrift = [];
      for (const fk of forks) {
        const mine = pathsWhere(rep, 'track').filter((t) => t.owner === fk.owner);
        assert(mine.length > 0, 'fork for a line with no track: ' + fk.owner);
        // the fork starts on the trunk: its first sampled point is the one
        // that has to be on it
        const start = fk.pts[0];
        let best = Infinity;
        for (const t of mine) for (const pt of t.pts) {
          const d = Math.hypot(pt[0] - start[0], pt[1] - start[1]);
          if (d < best) best = d;
        }
        // A fork that lands inside a station's ramp is attached to a
        // CORNER-rounded curve, and rounding pulls the drawn line up to
        // about a corner radius off the ideal one. That is the slack here
        // and nothing more: the bug this guards against started branches
        // 70 to 500px from their line, in mid-air.
        if (best > 26) adrift.push(fk.owner + ' by ' + best.toFixed(1) + 'px');
      }
      assert(adrift.length === 0,
        adrift.length + ' branch(es) starting off their own line: ' + adrift.slice(0, 5).join('; '));
    });
  }

  // ------------------------------------------------------------ interchange capsules

  // An interchange is drawn as a tie between the lines it joins, with a ring
  // on each. The tie has to actually span them — when a track kinks out for
  // an all-day band, the tie has to follow it there rather than reaching for
  // a baseline nobody is sitting on.
  test('an interchange ties together every track it spans', () => {
    for (const name of ['busy-day', 'all-day-every-track']) {
      const f = fixtures.find((x) => x.name === name);
      const rep = layout(f, ROOMY);
      const ties = rep.paths.filter((p) => p.role === 'capsule')
        .concat(rep.rects.filter((r) => r.role === 'capsule'));
      const lineTies = rep.ties || [];
      const all = ties.concat(lineTies);
      assert(all.length > 0, name + ': expected at least one interchange tie');
      const tracks = pathsWhere(rep, 'track');
      for (const tie of all) {
        const x = tie.x + tie.w / 2;
        const top = tie.y, bot = tie.y + tie.h;
        // every track whose line runs through the tie's vertical span at
        // this x must be met by it, not passed over
        let met = 0;
        for (const t of tracks) {
          const at = t.pts.filter((p) => Math.abs(p[0] - x) <= 3);
          if (!at.length) continue;
          const ys = at.map((p) => p[1]);
          const y = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
          if (y >= top - 3 && y <= bot + 3) met++;
        }
        assert(met >= 2, name + ': a tie at x=' + Math.round(x) + ' reaches only ' + met + ' line(s)');
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

  // ------------------------------------------------------------ small screens

  // The original TRMNL panel is 800x480 with no device scaling — the tightest
  // canvas this plugin has to work on, and the one where a layout that only
  // ever gets checked at 2x quietly falls off the bottom.
  const TIGHT = byName('og-landscape');
  for (const f of fixtures) {
    test('fits the small panel: ' + f.name, () => {
      const rep = layout(f, TIGHT);
      const off = textLabels(rep).filter((l) =>
        l.x < -2 || l.y < -2 || l.x + l.w > rep.canvas.w + 2 || l.y + l.h > rep.canvas.h + 2);
      assert(off.length === 0, off.length + ' label(s) off-canvas: '
        + off.slice(0, 5).map((l) => '"' + l.text + '"').join(', '));
      const tracks = pathsWhere(rep, 'track');
      for (const t of tracks) {
        const ys = t.pts.map((p) => p[1]);
        assert(Math.min.apply(null, ys) >= -2 && Math.max.apply(null, ys) <= rep.canvas.h + 2,
          'track ' + t.owner + ' runs off the canvas');
      }
    });
  }

  // ------------------------------------------------------------ staying on the canvas

  for (const f of fixtures) {
    test('every label stays inside the canvas: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const bad = textLabels(rep).filter((l) =>
        l.x < -2 || l.y < -2 || l.x + l.w > rep.canvas.w + 2 || l.y + l.h > rep.canvas.h + 2);
      assert(bad.length === 0, bad.length + ' label(s) off-canvas: ' + bad.slice(0, 5).map((l) => '"' + l.text + '"').join(', '));
    });
  }

  // Nothing is drawn with no paint. An SVG shape given neither a stroke nor
  // a fill renders as nothing at all: it is in the DOM, the right size, in
  // the right place, and invisible. That is exactly how the interchange tie
  // disappeared — its literal stroke was removed on the way to making the
  // colours theme-aware and never replaced, leaving three rings on three
  // lines with no visible reason to be there. Every other geometry test
  // passed, because the tie was still perfectly positioned.
  for (const f of fixtures) {
    test('everything drawn is actually visible: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const NONE = (v) => !v || v === 'none' || v === 'rgba(0, 0, 0, 0)' || v === 'transparent';
      const bad = [];
      for (const el of rep.painted || []) {
        if (!el.w && !el.h) continue;                       // not laid out
        // A <line> cannot be filled — only its stroke draws anything — and
        // its computed fill defaults to black, so counting fill as paint let
        // the strokeless tie through. This test passed on the broken build
        // the first time it was run, which is the whole reason for the note.
        const fills = el.tag !== 'line' && el.tag !== 'polyline';
        const inked = (!NONE(el.stroke) && el.strokeWidth > 0) || (fills && !NONE(el.fill));
        if (!inked) bad.push(el.role + (el.owner ? '/' + el.owner : '') + ' <' + el.tag + '>');
        else if (el.opacity === 0) bad.push(el.role + ' is fully transparent');
      }
      assert(bad.length === 0, bad.length + ' element(s) drawn with no paint: '
        + [...new Set(bad)].slice(0, 5).join('; '));
    });
  }

  test('a station shared by two lines kinks both and is captioned once', () => {
    // Two children at the same school are two kinks — they really are both
    // there — but it is one School Day. Drawn once per line the caption
    // appeared twice, on lines that could be at opposite ends of the board.
    const f = fixtures.find((x) => x.name === 'shared-station');
    const rep = layout(f, ROOMY);
    const captions = textLabels(rep).filter((l) => l.text.indexOf('School Day') >= 0);
    assert(captions.length === 1,
      'expected one "School Day" caption for the shared station, got ' + captions.length);
    // and both lines still leave their baseline for it
    const kinked = pathsWhere(rep, 'track').filter((t) => {
      const ys = t.pts.map((q) => q[1]);
      return Math.max(...ys) - Math.min(...ys) > 6;
    });
    assert(kinked.length >= 2,
      'both lines should kink out to station level, only ' + kinked.length + ' did');
  });

  test('a shared station draws its lines TOGETHER, not apart', () => {
    // A station normally kinks a line away from the spine. Two people at the
    // same school kinking away from EACH OTHER looked like two unrelated
    // stations that happened to share a name. Converging instead draws them
    // alongside each other for the length of the thing they are both at.
    const f = fixtures.find((x) => x.name === 'shared-station');
    const rep = layout(f, ROOMY);
    const owners = new Set(f.metro.stations.map((s) => s.owner));
    const lines = pathsWhere(rep, 'track').filter((t) => owners.has(t.owner));
    assert(lines.length === 2, 'expected the two lines that share the station');
    // the gap between them, at the ends of the board versus in the middle
    // of the shared span
    const at = (t, x) => {
      let best = null;
      for (const q of t.pts) if (!best || Math.abs(q[0] - x) < Math.abs(best[0] - x)) best = q;
      return best[1];
    };
    const edge = Math.abs(at(lines[0], 8) - at(lines[1], 8));
    const mid = Math.abs(at(lines[0], rep.canvas.w / 2) - at(lines[1], rep.canvas.w / 2));
    assert(mid < edge - 8,
      'the lines should be closer together inside the shared station than outside it: '
      + Math.round(mid) + 'px vs ' + Math.round(edge) + 'px');
    // and a bar across them at each end says where it starts and stops
    const bars = (rep.rects || []).filter((r) => r.role === 'capsule');
    assert(bars.length >= 2,
      'expected a bar at each end of the shared span, found ' + bars.length);
  });

  for (const f of fixtures) {
    test('no line name lands in the river: ' + f.name, () => {
      // The track nearest the spine sits close enough that its name went
      // into the water with the hour labels, which are the one thing on the
      // board it must never share space with.
      const rep = layout(f, ROOMY);
      const hours = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-hour ') >= 0);
      const names = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-terminus ') >= 0);
      const bad = [];
      for (const n of names) {
        for (const h of hours) {
          if (overlap(n, h)) { bad.push('"' + n.text + '" over "' + h.text + '"'); break; }
        }
      }
      assert(bad.length === 0, bad.length + ' line name(s) in the river: ' + bad.slice(0, 3).join('; '));
    });
  }

  test('a shared event gets one BOLD rail, not one rail per line', () => {
    // Drawn as a bundle of parallel rails, one per person, it was a comb of
    // near-identical strokes that read as a smudge rather than as several
    // lines arriving somewhere. One heavier rail says the same thing: when
    // several people are in one place that is the weightiest thing on that
    // stretch of the board.
    const f = fixtures.find((x) => x.name === 'busy-day');
    const rep = layout(f, ROOMY);
    const shared = new Set(f.metro.items
      .filter((i) => i.type === 'event' && (i.co_owners || []).length)
      .map((i) => i.title));
    assert(shared.size > 0, 'the busy day has no shared events');
    const Z = rep.debug.Z || 1;
    const at = eventsIn(rep).filter((e) => e.status === 'ok' && shared.has(e.title))
      .map((e) => ({ x: (e.elbow + e.endA) / 2 * Z, y: (rep.debug.spineC + e.sign * e.laneDist) * Z }));
    assert(at.length > 0, 'no shared event was placed');
    const flat = pathsWhere(rep, 'branch').concat(pathsWhere(rep, 'fork'));
    function widthNear(pt) {
      let best = 0;
      for (const p of flat) {
        for (const q of p.pts) {
          if (Math.abs(q[0] - pt.x) < 20 && Math.abs(q[1] - pt.y) < 8) best = Math.max(best, p.width);
        }
      }
      return best;
    }
    const plain = flat.filter((p) => p.width > 0).map((p) => p.width).sort((a, b) => a - b);
    const median = plain[Math.floor(plain.length / 2)] || 0;
    const boldest = Math.max.apply(null, at.map(widthNear));
    assert(boldest > median * 1.2,
      'a shared event\'s rail should be visibly heavier than an ordinary one: '
      + boldest.toFixed(1) + 'px vs a typical ' + median.toFixed(1) + 'px');
  });
};
