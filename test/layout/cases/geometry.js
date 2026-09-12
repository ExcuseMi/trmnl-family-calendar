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
  // EMPTIED. Every entry that used to sit in these two tables described the
  // branch-and-lane model: a rail crossing a neighbour's caption on a
  // shared ladder, an elbow that could not slide past its own event, a
  // branch dropping through its own line's words on the way out to a lane.
  //
  // There are no branches any more. A solo event is a stop ON its line -- a
  // dot, an end tick, and a name beside it -- so there is no rail to cross
  // anything with and no ladder to share, and all ten of these started
  // passing at once. The runner treats a known issue that passes as a
  // failure precisely so they cannot be left lying around pretending the
  // board still has faults it grew out of.
  //
  // Anything genuinely known goes back in here with the board it happens
  // on and the reason, the way these did.
  // Found the moment this check started running on the 800x480 panel as well
  // as the roomy one. Both are E19: caption placement is greedy, so on a
  // panel this tight the search takes the least-bad spot and somebody's words
  // end up on somebody else's. Drawing the board from both ends of the day
  // and keeping the better one cleared every x-landscape board and these two
  // did not follow. They want the placer to see a whole side at once.
  // Both came off this list when a caption written over another started
  // being lifted off and asked again with the whole board standing. That is
  // the repair pass; E19 is what it is for.
  const OVERLAP_KNOWN = {};
  const PIERCE_KNOWN_VIEW = {};
  // WHAT IS LEFT AFTER E23, and it is a different claim from what used to be
  // on this list. Not "the greedy pass took the least-bad spot" -- the
  // assignment can ask a neighbour to move now -- but "on this line every
  // position for this name is a graze, a pierce or a gap, and the prices only
  // decide which". Four orderings of those three were measured on the whole
  // suite; the one that ships costs the fewest boards. See E24.
  const WHY24 = 'every position for this name is a graze, a pierce or a gap: E24';
  const PIERCE_KNOWN = { 'long-event-day': WHY24 };
  // seven-lines is pierced on the ROOMY panel only, which is the opposite of
  // the usual shape and worth saying so: the bigger board reaches a bigger
  // text, and "Good News Everyone" at that size has no row beside its bundle
  // that one of the bundle's own rails does not cross.
  PIERCE_KNOWN_VIEW['seven-lines/x-landscape'] = WHY24;


  const OVERLAP_TOL = 2;
  // ON BOTH PANELS, NOT JUST THE ROOMY ONE.
  //
  // This ran on x-landscape alone, which is the board with the most paper on
  // it, so the one place captions are least likely to collide was the only
  // place anybody looked. The 800x480 panel is where they actually run out
  // of room: it packs five lines against the spine and stacks the captions
  // in lanes underneath, and "Reactor Core Check" ran straight into "Moe's
  // Tavern" with every test in this file green.
  for (const f of fixtures) {
    for (const vname of ['x-landscape', 'og-landscape']) {
    test('no two text labels overlap: ' + f.name + '/' + vname, () => {
      const rep = layout(f, byName(vname));
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
    }, OVERLAP_KNOWN[f.name + '/' + vname] && { known: OVERLAP_KNOWN[f.name + '/' + vname] });
    }
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
  // Corner rounding where a line changes lane pulls the drawn line up to
  // about a corner radius off the ideal one, and a ring sitting on that
  // corner is measured against the drawn path. The bug this guards against
  // put rings 58-68px from their own track.
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
  // drawn earlier, so wherever the line was still ramping between lanes in
  // between, the branch began at one height and the line was at another:
  // it started in mid-air and crossed the ramp instead of forking off it.
  for (const f of fixtures) {
    test('every branch leaves its line from a point on that line: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const forks = pathsWhere(rep, 'fork');
      // A board can honestly have no junctions on it. An event drawn as a
      // mark has no rail to fork off to, and in route mode a line with
      // nothing but marks on it simply runs straight: quiet-day is three
      // events and all three are marks. So the guard against this test
      // passing vacuously is not "there is always a fork", it is "there is
      // a fork wherever there is a rail to fork off to".
      // A convergence draws rails and no FORK: the rails are several lines
      // arriving, drawn as a bundle, and a bundle has no junction in it.
      // Only a solo event on a rail of its own forks off one.
      const shelves = eventsIn(rep).filter((e) => e.status === 'ok' && !e.mark && !e.shared);
      if (!shelves.length) return;
      assert(forks.length > 0, shelves.length
        + ' event(s) drawn as rails and no junction fillets at all: '
        + shelves.slice(0, 4).map((e) => e.title).join(', '));
      const adrift = [];
      for (const fk of forks) {
        const mine = pathsWhere(rep, 'course').filter((t) => t.owner === fk.owner);
        assert(mine.length > 0, 'fork for a line with no course: ' + fk.owner);
        // The fork starts ON the trunk: its first sampled point is the one
        // that has to be on it, and "on it" means on the LINE rather than
        // near one of its corners. A straight run carries no vertices in
        // the middle, so a departure halfway along a flat stretch read as
        // hundreds of pixels adrift while lying exactly on the line.
        const start = fk.pts[0];
        let best = Infinity;
        for (const t of mine) {
          for (let i = 1; i < t.pts.length; i++) {
            const a = t.pts[i - 1], b = t.pts[i];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const len2 = dx * dx + dy * dy;
            let u = len2 ? ((start[0] - a[0]) * dx + (start[1] - a[1]) * dy) / len2 : 0;
            u = Math.max(0, Math.min(1, u));
            best = Math.min(best, Math.hypot(a[0] + dx * u - start[0], a[1] + dy * u - start[1]));
          }
        }
        // A fork that lands inside a ramp is attached to a
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

  // A shared event has to REACH every line it belongs to. When a track kinks
  // out for an all-day band, whatever draws the event has to follow it there
  // rather than reaching for a baseline nobody is sitting on. That is the
  // bug this was written for, and it outlived the shape it was written
  // against.
  //
  // There are two shapes now. An event with a SPAN is a bundle: one rail per
  // line, each dropping from where its own line runs. A MOMENT has no span
  // to lie alongside anybody for and keeps the tie, which must still span
  // the lines it joins. Both say the same thing, and both are checked here
  // against the lines as they are really drawn.
  // A SHARED EVENT HAS TO REACH EVERY LINE IT JOINS.
  //
  // Three people at one place is the plugin's whole reason for being a
  // transit map rather than a list, and it is drawn two ways depending on
  // how long the event is. A short one gets the stadium capsule spanning
  // its members, the standard interchange mark. A long one converges the
  // lines themselves, so they run alongside each other for its span --
  // there is no capsule there because the convergence IS the mark.
  //
  // What this used to assert: a capsule, or rails carrying a bundle id.
  // Both halves had drifted. Nothing tags a bundle any more, and a
  // converged event is drawn on the lines' own trunks, so a perfectly good
  // interchange read as "drawn neither as a bundle of rails nor as a tie".
  //
  // And the capsule half was measuring the wrong thing: it took the MIDDLE
  // of every sample a line left near the capsule's minute, which for a line
  // dropping vertically into that capsule is halfway down the drop and
  // outside it. Both capsules on the everyday board reach exactly the two
  // lines they join; the midpoint of one of those lines sat 50px clear.
  // A LEADER STARTS WHERE THE PILL ENDS.
  //
  // It used to start at the line's own cross position, which on a
  // convergence is a point somewhere inside a paper-filled capsule: the
  // first several pixels were drawn under the pill and never seen, and what
  // reached the reader was a tick beginning at whatever point of the
  // outline the angle happened to cross. The taller the pill, the further
  // in it began.
  test('a leader begins outside its capsule, not somewhere inside it', () => {
    for (const name of ['busy-day', 'all-day-every-track', 'moment-day']) {
      const f = fixtures.find((x) => x.name === name);
      const rep = layout(f, ROOMY);
      const caps = (rep.rects || []).filter((r) => r.role === 'capsule');
      const leads = (rep.rects || []).filter((r) => r.role === 'leader');
      if (!leads.length || !caps.length) continue;
      for (const lead of leads) {
        for (const cap of caps) {
          // The pill's own edge is fair game -- that is the point -- so
          // measure against its inside, a few px in from the outline.
          const IN = 3;
          const inner = { x: cap.x + IN, y: cap.y + IN,
                          w: Math.max(0, cap.w - 2 * IN), h: Math.max(0, cap.h - 2 * IN) };
          if (inner.w <= 0 || inner.h <= 0) continue;
          const ox = Math.min(lead.x + lead.w, inner.x + inner.w) - Math.max(lead.x, inner.x);
          const oy = Math.min(lead.y + lead.h, inner.y + inner.h) - Math.max(lead.y, inner.y);
          assert(ox <= 0 || oy <= 0,
            name + ': a leader reaches ' + Math.round(Math.min(ox, oy)) + 'px into a capsule it should start against');
        }
      }
    }
  });

  test('a shared event reaches every line it joins', () => {
    for (const name of ['busy-day', 'all-day-every-track', 'moment-day']) {
      const f = fixtures.find((x) => x.name === name);
      const rep = layout(f, ROOMY);
      const tracks = pathsWhere(rep, 'track');
      const caps = (rep.rects || []).filter((r) => r.role === 'capsule');
      const shared = f.metro.events.filter((i) => (i.co_owners || []).length);
      assert(shared.length > 0, name + ': fixture has no shared events');

      // every y this line is drawn at, within a few px of one minute
      const ysAt = (owner, x) => {
        const out = [];
        for (const t of tracks) {
          if (t.owner !== owner) continue;
          for (const p of t.pts) if (Math.abs(p[0] - x) <= 3) out.push(p[1]);
        }
        return out;
      };

      for (const item of shared) {
        const want = [item.owner].concat(item.co_owners);
        const laid = eventsIn(rep).find((e) => e.title === item.title);
        assert(laid, name + ': ' + item.title + ' was not laid out at all');

        // A capsule at this event's minute must TOUCH every line it joins:
        // any sample inside it, not the average of a line in mid-turn.
        const cap = caps.find((c) => Math.abs(c.x + c.w / 2 - laid.nodeA * (rep.debug.Z || 1)) <= 12);
        if (cap) {
          // The capsule marks WHEN it starts, so its x is the node. Where it
          // sits across the board has to be where the lines are DURING the
          // event, not at its first minute: people converge over a ramp, so
          // at the minute it starts they are still climbing. Sampled there,
          // School Day's pill sat 71px under the corridor its two lines
          // spend the next seven hours in.
          const mid = ((laid.nodeA + laid.endA) / 2) * (rep.debug.Z || 1);
          for (const owner of want) {
            const ys = ysAt(owner, mid);
            if (!ys.length) continue;
            assert(ys.some((y) => y >= cap.y - 6 && y <= cap.y + cap.h + 6),
              name + ': ' + item.title + "'s capsule is not where " + owner
              + ' runs during it (line at ' + Math.round(Math.min(...ys))
              + ', capsule ' + Math.round(cap.y) + '..' + Math.round(cap.y + cap.h) + ')');
          }
          const top = cap.y - 3, bot = cap.y + cap.h + 3;
          for (const owner of want) {
            const ys = ysAt(owner, cap.x + cap.w / 2);
            assert(ys.some((y) => y >= top && y <= bot),
              name + ': ' + item.title + "'s capsule never touches " + owner
              + " (line at " + (ys.length ? Math.round(Math.min(...ys)) + '..'
                + Math.round(Math.max(...ys)) : 'nowhere near') + ', capsule '
              + Math.round(top) + '..' + Math.round(bot) + ')');
          }
          continue;
        }

        // No capsule: it is a converged event, and what makes it readable is
        // that the lines are CLOSER during it than they are apart from it.
        const Z = rep.debug.Z || 1;
        const mid = ((laid.nodeA + laid.endA) / 2) * Z;
        const spreadAt = (x) => {
          const ys = [];
          for (const owner of want) {
            const at = ysAt(owner, x);
            if (at.length) ys.push(at.reduce((a, b) => a + b, 0) / at.length);
          }
          return ys.length < 2 ? null : Math.max(...ys) - Math.min(...ys);
        };
        const during = spreadAt(mid);
        assert(during != null, name + ': ' + item.title
          + ' has no capsule and its lines are not all drawn at its middle, '
          + 'so nothing on the board says those people were together');
        const apart = spreadAt(Math.max(4, laid.nodeA * Z - 120)) || Infinity;
        assert(during < apart, name + ': ' + item.title
          + ' draws its lines ' + Math.round(during) + 'px apart during it and '
          + Math.round(apart) + 'px apart before it, so they never converged');
      }
    }
  });

  test('a line carrying an all-day event still runs the whole width', () => {
    // The board this fixture describes changed underneath this case: an
    // all-day event used to be drawn ON the line, spanning the visible
    // window, and the assertion was that it spanned all of it. That was
    // the bug -- the span was the BOARD's window, so the board printed its
    // own window back as the holiday's hours -- and the event is declared
    // at the line's head now, with nothing on the axis. See
    // cases/all-day.js for what replaced it.
    //
    // What survives is the half of this that was never about the event: a
    // line whose day is a holiday is still somebody's line, and it still
    // runs from one edge of the board to the other. A line that stops
    // short is one that was taken somewhere by its own event.
    const f = fixtures.find((x) => x.name === 'all-day-every-track');
    const rep = layout(f, ROOMY);
    // The COURSE, one per line and unbroken: the drawn line is in runs now,
    // cut wherever it passes under something, so its longest piece is not
    // its length. Where the line GOES is the question here.
    const byOwner = {};
    for (const t of pathsWhere(rep, 'course')) (byOwner[t.owner] = byOwner[t.owner] || []).push(t);
    const tracks = Object.keys(byOwner)
      .map((k) => byOwner[k].slice().sort((a, b) => b.len - a.len)[0]);
    assert(tracks.length > 0, 'no courses drawn at all');
    for (const t of tracks) {
      const xs = t.pts.map((p) => p[0]);
      const span = Math.max.apply(null, xs) - Math.min.apply(null, xs);
      assert(span > rep.canvas.w * 0.9, 'track ' + t.owner + ' only spans '
        + Math.round(span) + 'px of ' + Math.round(rep.canvas.w));
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
        // The COURSE is deliberately unpainted. It is where a line goes,
        // kept as one unbroken path so anything downstream can ask how far
        // along itself the line is at a given minute; the visible line is
        // drawn separately, in runs, because it breaks wherever it passes
        // under something. Nothing is meant to see this one.
        if (el.role === 'course') continue;
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

  test('a long event two people share moves both lines and is captioned once', () => {
    // Two children at the same school both leave their lane for it, because
    // they really are both there, but it is one School Day. Drawn once per
    // line the caption appeared twice, on lines that could be at opposite
    // ends of the board.
    const f = fixtures.find((x) => x.name === 'shared-long-event');
    const rep = layout(f, ROOMY);
    const captions = textLabels(rep).filter((l) => l.text.indexOf('School Day') >= 0);
    assert(captions.length === 1,
      'expected one "School Day" caption for the event they share, got ' + captions.length);
    // and both lines still leave their baseline for it
    const moved = pathsWhere(rep, 'track').filter((t) => {
      const ys = t.pts.map((q) => q[1]);
      return Math.max(...ys) - Math.min(...ys) > 6;
    });
    assert(moved.length >= 2,
      'both lines should lean in to the corridor, only ' + moved.length + ' did');
  });

  test('a long event two people share draws their lines TOGETHER, not apart', () => {
    // Drawn as a siding each, two people at the same school kinked away
    // from EACH OTHER and it read as two unrelated blocks that happened to
    // share a name. A long event two people share is not a long event at
    // all, it is a shared event: the lines converge and run alongside each
    // other for the length of the thing they are both at.
    const f = fixtures.find((x) => x.name === 'shared-long-event');
    const rep = layout(f, ROOMY);
    const long = f.metro.events.find((i) => i.type === 'event' && (i.co_owners || []).length
      && (i.all_day || i.end_min - i.start_min >= 240));
    assert(long, 'this board is meant to carry a long event two people share');
    const owners = new Set([long.owner].concat(long.co_owners));
    // the COURSE, not the ink: the drawn line is cut wherever it passes
    // under something, so a run of it says nothing about where it goes
    const lines = pathsWhere(rep, 'course').filter((t) => owners.has(t.owner));
    assert(lines.length === 2, 'expected the two lines that share "' + long.title + '"');
    const at = (t, x) => {
      let best = null;
      for (const q of t.pts) if (!best || Math.abs(q[0] - x) < Math.abs(best[0] - x)) best = q;
      return best[1];
    };
    // the gap between them at the start of the day, where each is on its
    // own lane, against the gap in the middle of the span they share
    const e = eventsIn(rep).find((x) => x.title === long.title);
    const Z = rep.debug.Z || 1;
    const edge = Math.abs(at(lines[0], 8) - at(lines[1], 8));
    const mid = Math.abs(at(lines[0], (e.nodeA + e.endA) / 2 * Z) - at(lines[1], (e.nodeA + e.endA) / 2 * Z));
    assert(mid < edge - 8,
      'the lines should be closer together inside the event they share than outside it: '
      + Math.round(mid) + 'px vs ' + Math.round(edge) + 'px');
    // A capsule spans the lines where the corridor starts. It does NOT get
    // a second one at the far end: a bar across the corridor there says the
    // lines all stop, which is not what happens, so the end is a tick on
    // one rail in that line's own colour (rule 30).
    const bars = (rep.rects || []).filter((r) => r.role === 'capsule');
    assert(bars.length >= 1, 'expected a capsule where the shared span starts, found none');
    const near = (r, a) => Math.abs(r.x + r.w / 2 - a) < 12;
    assert(bars.some((r) => near(r, e.nodeA * Z)),
      'no capsule where "' + long.title + '" starts');
    assert(!bars.some((r) => near(r, e.endA * Z)),
      'a capsule across the corridor where "' + long.title + '" ends says the lines all stop there');
    const ticks = (rep.circles || []).filter((m) => m.role === 'stop' && near(m, e.endA * Z));
    assert(ticks.length >= 1,
      'no tick on a rail where "' + long.title + '" ends: nothing says the corridor is over');
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

  test("a shared event's rails each wear their own line's stroke", () => {
    // The bundle's whole job is to say WHICH lines arrived. One bold rail
    // for the group (which is what this used to draw, and what this case
    // used to assert) says that several people are somewhere and never
    // which of them, and on a board where every line is told apart by
    // weight and texture it also says "some other line". So each rail is
    // drawn in the stroke of the line it came from, and no two lines in one
    // bundle may come out looking like the same line.
    // Whichever board still draws one. A shared event is a CONVERGENCE
    // wherever the lines can all be free at that minute, and a convergence
    // has no rails at all: the lines themselves are there, in their own
    // strokes, because they are the lines. The bundle is the fallback, and
    // this is the rule that makes the fallback readable — so the case looks
    // for a board that took it rather than insisting a particular one does.
    const tracks = {};
    const bundles = {};
    let boards = 0;
    for (const f of fixtures) {
      const rep = layout(f, ROOMY);
      const mine = {};
      for (const t of pathsWhere(rep, 'track')) mine[t.owner] = t;
      let any = false;
      for (const p of rep.paths) {
        if (!p.bundle) continue;
        any = true;
        const key = f.name + '/' + p.bundle;
        (bundles[key] = bundles[key] || []).push(p);
        tracks[p.owner] = mine[p.owner];
      }
      if (any) boards++;
    }
    // A bundle is now RARE: it is what is left when a line is genuinely in
    // two shared events at once, and no fixture currently does that, so
    // there is usually nothing here to check. Asserted the other way round
    // it failed the moment the convergence started winning everywhere,
    // which is the outcome that was wanted. The rule stays because the
    // fallback stays; if a board ever draws one again, this catches it.
    if (!boards) { assert(true); return; }
    for (const key of Object.keys(bundles)) {
      const looks = {};
      for (const p of bundles[key]) {
        const own = tracks[p.owner];
        assert(own, key + ': a rail owned by ' + p.owner + ', which has no line on the board');
        assert(p.stroke === own.stroke, key + ': ' + p.owner + "'s rail is drawn "
          + p.stroke + ' while its line is ' + own.stroke);
        // The treated lines are drawn wider than their nominal weight (the
        // paper knocked out of them is what the eye weighs), so this is the
        // drawn width against the drawn width, not against line_width.
        //
        // A pixel of slack, not half of one. A rail that has to cross
        // another line is drawn in pieces with rounded caps, and the piece
        // a bounding box reports comes back a fraction wider than the plain
        // run it was cut from. The rule being guarded is "not some other
        // line's weight", and on this board the weights are a whole stroke
        // apart.
        assert(Math.abs(p.width - own.width) <= 1, key + ': ' + p.owner + "'s rail is "
          + p.width.toFixed(1) + 'px on a ' + own.width.toFixed(1) + 'px line');
        looks[p.owner] = p.stroke + '/' + p.width.toFixed(1) + '/' + p.dash;
      }
      const seen = Object.keys(looks).map((o) => looks[o]);
      assert(new Set(seen).size === seen.length, key
        + ': two lines in one bundle are drawn identically (' + seen.join(' , ')
        + '), so the bundle cannot say who is there');
    }
  });
};
