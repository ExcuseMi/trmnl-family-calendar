'use strict';

// RULE 37: A CAPTION MAY NOT WALK PAST ANOTHER LINE TO FIND ROOM.
//
// "A name on the far side of somebody else's rail reads as theirs." Nothing
// checked it, and the rule-check skill found it by eye on a rendered board:
// "Skate Park" belongs to Bart, whose dot and end tick carry it, but the
// words sit below Lisa's rail and read as Lisa's evening.
//
// MEASURED AS THE RULE IS WORDED, which took two attempts. Asking which line
// is NEAREST the words marks about thirty captions across these boards, and
// it is the wrong question: captions hang in lanes that stack outward, so a
// caption two lanes from its own rail is naturally nearer the neighbour
// without ever having passed it. Walking past is the thing the rule names,
// and it is exactly checkable: is another line's rail BETWEEN the words and
// the line they name, at the caption's own point along the day.
module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, textLabels, pathsWhere, assert } = h;
  const byName = (n) => VIEWPORTS.find((v) => v.name === n);

  // E20. Every one of these was measured, not guessed, and each is a caption
  // that has crossed a neighbour to find paper. They are the same root as
  // E19: placement is greedy and takes the least-bad spot left, and on these
  // boards that spot is on the wrong side of somebody.
  const WHY = 'a caption crosses a neighbour to find room: E20';
  // TWO OF THE TEN CAME OFF THIS LIST when the captions started being assigned
  // together instead of one after another (E23), and shared-long-event joined
  // it. What is left is a different statement from what E20 made: not "the
  // greedy pass took the least-bad spot" -- the assignment can ask a
  // neighbour to move now -- but "on this line every position for this name
  // is a walk-past, a rail through the words, or a gap". Four orderings of
  // those three were measured on the whole suite; the one that ships costs
  // the fewest boards. See E24.
  const WHY24 = 'every position for this name is a walk-past, a pierce or a gap: E24';
  const KNOWN = new Set([
    'five-lines/x-landscape', 'five-lines/og-landscape',
    'crew-day/x-landscape', 'crew-day/og-landscape',
    'long-event-day/og-landscape',
    'seven-lines/x-landscape', 'seven-lines/og-landscape',
    'regroups/og-landscape', 'shared-long-event/og-landscape',
  ]);

  // Where a line sits across the board at one point along the day. Sampled
  // from the drawing rather than from its baseline, because a line climbing
  // into a hold is not where its baseline says it is.
  function crossAt(paths, a, ai, ci) {
    let best = null;
    for (const p of paths) {
      for (const q of p.pts) {
        const d = Math.abs(q[ai] - a);
        if (!best || d < best.d) best = { d: d, c: q[ci] };
      }
    }
    return best && best.d < 40 ? best.c : null;
  }

  for (const f of fixtures) {
    for (const vname of ['x-landscape', 'og-landscape']) {
      test('no caption walks past another line: ' + f.name + '/' + vname, () => {
        const rep = layout(f, byName(vname));
        const ai = rep.debug.horizontal ? 0 : 1, ci = rep.debug.horizontal ? 1 : 0;
        const byOwner = {};
        for (const p of pathsWhere(rep, 'track')) (byOwner[p.owner] = byOwner[p.owner] || []).push(p);
        const past = [];
        for (const l of textLabels(rep).filter((x) => /\bmetro-label\b/.test(x.cls))) {
          const ev = f.metro.events.find((e) => l.text.indexOf(e.title) >= 0);
          if (!ev || !byOwner[ev.owner]) continue;
          const mine = [ev.owner].concat(ev.co_owners || []);
          const aMid = ci ? l.x + l.w / 2 : l.y + l.h / 2;
          const cLo = ci ? l.y : l.x, cHi = ci ? l.y + l.h : l.x + l.w;
          const own = crossAt(byOwner[ev.owner], aMid, ai, ci);
          if (own == null) continue;
          // The paper between the words and their own rail, which is what
          // nobody else's rail may be sitting in.
          const gapLo = own < cLo ? own : cHi, gapHi = own < cLo ? cLo : own;
          if (gapHi - gapLo < 2) continue;
          for (const o of Object.keys(byOwner)) {
            if (mine.indexOf(o) >= 0) continue;
            const c = crossAt(byOwner[o], aMid, ai, ci);
            if (c != null && c > gapLo + 1 && c < gapHi - 1) {
              past.push('"' + ev.title + '" belongs to ' + ev.owner + ' but sits past ' + o);
              break;
            }
          }
        }
        assert(past.length === 0, past.length + ' caption(s) on the far side of another line: '
          + [...new Set(past)].slice(0, 4).join('; '));
      }, KNOWN.has(f.name + '/' + vname) && { known: WHY24 });
    }
  }
  // ---- THE TICK FROM A STOP TO A NAME THAT HAS TRAVELLED -----------------
  //
  // A caption against its own rail starts at the ring and needs no pointer.
  // One pushed out to a lane, or slid along the line to find paper, is the
  // one the eye cannot pair with a dot, and that is what the tick is for.
  //
  // This case exists because the first version of it drew NOTHING, on every
  // board, and looked entirely correct doing so: it skipped any event with
  // `_capLead` set, on the reading that such an event already gets a leader
  // from the station pass. That flag is set on almost every event -- it
  // means the SHAPE may carry a leader, not that this one does -- so the
  // guard swallowed the lot. Nothing failed, no geometry moved, and the
  // feature was simply absent. So the assertion is about ink on the board.
  test('a caption that has travelled from its stop is ticked back to it', () => {
    const rep = layout(fixtures.find((f) => f.name === 'five-lines'),
      byName('x-landscape'));
    const ticks = (rep.rects || []).filter((r) => r.role === 'caption-lead')
      .concat((rep.painted || []).filter((p) => p.role === 'caption-lead' && false));
    assert(ticks.length > 0,
      'no caption carries a tick back to its stop on a board with lane captions');
  });

  test('a tick keeps its distance from the dot and from the words', () => {
    // Five pixels at the ring, so the two do not read as one lollipop, and
    // clear of the caption box, so it points AT the name instead of
    // underlining it. Checked as overlap of the drawn boxes, which is what
    // either failure would look like.
    for (const vn of ['x-landscape', 'og-landscape']) {
      const v = byName(vn);
      for (const f of fixtures) {
        let rep;
        try { rep = layout(f, v); } catch (e) { continue; }
        const ticks = (rep.rects || []).filter((r) => r.role === 'caption-lead');
        if (!ticks.length) continue;
        const dots = (rep.circles || []).filter((c) => c.role === 'stop' || c.role === 'station-ring')
          .concat((rep.rects || []).filter((r) => r.role === 'stop' || r.role === 'stop-start'));
        const caps = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-label ') >= 0);
        // The tick leans, so its bounding box is most of a triangle the ink
        // never enters: asked as a box test this reported a tick "running
        // into" Team Standup on busy-day, and the crossing was the empty
        // corner. Segment against box is the question that was meant.
        const segHitsBox = (p, q, b) => {
          const steps = 24;
          for (let i = 0; i <= steps; i++) {
            const x = p[0] + (q[0] - p[0]) * i / steps;
            const y = p[1] + (q[1] - p[1]) * i / steps;
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
          }
          return false;
        };
        for (const t of ticks) {
          if (!t.ends) continue;
          const [p, q] = t.ends;
          for (const d of dots) {
            assert(!segHitsBox(p, q, d), f.name + '/' + vn + ': a tick runs into a stop mark');
          }
          for (const c of caps) {
            assert(!segHitsBox(p, q, c), f.name + '/' + vn + ': a tick runs into "' + c.text + '"');
          }
        }
      }
    }
  });
};
