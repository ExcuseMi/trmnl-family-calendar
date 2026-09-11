// A track with nothing on today's board gets no line. That is what stops a
// board carrying every ever-configured person's empty rail, and it is the
// right default — but it also means the board is a different shape every
// day, and a person who is quiet today disappears from it. `hideIfEmpty:
// false` opts out, on a track or on the calendar that owns the line.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, assert } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const BUSY = 'https://cal.example.com/busy.ics';
  const QUIET = 'https://cal.example.com/quiet.ics';

  // one feed with something on today, one with nothing at all
  const busyIcs = icsWithEvents([{ summary: 'Standup', start: '20260909T090000Z', end: '20260909T091500Z' }]);
  const emptyIcs = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Quiet\r\nEND:VCALENDAR\r\n';

  function serve(opts) {
    return async (url) => {
      if (String(url) === BUSY) return okText(busyIcs);
      if (String(url) === QUIET) return (opts && opts.down) ? fail(503) : okText(emptyIcs);
      return fail(404);
    };
  }

  function board(cfg, opts) {
    const { run } = runTransform(serve(opts), NOW);
    return run(baseInput(NOW, { use_demo_data: 'false', config_json: JSON.stringify(cfg) }));
  }

  const TRACKS = (r) => r.data.legend.map((t) => t.name).sort().join(',');

  test('a track with nothing on today is dropped, as it always was', async () => {
    const r = await board({
      tracks: [{ name: 'Busy' }, { name: 'Quiet' }],
      calendars: [
        { name: 'Busy', url: BUSY, rules: [{ match: { type: 'any' }, track: 'Busy' }] },
        { name: 'Quiet', url: QUIET, rules: [{ match: { type: 'any' }, track: 'Quiet' }] },
      ],
    });
    assert(TRACKS(r) === 'Busy', 'got ' + TRACKS(r));
  });

  test('hideIfEmpty:false on a track keeps its line on a day it has nothing', async () => {
    const r = await board({
      tracks: [{ name: 'Busy' }, { name: 'Quiet', hideIfEmpty: false }],
      calendars: [
        { name: 'Busy', url: BUSY, rules: [{ match: { type: 'any' }, track: 'Busy' }] },
        { name: 'Quiet', url: QUIET, rules: [{ match: { type: 'any' }, track: 'Quiet' }] },
      ],
    });
    assert(TRACKS(r) === 'Busy,Quiet', 'got ' + TRACKS(r));
    // and it really is an empty line: no events were invented for it
    assert(eventItems(r.data).length === 1, 'expected the one real event, got ' + eventItems(r.data).length);
  });

  test('hideIfEmpty:false on a calendar keeps the line that calendar owns', async () => {
    const r = await board({
      calendars: [
        { name: 'Busy', url: BUSY },
        { name: 'Quiet', url: QUIET, hideIfEmpty: false },
      ],
    });
    assert(TRACKS(r) === 'Busy,Quiet', 'got ' + TRACKS(r));
  });

  test('a kept calendar survives its feed being down, not just being empty', async () => {
    // a feed unreachable for an hour should not silently remove somebody
    const r = await board({
      calendars: [
        { name: 'Busy', url: BUSY },
        { name: 'Quiet', url: QUIET, hideIfEmpty: false },
      ],
    }, { down: true });
    assert(TRACKS(r) === 'Busy,Quiet', 'got ' + TRACKS(r));
  });

  test('an unnamed kept calendar takes its line name from the feed', async () => {
    const r = await board({
      calendars: [
        { name: 'Busy', url: BUSY },
        { url: QUIET, hideIfEmpty: false },
      ],
    });
    assert(TRACKS(r) === 'Busy,Quiet', 'got ' + TRACKS(r));
  });

  test('hideIfEmpty:true is the default and changes nothing', async () => {
    const r = await board({
      tracks: [{ name: 'Busy' }, { name: 'Quiet', hideIfEmpty: true }],
      calendars: [
        { name: 'Busy', url: BUSY, rules: [{ match: { type: 'any' }, track: 'Busy' }] },
        { name: 'Quiet', url: QUIET, rules: [{ match: { type: 'any' }, track: 'Quiet' }] },
      ],
    });
    assert(TRACKS(r) === 'Busy', 'got ' + TRACKS(r));
  });
};
