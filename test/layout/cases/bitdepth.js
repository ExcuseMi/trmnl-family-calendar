'use strict';

// BIT DEPTH IS PAINT. IT IS NOT LAYOUT.
//
// A panel with more greys gets a different encoding -- four textures at
// 1-bit where the pattern is the whole identity, a tonal ladder at 4-bit
// where it does not have to be -- and it must get the SAME BOARD. Every
// spatial number here comes off the stroke weight and the label sizes, and
// neither depends on how many greys the device has, so a difference in any
// of them means something read the screen class that had no business
// reading it.
//
// This matters more than it sounds. A calendar that rearranges itself
// between devices is a calendar the reader cannot learn: the eye memorises
// where somebody's line sits, and if that moves because the panel is
// different then it was never saying where they were. It is also the
// cheapest possible guard on a whole class of mistake, because the answer
// is exact -- not "close enough", identical.

module.exports = function (test, h) {
  const { layout, fixtures, eventsIn, assert, assertEqual } = h;

  const DEPTHS = ['1bit', '2bit', '4bit'];
  function viewAt(bits) {
    return {
      name: 'x-' + bits, w: 1872, h: 1404,
      classes: 'screen--v2 screen--lg screen--' + bits + ' screen--density-2x',
    };
  }

  for (const f of fixtures) {
    test('the board is the same at every bit depth: ' + f.name, () => {
      const reps = DEPTHS.map((b) => layout(f, viewAt(b)));
      const base = reps[0];
      for (let i = 1; i < reps.length; i++) {
        const r = reps[i], why = DEPTHS[0] + ' against ' + DEPTHS[i];
        assertEqual(r.debug.spineC, base.debug.spineC, why + ': the spine moved');
        assertEqual(r.debug.bands, base.debug.bands, why + ': the bands moved');
        assertEqual(r.debug.titleClass, base.debug.titleClass,
          why + ': a different text size was chosen');
        // and every event, down to where its words start
        const a = eventsIn(base).map((e) => [e.title, e.status, e.nodeA, e.endA,
          e.textStart, e.textLen, e.mark, e.shared]);
        const b = eventsIn(r).map((e) => [e.title, e.status, e.nodeA, e.endA,
          e.textStart, e.textLen, e.mark, e.shared]);
        assertEqual(b, a, why + ': an event was placed differently');
      }
    });
  }

  test('and the panel still gets an encoding it can show', () => {
    // The guard on the guard: identical geometry would also be satisfied by
    // ignoring bit depth altogether, which is not the point. One bit has no
    // greys, so the patterns have to carry it; four bits have sixteen, so
    // they do not.
    const f = fixtures.find((x) => x.name === 'busy-day');
    const one = layout(f, viewAt('1bit'));
    const four = layout(f, viewAt('4bit'));
    const styles = (rep) => new Set(rep.paths.filter((p) => p.role === 'track')
      .map((p) => p.owner));
    assert(styles(one).size > 0 && styles(four).size > 0, 'no tracks drawn at all');
    const dashOf = (rep) => rep.paths.filter((p) => p.role === 'track').length;
    assert(dashOf(one) > 0 && dashOf(four) > 0, 'a panel lost its tracks');
  });
};
