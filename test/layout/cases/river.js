'use strict';

// The river is the one part of the drawing allowed to be generated rather
// than derived from the day's events. It has to be stable for a given day
// (the panel redraws constantly; a river that moved every refresh would be
// a fault, not a flourish) and different on a different day. And it must
// stay decoration: nothing about where the events land may depend on it.

module.exports = function (test, h) {
  const { render, VIEWPORTS, fixtures, textLabels, assert } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');
  const base = fixtures.find((f) => f.name === 'busy-day');
  const withDate = (label) => JSON.parse(JSON.stringify(Object.assign({}, base.metro, { date_label: label })));

  function riverShape(rep) {
    return rep.paths.filter((p) => p.role === 'river')
      .map((p) => p.pts.map((q) => Math.round(q[0]) + ',' + Math.round(q[1])).join(' '))
      .join('|');
  }

  test('the same day always draws the same river', () => {
    const a = render(withDate('Tue, Sep 8'), ROOMY);
    const b = render(withDate('Tue, Sep 8'), ROOMY);
    assert(riverShape(a).length > 0, 'no river was drawn at all');
    assert(riverShape(a) === riverShape(b), 'the river moved between two renders of the same day');
  });

  test('a different day draws a different river', () => {
    const a = render(withDate('Tue, Sep 8'), ROOMY);
    const b = render(withDate('Wed, Sep 9'), ROOMY);
    assert(riverShape(a) !== riverShape(b), 'the river is identical on two different days');
  });

  test('the river changes nothing about where events land', () => {
    const a = render(withDate('Tue, Sep 8'), ROOMY);
    const b = render(withDate('Fri, Dec 25'), ROOMY);
    const placed = (rep) => (rep.debug.events || []).map((e) => e.slice(0, 8).join(',')).sort().join('|');
    assert(placed(a) === placed(b), 'event placement differs between two days — the seed is leaking into the layout');
  });

  test('the river stays behind the map, never over a label', () => {
    const rep = render(withDate('Tue, Sep 8'), ROOMY);
    const svgOrder = rep.paths.map((p) => p.role);
    const firstNonRiver = svgOrder.findIndex((r) => r !== 'river');
    const lastRiver = svgOrder.lastIndexOf('river');
    assert(lastRiver >= 0, 'no river drawn');
    assert(firstNonRiver === -1 || lastRiver < firstNonRiver,
      'the river is drawn after other map elements, so it would sit on top of them');
    assert(textLabels(rep).length > 0, 'no labels to check against');
  });
};
