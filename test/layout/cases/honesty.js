'use strict';

// The map's whole job is to say WHEN. Everything else in this suite checks
// that the drawing is well formed — lines meet, nothing overlaps, markers
// sit where they belong — and all of it passed while a label was being
// drawn two hours before the event it named, because the branch carrying it
// ran backwards to find room. Well formed and truthful are different
// properties, and only one of them matters to someone reading the board.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, textLabels, assert } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');

  // where a minute sits on the axis, derived from the hour labels actually
  // drawn — no need to re-implement the layout's own scale
  function axisReader(rep) {
    const marks = rep.labels
      .filter((l) => (' ' + l.cls + ' ').indexOf(' metro-hour ') >= 0 && /^\d{1,2}:\d{2}/.test(l.text))
      .map((l) => {
        const [hh, mm] = l.text.split(':').map(Number);
        return { min: hh * 60 + mm, x: l.x + l.w / 2 };
      })
      .sort((a, b) => a.min - b.min);
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
      for (const item of f.metro.items.filter((i) => i.type === 'event')) {
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
};
