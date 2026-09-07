module.exports = function (test, h) {
  const { loadEditor, fireInput, jsonOut, assertEqual } = h;

  test('a bare calendar URL exports as the minimal shape', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#calendars .field-url'), 'https://example.com/a.ics');
    assertEqual(jsonOut(document), { calendars: [{ url: 'https://example.com/a.ics' }], people: [] });
  });

  test('name and color are included only once actually set', () => {
    const { document } = loadEditor();
    const entry = document.querySelector('#calendars .entry');
    fireInput(entry.querySelector('.field-url'), 'https://example.com/a.ics');
    fireInput(entry.querySelector('.field-narrow'), 'Family');
    const colorSel = entry.querySelector('select');
    colorSel.value = 'blue';
    colorSel.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    assertEqual(jsonOut(document), { calendars: [{ url: 'https://example.com/a.ics', name: 'Family', color: 'blue' }], people: [] });
  });

  test('a blank calendar entry (no URL) is dropped from the export', () => {
    const { document } = loadEditor();
    assertEqual(jsonOut(document), { calendars: [], people: [] });
  });

  test('+ Add calendar appends another calendar row, independently exported', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#calendars .field-url'), 'https://example.com/a.ics');
    document.getElementById('addCalendar').click();
    const urls = document.querySelectorAll('#calendars .field-url');
    assertEqual(urls.length, 2, 'a second calendar row should exist');
    fireInput(urls[1], 'https://example.com/b.ics');
    assertEqual(jsonOut(document).calendars.map((c) => c.url), ['https://example.com/a.ics', 'https://example.com/b.ics']);
  });
};
