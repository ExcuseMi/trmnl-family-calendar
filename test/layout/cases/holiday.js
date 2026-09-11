'use strict';

// A HOLIDAY IS A PROPERTY OF THE DAY, SO IT IS STATED WHERE THE DAY IS.
//
// An all-day event is a state a LINE is in: half term, leave, a night
// shift. It is declared at that line's head, and both ends of that line
// become open chevrons because its day is a slice of something longer
// (rules 54 and 55, cases/all-day.js).
//
// A public holiday is not that. Nobody owns Christmas Day: it has no hour,
// so a scale of hours is the wrong place for it and drawing it there
// prints the board's own window back as its hours; it has no owner, so a
// line's head is the wrong place for it and puts a whole country against
// whoever the rules happened to route it to; and a line of its own is the
// worst of the three, because a line costs a band of the cross axis and a
// holiday is not a person.
//
// So it is named in the header, beside the date. These cases hold it
// there: that it is said once, that it is said nowhere else, that it opens
// nobody's ends, and above all that it is FREE -- a board with a holiday
// draws the same map as the same board without one, because the whole
// argument for the header over the three alternatives is that the map does
// not pay for it.
//
// The header is LIQUID, not script, so a fixture cannot reach it: the
// holidays go in as `liquidExtra`, which patches the demo data the build
// reads, the same way the banner cases do.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, assert, assertEqual } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');
  const busy = fixtures.find((f) => f.name === 'busy-day');
  // A SLOT NARROW ENOUGH FOR A COMPACT HEADER, which none of the shared
  // viewports is: an OG full board is 800x480 and escapes `compact`, and
  // og-half is narrow enough to be `tiny`, where the header goes entirely.
  // The ladder between the two is a real size a mashup gives a board, and
  // it is the only place the give-way order can be watched.
  const COMPACT = { name: 'og-slot-600', w: 800, h: 480, slot: { w: 600, h: 480 },
    classes: 'screen--og screen--md screen--1bit screen--density-1x' };

  const CHRISTMAS = { holidays: [{ title: 'Christmas Day', day_index: 0, day_span: 1, day_label: null }] };
  const BREAK = { holidays: [{ title: 'Spring Break', day_index: 2, day_span: 5, day_label: 'Day 3 of 5' }] };
  const TWO = { holidays: [
    { title: 'Christmas Day', day_index: 0, day_span: 1, day_label: null },
    { title: 'School Holiday', day_index: 4, day_span: 14, day_label: 'Day 5 of 14' },
  ] };

  function headerItems(rep, cls) {
    return ((rep.header && rep.header.items) || [])
      .filter((i) => (' ' + i.cls + ' ').indexOf(' ' + cls + ' ') >= 0);
  }

  test('the harness can see the header at all', () => {
    // Otherwise every case below passes by having nothing to look at: the
    // header is not inside the canvas, so it reached no report until it
    // was asked for by name.
    const rep = layout(busy, ROOMY);
    assert(rep.header && rep.header.items.length > 0, 'no header was reported');
    assertEqual(headerItems(rep, 'metro-date').length, 1,
      'the header has no date for a holiday to sit beside');
  });

  test('the day is named in the header, once', () => {
    const rep = layout(busy, ROOMY, CHRISTMAS);
    assertEqual(headerItems(rep, 'metro-holiday-name').map((i) => i.text), ['Christmas Day'],
      'the holiday is not stated beside the date, or is stated twice');
  });

  test('it sits with the date rather than below it', () => {
    // Not a second row. The header's height comes off the canvas, so a row
    // of its own would be the map paying for the holiday after all, which
    // is the whole thing this shape avoids.
    const rep = layout(busy, ROOMY, CHRISTMAS);
    const date = headerItems(rep, 'metro-date')[0];
    const name = headerItems(rep, 'metro-holiday-name')[0];
    const share = Math.min(date.y + date.h, name.y + name.h) - Math.max(date.y, name.y);
    assert(share > Math.min(date.h, name.h) * 0.5,
      'the holiday is on its own row: date at y=' + Math.round(date.y)
      + ', holiday at y=' + Math.round(name.y));
    assert(name.x > date.x, 'the holiday should read after the date it qualifies');
  });

  for (const v of VIEWPORTS) {
    test('the map is not charged for it: ' + v.name, () => {
      // THE ARGUMENT FOR THE HEADER, stated as an assertion. A band on the
      // scale, a line of its own, a row at every head: each of the three
      // costs the map depth or width, on a board that is already 96%
      // spent. This one costs nothing, at any size, and if it ever starts
      // costing something the reason for having chosen it is gone.
      const without = layout(busy, v);
      const withIt = layout(busy, v, CHRISTMAS);
      assertEqual(Math.round(withIt.header.h), Math.round(without.header.h),
        'the header grew: it was supposed to have room on a row it already draws');
      assertEqual(Math.round(withIt.canvas.h), Math.round(without.canvas.h),
        'the canvas lost height to a holiday');
      assertEqual(withIt.paths.length, without.paths.length,
        'the drawing changed. A holiday is not a line, not a branch and not a mark');
    });
  }

  test('nothing is drawn for it on the scale of hours', () => {
    // The defect this replaces: an all-day entry drawn as an event
    // spanning the visible window, so the board printed its own window
    // back as the holiday's hours. A holiday has no hour at all.
    const rep = layout(busy, ROOMY, CHRISTMAS);
    for (const l of rep.labels) {
      assert(l.text.indexOf('Christmas Day') < 0,
        '"Christmas Day" is written on the map at ' + Math.round(l.x) + ','
        + Math.round(l.y) + '. It has no hour to put it at.');
    }
  });

  test('it declares nobody to be away', () => {
    // An all-day event opens both ends of its line into chevrons, because
    // that line's day really is a slice of something longer. A holiday
    // says nothing about any line: on Christmas Day everybody's line still
    // starts and ends on Christmas Day.
    const rep = layout(busy, ROOMY, CHRISTMAS);
    assertEqual(pathsWhere(rep, 'terminal-open').length, 0,
      'a holiday opened a line\'s ends as if that person were on it');
    assertEqual(pathsWhere(rep, 'origin-tie').length, 0,
      'a holiday tied the heads together as if it were one of them');
    const routeRows = rep.labels.filter((l) => (' ' + l.cls + ' ').indexOf(' metro-route ') >= 0);
    assertEqual(routeRows.length, 0, 'a holiday was declared at a line\'s head');
  });

  test('inside a range it says which day of it this is', () => {
    // "Spring Break" runs a week and the board draws one day of it. That
    // ordinal is the only thing telling the Monday from the Thursday, and
    // it is the fact a household actually wants.
    const rep = layout(busy, ROOMY, BREAK);
    assertEqual(headerItems(rep, 'metro-holiday-name').map((i) => i.text), ['Spring Break']);
    const day = headerItems(rep, 'metro-holiday-day');
    assertEqual(day.length, 1, 'the range said nothing about where in it we are');
    assert(day[0].text.indexOf('Day 3 of 5') >= 0,
      'expected the ordinal, got ' + JSON.stringify(day[0].text));
  });

  test('a squeezed header keeps the name and drops the ordinal', () => {
    // The same order of giving way as the condition and the alert lines:
    // which day of the holiday it is EXPLAINS, and a header with no room
    // to explain still has to name the day.
    const rep = layout(busy, COMPACT, BREAK);
    assertEqual(headerItems(rep, 'metro-holiday-name').filter((i) => i.shown).map((i) => i.text),
      ['Spring Break'], 'the name went with the ordinal, or the header went entirely');
    assertEqual(headerItems(rep, 'metro-holiday-day').filter((i) => i.shown).length, 0,
      'the ordinal survived into a compact header, where the name is what matters');
    assertEqual(headerItems(rep, 'metro-cond').filter((i) => i.shown).length, 0,
      'the header is not actually compact here, so this case is watching nothing');
  });

  test('a day carrying two holidays names one of them, and keeps the weather', () => {
    // transform.js hands the header one name. Two of them came out as
    // "Christmas D" and "School Holid", each cut mid word, with the
    // ordinal wrapped underneath and the header a row taller: naming the
    // day is the header's job, enumerating it is not. The second name is
    // in the payload's own cap, not in the drawing, so this is the test
    // that keeps the drawing honest about it.
    const rep = layout(busy, ROOMY, TWO);
    assertEqual(headerItems(rep, 'metro-holiday-name').map((i) => i.text), ['Christmas Day'],
      'the header drew more than one name, or the wrong one');
    const wx = headerItems(rep, 'metro-temp').filter((i) => i.shown);
    assertEqual(wx.length, 1, 'the weather was pushed off the header');
    const name = headerItems(rep, 'metro-holiday-name')[0];
    assert(name.x + name.w <= wx[0].x + 1,
      'the holiday runs into the weather: it ends at ' + Math.round(name.x + name.w)
      + ' and the temperature starts at ' + Math.round(wx[0].x));
  });

  test('a board with no holiday says nothing about one', () => {
    const rep = layout(busy, ROOMY);
    assertEqual(headerItems(rep, 'metro-holiday').length, 0,
      'an empty holiday list still drew its container');
  });
};
