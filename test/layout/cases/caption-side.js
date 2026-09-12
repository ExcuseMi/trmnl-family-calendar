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
};
