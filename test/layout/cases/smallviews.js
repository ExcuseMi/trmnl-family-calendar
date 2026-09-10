'use strict';

// A half and a quadrant are slots inside a whole screen, and they are where
// this plugin has the least room and the most to say. Two things were
// spending what room there is on nothing.

module.exports = function (test, h) {
  const { render, fixtures, textLabels, overlap, assert } = h;

  const OG = 'screen--og screen--md screen--1bit screen--density-1x';
  const SLOTS = [
    { view: 'full', name: 'og-quadrant', w: 800, h: 480, slot: { w: 400, h: 240 }, classes: OG },
    { view: 'full', name: 'og-half-horizontal', w: 800, h: 480, slot: { w: 800, h: 240 }, classes: OG },
    { view: 'full', name: 'og-half-vertical', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: OG },
  ];
  const busy = fixtures.find((f) => f.name === 'busy-day');

  // The header hides the date and the weather at this size for want of
  // room, which leaves a band carrying the mark and the word "Today". On a
  // quadrant that band was a third of the board.
  test('a tiny view spends no height on a header that says nothing', () => {
    for (const v of SLOTS.slice(0, 2)) {
      const rep = render(busy.metro, v);
      const top = Math.min.apply(null, textLabels(rep).map((l) => l.y).concat([Infinity]));
      assert(rep.canvas.h >= v.slot.h * 0.9, v.name + ': the canvas is only '
        + Math.round(rep.canvas.h) + 'px of a ' + v.slot.h + 'px slot, so something above it is '
        + 'still taking the height');
      assert(top < v.slot.h * 0.2, v.name + ': the topmost thing drawn starts '
        + Math.round(top) + 'px down a ' + v.slot.h + 'px slot');
    }
  });

  // "+3 earlier" and the clock badge are both pinned to the head of the
  // scale. On a quadrant the strip is a few hours wide and they were
  // written straight over each other: "+3 earlier1:32am".
  const EARLY = JSON.parse(JSON.stringify(busy.metro));
  EARLY.day_start_min = 600;             // events before this become "+n earlier"
  EARLY.now_min = 605;                   // and the clock sits at the very head

  test('the clock badge never lands on the overflow note', () => {
    for (const v of SLOTS) {
      const rep = render(EARLY, v);
      const notes = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-axis-note ') >= 0);
      const bad = [];
      for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
          const o = overlap(notes[i], notes[j]);
          if (o && o.w > 1 && o.h > 1) bad.push('"' + notes[i].text + '" over "' + notes[j].text + '"');
        }
      }
      assert(bad.length === 0, v.name + ': ' + bad.join('; '));
    }
  });

  // And when it does not fit beside the clock, the count is the half worth
  // keeping: "+3" says as much as "+3 earlier" does at the head of a scale.
  test('an overflow note that cannot fit its word keeps its number', () => {
    const rep = render(EARLY, SLOTS[0]);
    const notes = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-axis-note ') >= 0);
    const counts = notes.filter((l) => /^\+\d/.test(l.text));
    assert(counts.length > 0, 'a board with events off both ends of the window drew no overflow note at all');
    for (const n of counts) {
      assert(n.x + n.w <= rep.canvas.w + 1 && n.x >= -1,
        'the note "' + n.text + '" runs off the scale');
    }
  });
};
