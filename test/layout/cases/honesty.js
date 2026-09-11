'use strict';

// The map's whole job is to say WHEN. Everything else in this suite checks
// that the drawing is well formed — lines meet, nothing overlaps, markers
// sit where they belong — and all of it passed while a label was being
// drawn two hours before the event it named, because the branch carrying it
// ran backwards to find room. Well formed and truthful are different
// properties, and only one of them matters to someone reading the board.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, textLabels, eventsIn, assert } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');

  // where a minute sits on the axis, derived from the hour labels actually
  // drawn — no need to re-implement the layout's own scale
  //
  // A board can carry a RUN of days, and an hour label says only the time,
  // not which day: read in clock order, "02:00" from the second day sorted
  // itself in front of "20:00" from the first and the scale came out
  // backwards, so every label on the board looked as if it were drawn
  // before its own event. Read along the axis instead, and every time the
  // clock goes backwards a midnight has been passed.
  function axisReader(rep) {
    const seen = rep.labels
      .filter((l) => (' ' + l.cls + ' ').indexOf(' metro-hour ') >= 0 && /^\d{1,2}:\d{2}/.test(l.text))
      .map((l) => {
        const [hh, mm] = l.text.split(':').map(Number);
        return { clock: hh * 60 + mm, x: l.x + l.w / 2 };
      })
      .sort((a, b) => a.x - b.x);
    const marks = [];
    let day = 0, prev = null;
    for (const m of seen) {
      if (prev != null && m.clock < prev) day++;
      prev = m.clock;
      marks.push({ min: day * 1440 + m.clock, x: m.x });
    }
    if (marks.length < 2) return null;
    return function (min) {
      let lo = marks[0], hi = marks[marks.length - 1];
      for (let i = 0; i < marks.length - 1; i++) {
        if (min >= marks[i].min && min <= marks[i + 1].min) { lo = marks[i]; hi = marks[i + 1]; break; }
      }
      if (hi.min === lo.min) return lo.x;
      return lo.x + (min - lo.min) / (hi.min - lo.min) * (hi.x - lo.x);
    };
  }

  for (const f of fixtures) {
    test('no label is drawn before the event it names: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const at = axisReader(rep);
      if (!at) { assert(true); return; }
      const labels = textLabels(rep);
      const bad = [];
      for (const item of f.metro.events) {
        // the drawn label for this event, matched on its title text
        const box = labels.filter((l) => l.text.indexOf(item.title) >= 0)[0];
        if (!box) continue; // dropped, or ellipsised past recognition
        const startX = at(item.start_min);
        // a label may overhang to the RIGHT of its event as far as it likes;
        // being to the LEFT of its own start time is the map lying
        const slack = 90; // the label carries its time tag and starts a little before the tick
        if (box.x + box.w < startX - slack) {
          bad.push('"' + item.title + '" ends at x' + Math.round(box.x + box.w)
            + ' but starts at x' + Math.round(startX));
        }
      }
      assert(bad.length === 0,
        bad.length + ' label(s) drawn before their own time: ' + bad.slice(0, 4).join('; '));
    });
  }

  // A caption belongs to ONE branch, and it says so by sitting beside it.
  // Slid far enough along its lane it stops pointing at anything: the
  // reader sees a rail with no name and a name with no rail, and pairs the
  // name with whatever rail happens to be nearest. This is the failure the
  // layout's own scoring calls "adrift" — it is scored while lanes are
  // being chosen, and anything that moves a label AFTER that (a dodge
  // around an interchange, say) has to respect the same limit.
  for (const f of fixtures) {
    for (const vname of ['x-landscape', 'og-landscape']) {
      test('every label stays beside its own branch: ' + f.name + '/' + vname, () => {
        const rep = layout(f, VIEWPORTS.find((v) => v.name === vname));
        const bad = [];
        for (const e of eventsIn(rep)) {
          if (e.status === 'dropped' || e.textStart == null) continue;
          let off;
          if (e.mark || e.shared) {
            // A mark has no branch and no elbow. What it has is the stretch
            // of its own line from its start dot to its end tick, and its
            // name belongs beside that: overlapping it, or near enough
            // either end to read as the same thing. Measured as the gap
            // between the two spans along the axis, which is zero whenever
            // the words sit over the run they name.
            off = e.textStart > e.endA ? e.textStart - e.endA
                : e.textStart + e.textLen < e.nodeA ? e.nodeA - (e.textStart + e.textLen)
                : 0;
          } else {
            // where the caption belongs: just past the elbow, on the side the
            // branch runs
            const want = e.dir > 0 ? e.elbow : e.elbow - e.textLen;
            off = Math.abs(e.textStart - want);
          }
          if (off > e.textLen * 0.6 + 12) {
            bad.push('"' + e.title + '" is ' + Math.round(off) + 'px from its own '
              + (e.mark ? 'run' : 'branch') + ' (label is '
              + Math.round(e.textLen) + 'px wide)');
          }
        }
        assert(bad.length === 0, bad.length + ' adrift label(s): ' + bad.slice(0, 4).join('; '));
      });
    }
  }
};
