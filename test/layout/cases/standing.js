'use strict';

// THE STANDING VIEWS GET THE SAME BAR AS THE FLAT ONES.
//
// Almost every geometry case runs on x-landscape, and a portrait panel is
// not a landscape one turned on its side: the axis that holds the day
// becomes the tall one, and a caption -- which stays horizontal, because
// text always does -- now takes its width out of the SAME axis the rails
// are spread along. So the two compete for one dimension in a way they
// never do lying down, and nothing was checking it.
//
// What that cost: the caption column was sized from the paper left over
// after both bundles, read through a function that reports each track's
// SOLVED distance from the spine -- and nothing has solved one at that
// point in the layout. Both sides measured zero, the two columns were
// handed the whole cross axis, and the solver was then left to place five
// rails in what remained. It put them in the left 45% of the panel with
// 420px of blank paper beside them and wrote every left-hand rail's
// captions off the edge of the board. Every case in this file passed
// throughout, because every case in this file was landscape.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, textLabels, pathsWhere, overlap,
    deepestIntrusion, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const STANDING = ['x-portrait'];
  const OVERLAP_TOL = 2, INTRUSION_TOL = 4;

  // MEASURED, NOT GUESSED. Standing up, a caption takes its WIDTH out of the
  // same axis the rails are spread along, and two captions on one line
  // twenty minutes apart are taller than the twenty minutes between them.
  // The caption solver slides and ladders them along the axis when the
  // board is flat; standing up it does neither, so they stack on one
  // column and lie across each other and across the next rail along.
  //
  // That is a real defect and it is not this change's to fix: it predates
  // every case in this file, which is exactly why the cases are here. See
  // issues.md E13.
  const WHY = 'portrait captions are not slid or laddered along the axis: E13';

  // A TIME IS WHOLE OR IT IS NOT THERE.
  //
  // Standing up, a caption's time row was capped to the column with
  // `overflow: hidden` and nothing else, so a range wider than the column
  // was sliced mid-glyph: "8 - 8:15an", "5:30 - 6:3", "3:30 - 4:30pr". A
  // cut time is worse than a missing one, because it reads as a DIFFERENT
  // time. Where the range will not fit, the start is written whole and the
  // end is left to the tick on the line, which is what carries it anyway.
  //
  // The reporter says whether a caption's time row is clipped; asked of a
  // reporter that cannot say, this would pass by saying nothing, so it
  // insists on an answer first.
  test('standing up, no caption shows a time cut off mid-character', () => {
    const bad = [];
    for (const name of STANDING) {
      for (const f of fixtures) {
        const labels = textLabels(layout(f, byName(name)));
        const captions = labels.filter((l) => /\bmetro-label\b/.test(l.cls));
        assert(!captions.length || captions.some((l) => 'clipped' in l),
          'the reporter does not say whether a time row is clipped, so this cannot check');
        captions.filter((l) => l.clipped).forEach((l) => bad.push(f.name + ': "' + l.text + '"'));
      }
    }
    assert(bad.length === 0, bad.length + ' caption(s) with a time cut off: ' + bad.slice(0, 6).join('; '));
  });
  // tight-pair came off this list when the caption pass started drawing the
  // board from both ends of the day and keeping the better one: two
  // meetings a few minutes apart stopped stacking on one column. The rest
  // still stack, because E13 is about sliding them ALONG the axis and that
  // is still not done.
  // double-booked came off this list when a name with nowhere to go
  // started being counted at its line's head instead of written over
  // another name.
  // all-day-every-track and regroups came off this list with E23: the
  // assignment can ask a name to step aside for another, which is the whole
  // of what these two boards needed.
  const OVERLAP_KNOWN = new Set(['busy-day', 'crew-day', 'five-lines',
    'long-event-day']);
  // three-day came off this list when the midnight date label moved to the
  // hour strip. Written into the map at the top of the first band, it was a
  // caption in open paper with nothing routed around it, and on a portrait
  // board a rail ran straight through it. On the strip it is booked like
  // every other note there, so there is nothing left for a rail to pierce.
  // regroups came off with E23 as well. three-day stays for a different
  // reason now: its convergence caption has nowhere on either side of its
  // pill that a member's own rail does not reach (E24).
  const PIERCE_KNOWN = new Set(['all-day-every-track', 'busy-day', 'crew-day',
    'five-lines', 'long-event-day', 'seven-lines', 'three-day']);


  for (const f of fixtures) {
    for (const vname of STANDING) {
      test('no two captions overlap standing up: ' + f.name + '/' + vname, () => {
        const rep = layout(f, byName(vname));
        const ls = textLabels(rep);
        const bad = [];
        for (let i = 0; i < ls.length; i++) {
          for (let j = i + 1; j < ls.length; j++) {
            const o = overlap(ls[i], ls[j]);
            if (o && o.w > OVERLAP_TOL && o.h > OVERLAP_TOL) {
              bad.push('"' + ls[i].text + '" x "' + ls[j].text + '" ('
                + Math.round(o.w) + 'x' + Math.round(o.h) + 'px)');
            }
          }
        }
        assert(bad.length === 0, bad.length + ' overlapping label pair(s): '
          + bad.slice(0, 6).join('; '));
      }, OVERLAP_KNOWN.has(f.name) && { known: WHY });
    }
  }

  for (const f of fixtures) {
    for (const vname of STANDING) {
      test('no rail runs through somebody else\'s caption standing up: '
        + f.name + '/' + vname, () => {
        // Standing up this is the one that catches a caption column wider
        // than the gap between two rails: the words simply lie across the
        // next line along.
        const rep = layout(f, byName(vname));
        const ls = textLabels(rep);
        const lines = pathsWhere(rep, 'track')
          .concat(pathsWhere(rep, 'branch'), pathsWhere(rep, 'fork'));
        const owns = {};
        for (const t of f.metro.legend) owns[t.name] = t.key;
        const bad = [];
        for (const box of ls) {
          for (const p of lines) {
            if (owns[box.text] && owns[box.text] === p.owner) continue;
            const d = deepestIntrusion(p.pts, box);
            if (d > INTRUSION_TOL) {
              bad.push('"' + box.text + '" pierced ' + Math.round(d) + 'px by '
                + p.role + ' ' + p.owner);
            }
          }
        }
        assert(bad.length === 0, bad.length + ' label(s) with a line through them: '
          + bad.slice(0, 6).join('; '));
      }, PIERCE_KNOWN.has(f.name) && { known: WHY });
    }
  }

};
