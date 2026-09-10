'use strict';

// A shared event is a BUNDLE: one rail per line that belongs to it, each
// dropping from where its line runs to its own rung, running alongside the
// others for the event, and ending in the same tick every other rail gets.
//
// This reverses an earlier decision. Drawn as a comb once before, it read as
// a smudge, and the reason was that the rails were stacked on one minute
// with nothing between them. Everything below is a rule that made it read,
// and every one of them is here because its absence broke a picture that was
// looked at. They are stated as properties rather than as the positions that
// happened to come out, because the positions move with every board.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, textLabels, overlap, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const VIEWS = ['x-landscape', 'og-landscape'];

  // every bundle drawn on a board, as { key, rails: [{owner, pts, ...}] }
  function bundles(rep) {
    const by = {};
    for (const p of rep.paths) {
      if (!p.bundle) continue;
      (by[p.bundle] = by[p.bundle] || []).push(p);
    }
    return Object.keys(by).map((k) => ({ key: k, rails: by[k] }));
  }
  // a rail can be drawn in several pieces (it breaks where it tunnels), so
  // group by owner and take the whole run
  function railsByOwner(b) {
    const by = {};
    for (const p of b.rails) (by[p.owner] = by[p.owner] || []).push(p);
    return by;
  }
  // the flat part of a rail: where it has come to rest alongside the others
  function rungOf(pieces) {
    let best = null;
    for (const p of pieces) {
      for (let i = 1; i < p.pts.length; i++) {
        const dx = Math.abs(p.pts[i][0] - p.pts[i - 1][0]);
        const dy = Math.abs(p.pts[i][1] - p.pts[i - 1][1]);
        if (dx > dy && (!best || p.pts[i][0] > best.x)) best = { x: p.pts[i][0], y: p.pts[i][1] };
      }
    }
    return best ? best.y : null;
  }
  function dropOf(pieces) {
    // the axis position of the vertical: the leftmost point of the rail
    let x = Infinity;
    for (const p of pieces) for (const q of p.pts) x = Math.min(x, q[0]);
    return x;
  }

  test('a shared event draws one rail per line, not one for the group', () => {
    // The whole point of the change: "several people are here" said with a
    // single bold rail never says WHICH lines arrived.
    for (const vname of VIEWS) {
      const rep = layout(fixtures.find((f) => f.name === 'busy-day'), byName(vname));
      const bs = bundles(rep);
      assert(bs.length > 0, vname + ': no bundle drawn at all on a board with three shared events');
      for (const b of bs) {
        const owners = Object.keys(railsByOwner(b));
        assert(owners.length >= 2, vname + ': ' + b.key + ' drew ' + owners.length
          + ' rail(s); a shared event has at least two lines in it');
      }
    }
  });

  test('rails in a bundle never cross each other', () => {
    // Ordered by distance from the spine rather than by where the lines
    // actually run, two lines on opposite sides both read as "near": Work
    // dropped to the lower rung while Alex climbed to the upper one and the
    // rails crossed on the way. Stated as the invariant that matters: the
    // rungs come out in the same order as the lines they came from.
    for (const vname of VIEWS) {
      const rep = layout(fixtures.find((f) => f.name === 'busy-day'), byName(vname));
      for (const b of bundles(rep)) {
        const by = railsByOwner(b);
        const rows = Object.keys(by).map((o) => ({
          owner: o, rung: rungOf(by[o]), from: Math.min.apply(null, by[o].flatMap((p) => p.pts.map((q) => q[1]))),
          top: Math.min.apply(null, by[o].flatMap((p) => p.pts.map((q) => q[1]))),
        })).filter((r) => r.rung != null);
        // where each line RUNS is the far end of its own rail's vertical,
        // so order the owners by the height their rail started at
        const starts = {};
        for (const o of Object.keys(by)) {
          let hi = null;
          for (const p of by[o]) for (const q of p.pts) {
            if (hi == null || Math.abs(q[1] - rungOf(by[o])) > Math.abs(hi - rungOf(by[o]))) hi = q[1];
          }
          starts[o] = hi;
        }
        rows.sort((a, c) => starts[a.owner] - starts[c.owner]);
        for (let i = 1; i < rows.length; i++) {
          assert(rows[i].rung >= rows[i - 1].rung - 0.5, b.key + ' ' + vname + ': '
            + rows[i - 1].owner + ' comes from ' + Math.round(starts[rows[i - 1].owner])
            + ' and rests at ' + Math.round(rows[i - 1].rung) + ', while ' + rows[i].owner
            + ' comes from ' + Math.round(starts[rows[i].owner]) + ' and rests at '
            + Math.round(rows[i].rung) + ': those two rails swap places on the way down');
        }
      }
    }
  });

  test('a rail turns late only because another one passes its rung', () => {
    // A rail only has to turn after another if that other one's drop passes
    // through where this one will lie; then the first turns first, so its
    // vertical stands clear of where the second's horizontal begins.
    // Staggering all of them alike spread three drops across three minutes
    // to solve a conflict that existed between two of them, and the third
    // had no reason to be late.
    //
    // Stated per RAIL rather than per pair, because the constraint chains:
    // where Sam has to pass Kids, Kids turns after Sam, and Alex, passing
    // nobody, turns with Sam on the first minute. Alex is then earlier
    // than Kids without passing it, which is not a stagger, it is Kids
    // waiting for Sam. So: every rail that does not turn on the bundle's
    // first minute must be passed by one that turns before it, and every
    // rail whose drop passes another's rung must turn before that one.
    for (const vname of VIEWS) {
      const rep = layout(fixtures.find((f) => f.name === 'busy-day'), byName(vname));
      for (const b of bundles(rep)) {
        const by = railsByOwner(b);
        const owners = Object.keys(by);
        const drop = {}, rung = {}, reach = {};
        for (const o of owners) {
          drop[o] = dropOf(by[o]);
          rung[o] = rungOf(by[o]);
          const ys = by[o].flatMap((p) => p.pts.map((q) => q[1]));
          reach[o] = [Math.min.apply(null, ys), Math.max.apply(null, ys)];
        }
        // does o's own drop run through where c comes to rest?
        const passes = (o, c) => rung[c] != null && rung[c] > reach[o][0] + 1 && rung[c] < reach[o][1] - 1;
        const first = Math.min.apply(null, owners.map((o) => drop[o]));
        for (const c of owners) {
          if (drop[c] - first < 1) continue;              // turned on the first minute: nothing to justify
          const why = owners.filter((o) => o !== c && drop[o] < drop[c] - 0.5 && passes(o, c));
          assert(why.length > 0, b.key + ' ' + vname + ': ' + c + ' turns at '
            + Math.round(drop[c]) + ', ' + Math.round(drop[c] - first)
            + 'px after the first rail, and no rail that turns before it passes its rung');
        }
        // and the other way round: a rail that WILL cross another's rung
        // has to be out of the way before that one gets there
        for (const o of owners) {
          for (const c of owners) {
            if (o === c || !passes(o, c)) continue;
            assert(drop[o] < drop[c] - 0.5, b.key + ' ' + vname + ': ' + o
              + '\'s drop passes ' + c + '\'s rung but does not turn before it, so the two cross');
          }
        }
      }
    }
  });

  test('a rail crossing a line it does not belong to is broken for it', () => {
    // The mark for passing under. It needs no extra drawing: the trunk is
    // already painted by the time a branch goes over it, so a gap in the
    // branch shows the trunk through.
    for (const vname of VIEWS) {
      const rep = layout(fixtures.find((f) => f.name === 'busy-day'), byName(vname));
      const tracks = rep.paths.filter((p) => p.role === 'track');
      const bad = [];
      for (const b of bundles(rep)) {
        const by = railsByOwner(b);
        for (const owner of Object.keys(by)) {
          for (const t of tracks) {
            if (t.owner === owner) continue;
            for (const piece of by[owner]) {
              for (const q of piece.pts) {
                // a rail point sitting on a foreign trunk, with the trunk
                // running level there, is a crossing that was not broken
                let near = null;
                for (const tp of t.pts) {
                  if (Math.abs(tp[0] - q[0]) > 1.5) continue;
                  if (near == null || Math.abs(tp[1] - q[1]) < Math.abs(near - q[1])) near = tp[1];
                }
                if (near != null && Math.abs(near - q[1]) < 1.5) {
                  bad.push(owner + ' sits on ' + t.owner + ' at ' + Math.round(q[0]) + ',' + Math.round(q[1]));
                }
              }
            }
          }
        }
      }
      assert(bad.length === 0, vname + ': ' + bad.length + ' un-tunnelled crossing(s): '
        + bad.slice(0, 4).join('; '));
    }
  });

  test('a bundle never parks on the hour river', () => {
    // The axis runs down the middle of the bundle of lines. A shared event
    // sitting on it would be reading the day through its own rails.
    for (const vname of VIEWS) {
      const rep = layout(fixtures.find((f) => f.name === 'busy-day'), byName(vname));
      // The debug dump is in LAYOUT px and everything sampled off the page
      // is in SCREEN px, which are the same thing only where the framework
      // is not zooming: on an X (2x) this compared a rail's real position
      // with a spine three hundred pixels above where it is drawn, and the
      // case could not have failed there whatever the picture did.
      const spine = rep.debug.spineC * (rep.debug.Z || 1);
      for (const b of bundles(rep)) {
        const by = railsByOwner(b);
        for (const owner of Object.keys(by)) {
          const rung = rungOf(by[owner]);
          if (rung == null) continue;
          assert(Math.abs(rung - spine) > 4, b.key + ' ' + vname + ': ' + owner
            + ' rests at ' + Math.round(rung) + ', on the hour river at ' + Math.round(spine));
        }
      }
    }
  });

  test('a bundle\'s label clears every rail in it', () => {
    // The lane the event was given is where the bundle STARTS, not where it
    // ends: measured from there the label sat on the rails that landed
    // beyond it.
    for (const vname of VIEWS) {
      const rep = layout(fixtures.find((f) => f.name === 'busy-day'), byName(vname));
      const labels = textLabels(rep);
      const bad = [];
      for (const b of bundles(rep)) {
        const title = b.key.split('|')[0];
        const box = labels.find((l) => l.text.indexOf(title) >= 0);
        if (!box) continue;
        for (const p of b.rails) {
          for (const q of p.pts) {
            if (q[0] >= box.x && q[0] <= box.x + box.w && q[1] >= box.y && q[1] <= box.y + box.h) {
              bad.push(title + ' has ' + p.owner + '\'s rail inside its own label');
              break;
            }
          }
        }
      }
      assert(bad.length === 0, vname + ': ' + bad.slice(0, 3).join('; '));
    }
  });

  test('an event too short for a bundle keeps the interchange tie', () => {
    // A moment has no span to run alongside anybody for, and the tie and
    // its ring say the same thing in a mark that fits.
    const rep = layout(fixtures.find((f) => f.name === 'moment-day'), byName('x-landscape'));
    const bs = bundles(rep);
    for (const b of bs) {
      assert(b.key.indexOf('Family Dinner') < 0,
        'the zero-length shared event was drawn as a bundle: ' + b.key);
    }
    const ties = rep.paths.concat(rep.rects).filter((p) => p.role === 'capsule');
    assert(ties.length > 0, 'the moment lost its tie as well as its bundle');
  });
};
