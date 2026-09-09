// ONE EVENT, DRAWN ONCE — and the lines that share it laid out together.
//
// Two calendars can describe the same thing. Bart's "L6 School Day" and
// Lisa's "L2 School Day" both rename to "School Day", run the same hours,
// and are the same school day; they arrived as two events and were drawn as
// two stations with two captions, on lines that could be at opposite ends of
// the board. These check that they arrive as one, and that sharing an event
// is what decides which lines end up next to each other.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, eventItems, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-07T12:00:00Z'); // a Monday
  const cfgWith = (json) => ({ config_json: JSON.stringify(json) });

  // two calendars, each naming the same meeting for a different person
  function twoFeeds(summaryA, summaryB, timeA, timeB) {
    return async (url) => okText(icsWithEvents([
      String(url).indexOf('/a.ics') >= 0
        ? { start: timeA[0], end: timeA[1], summary: summaryA }
        : { start: timeB[0], end: timeB[1], summary: summaryB },
    ]));
  }

  const SAME = [['20260907T140000Z', '20260907T150000Z'], ['20260907T140000Z', '20260907T150000Z']];

  test('the same event on two calendars becomes one event on both lines', async () => {
    const r = await runTransform(twoFeeds('Swim Class', 'Swim Class', SAME[0], SAME[1]), NOW)
      .run(baseInput(NOW, cfgWith({
        tracks: [{ name: 'Ada' }, { name: 'Bo' }],
        calendars: [
          { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, track: 'Ada' }] },
          { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, track: 'Bo' }] },
        ],
      })));
    const swims = eventItems(r.metro).filter((e) => e.title === 'Swim Class');
    assertEqual(swims.length, 1, 'one swim class, not two');
    assertEqual((swims[0].co_owners || []).length, 1, 'the second line should be a co-owner, not a second event');
  });

  test('two events with the same title at DIFFERENT times stay two events', async () => {
    const r = await runTransform(twoFeeds('Swim Class', 'Swim Class',
      ['20260907T140000Z', '20260907T150000Z'], ['20260907T160000Z', '20260907T170000Z']), NOW)
      .run(baseInput(NOW, cfgWith({
        tracks: [{ name: 'Ada' }, { name: 'Bo' }],
        calendars: [
          { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, track: 'Ada' }] },
          { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, track: 'Bo' }] },
        ],
      })));
    assertEqual(eventItems(r.metro).filter((e) => e.title === 'Swim Class').length, 2,
      'two o\'clock and four o\'clock are not the same lesson');
  });

  test('the same station on two calendars keeps a kink on each line but is one station', async () => {
    const r = await runTransform(twoFeeds('School Day', 'School Day', SAME[0], SAME[1]), NOW)
      .run(baseInput(NOW, cfgWith({
        tracks: [{ name: 'Ada' }, { name: 'Bo' }],
        rules: [{ match: { type: 'word', value: 'School' }, station: true }],
        calendars: [
          { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, track: 'Ada' }] },
          { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, track: 'Bo' }] },
        ],
      })));
    const st = (r.metro.stations || []).filter((s) => s.title === 'School Day');
    assertEqual(st.length, 2, 'both children really are at school, so both lines kink');
    assert(st[0].group && st[0].group === st[1].group,
      'but it is one station: the two entries must share a group, so the caption is drawn once');
    assert(st[0].owner !== st[1].owner, 'the two kinks belong to different lines');
  });

  test('lines that share an event are laid out next to each other', async () => {
    // Ada and Cy share nothing; Bo shares a class with each of them. The
    // board is a chain — outermost left ... spine ... outermost right — so
    // "next to each other" means consecutive in track_offset order across
    // the whole board, and Bo must sit between the two.
    const feeds = async (url) => {
      const which = String(url).match(/\/(\w+)\.ics/)[1];
      if (which === 'a') return okText(icsWithEvents([{ start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Shared One' }]));
      if (which === 'b') return okText(icsWithEvents([
        { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Shared One' },
        { start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Shared Two' },
      ]));
      return okText(icsWithEvents([{ start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Shared Two' }]));
    };
    const r = await runTransform(feeds, NOW).run(baseInput(NOW, cfgWith({
      tracks: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [
        { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, track: 'Ada' }] },
        { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, track: 'Bo' }] },
        { url: 'https://example.com/c.ics', rules: [{ match: { type: 'any' }, track: 'Cy' }] },
      ],
    })));
    const board = r.metro.legend.slice().sort((x, y) => x.track_offset - y.track_offset).map((t) => t.name);
    assertEqual(board.length, 3, 'three lines');
    assertEqual(board[1], 'Bo',
      'Bo shares an event with each of the others, so Bo belongs between them; got ' + board.join(' '));
  });

  test('the day stretches to fit what is on it, with room after the last event', async () => {
    // A fixed 7am-to-9pm day cut the ends off and left a late event's label
    // nothing to run into. The window now reaches an hour before the first
    // thing and an hour and a half after the last.
    const r = await runTransform(async () => okText(icsWithEvents([
      { start: '20260907T043000Z', end: '20260907T053000Z', summary: 'Early Shift' },
      { start: '20260907T200000Z', end: '20260907T203000Z', summary: 'Late Call' },
    ])), NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }],
    })));
    const items = eventItems(r.metro);
    const first = Math.min.apply(null, items.map((e) => e.start_min));
    const last = Math.max.apply(null, items.map((e) => e.end_min));
    assert(r.metro.day_start_min <= first, 'the day starts at or before the first event, got '
      + r.metro.day_start_min + ' vs ' + first);
    assert(r.metro.day_end_min >= last + 60,
      'the day should leave at least an hour past the last event for its label, got '
      + r.metro.day_end_min + ' vs ' + last);
    assert(r.metro.day_start_min >= 0 && r.metro.day_end_min <= 24 * 60, 'and stay inside one real day');
  });
};
