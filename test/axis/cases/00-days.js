'use strict';

// How many days the board draws.
//
// Decided here, against the canvas, and not in transform: transform sends
// what it has, and only the client knows how much axis there is to give.

module.exports = function (test, h) {
  const { fit, ev, DAY, assert, assertEqual } = h;

  test('a wide board draws the whole run', () => {
    const m = fit({ axisPx: 4000, content: [ev(0, '09:00', '10:00'), ev(1, '09:00', '10:00'), ev(2, '09:00', '10:00')] });
    assertEqual(m.dayCount, 3, 'a 4000px axis can give three days a readable hour');
  });

  test('a narrow board draws fewer days rather than an unreadable three', () => {
    const wide = fit({ axisPx: 4000, content: [ev(0, '09:00', '17:00'), ev(1, '09:00', '17:00'), ev(2, '09:00', '17:00')] });
    const narrow = fit({ axisPx: 700, content: [ev(0, '09:00', '17:00'), ev(1, '09:00', '17:00'), ev(2, '09:00', '17:00')] });
    assert(narrow.dayCount < wide.dayCount, 'a 700px axis drew as many days as a 4000px one ('
      + narrow.dayCount + '), so the count is not being decided against the canvas');
    assert(narrow.dayCount >= 1, 'it dropped below one day');
  });

  test('one day is always a valid board', () => {
    // However little room there is. A board with no days on it is not a
    // smaller board, it is a blank one.
    for (const px of [2000, 800, 400, 200, 80]) {
      const m = fit({ axisPx: px, content: [ev(0, '09:00', '17:00')] });
      assert(m.dayCount >= 1, 'at ' + px + 'px the board drew ' + m.dayCount + ' days');
    }
  });

  test('an empty last day is not worth an axis', () => {
    // Three days of which the third has nothing on it is a two-day board
    // with a night stuck on the end.
    const m = fit({ axisPx: 4000, content: [ev(0, '09:00', '10:00'), ev(1, '09:00', '10:00')] });
    assertEqual(m.dayCount, 2, 'the empty third day was drawn anyway');
  });

  test('more room never means fewer days', () => {
    const content = [ev(0, '08:00', '18:00'), ev(1, '08:00', '18:00'), ev(2, '08:00', '18:00')];
    let prev = 0;
    for (let px = 300; px <= 5000; px += 100) {
      const n = fit({ axisPx: px, content: content }).dayCount;
      assert(n >= prev, 'at ' + px + 'px it draws ' + n + ' days, where ' + (px - 100)
        + 'px drew ' + prev);
      prev = n;
    }
  });

  test('a day boundary is marked between every pair of days, and never at the ends', () => {
    const m = fit({ axisPx: 4000, content: [ev(0, '09:00', '10:00'), ev(1, '09:00', '10:00'), ev(2, '09:00', '10:00')] });
    assertEqual(m.boundaries.map((b) => b.min), [DAY, 2 * DAY], 'the midnights are wrong');
    assertEqual(m.boundaries.length, m.dayCount - 1,
      'a run of ' + m.dayCount + ' days has ' + m.boundaries.length + ' midnights inside it');
  });

  test('a single day has no midnight to cross', () => {
    const m = fit({ axisPx: 800, content: [ev(0, '09:00', '17:00')] });
    assertEqual(m.dayCount, 1);
    assertEqual(m.boundaries, [], 'a one-day board drew a day boundary');
  });
};
