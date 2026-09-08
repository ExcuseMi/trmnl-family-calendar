module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, eventItems, assertEqual } = h;

  // "We also have standup twice" — an Outlook-style export where a weekly
  // series has a same-UID RECURRENCE-ID override for one occurrence (an
  // attendee-response-only edit, or a moved time). Without suppressing the
  // master's own occurrence on that date, both the master's weekly-RRULE
  // match AND the override's own direct-hit DTSTART show up, doubling it.

  test('a no-op RECURRENCE-ID override does not duplicate the master\'s own occurrence', async () => {
    const MONDAY = Date.parse('2026-09-07T09:30:00Z');
    const events = [
      { uid: 'series-1', start: '20260601T090000Z', end: '20260601T091500Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', summary: 'Team Standup' },
      { uid: 'series-1', recurrenceId: '20260907T090000Z', start: '20260907T090000Z', end: '20260907T091500Z', summary: 'Team Standup' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const cfg = JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] });
    const r = await runTransform(fetchImpl, MONDAY).run(baseInput(MONDAY, { config_json: cfg }));
    assertEqual(eventItems(r.metro).length, 1, 'the override should replace the master\'s occurrence, not add a second "Team Standup"');
  });

  test('a RECURRENCE-ID override that moves the occurrence still suppresses the master\'s original slot', async () => {
    const MONDAY = Date.parse('2026-09-07T09:30:00Z');
    const events = [
      { uid: 'series-2', start: '20260907T090000Z', end: '20260907T091500Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', summary: 'Standup' },
      { uid: 'series-2', recurrenceId: '20260907T090000Z', start: '20260907T110000Z', end: '20260907T111500Z', summary: 'Standup (moved)' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const cfg = JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] });
    const r = await runTransform(fetchImpl, MONDAY).run(baseInput(MONDAY, { config_json: cfg }));
    const titles = eventItems(r.metro).map((e) => e.title);
    assertEqual(titles, ['Standup (moved)'], 'the original 09:00 occurrence should be suppressed and only the moved override should show');
  });

  test('an override for a DIFFERENT date does not suppress today\'s own occurrence', async () => {
    const MONDAY = Date.parse('2026-09-07T09:30:00Z');
    const events = [
      { uid: 'series-3', start: '20260601T090000Z', end: '20260601T091500Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', summary: 'Standup' },
      { uid: 'series-3', recurrenceId: '20260914T090000Z', start: '20260914T100000Z', end: '20260914T101500Z', summary: 'Standup (moved next week)' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const cfg = JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] });
    const r = await runTransform(fetchImpl, MONDAY).run(baseInput(MONDAY, { config_json: cfg }));
    assertEqual(eventItems(r.metro).map((e) => e.title), ['Standup'], 'today\'s own occurrence is untouched by an override targeting a different date');
  });
};
