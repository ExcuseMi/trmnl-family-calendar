module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, okJson, baseInput, assert, assertEqual } = h;

  // Pinned, not real "today" — see the same note in timed-layout.js/allday-overflow.js.
  const NOW = Date.parse('2026-09-05T08:00:00Z'); // 2026-09-05 is a Saturday, 08:00 UTC

  // Hourly forecast for day 0 (today): clear all day except rain from 14:00 through 15:00 (i.e.
  // rain codes at hours 14 and 15, clear again at 16) — one start transition, one stop.
  function weatherJsonWithRain() {
    const time = [];
    const weathercode = [];
    for (let h = 0; h < 24; h++) {
      time.push('2026-09-05T' + String(h).padStart(2, '0') + ':00');
      weathercode.push(h === 14 || h === 15 ? 61 : 0); // 61 = "slight rain" per WEATHER_CODES
    }
    return {
      daily: { sunrise: ['2026-09-05T06:00'], sunset: ['2026-09-05T20:00'], temperature_2m_max: [20], temperature_2m_min: [12] },
      hourly: { time, weathercode },
    };
  }

  test('data.days[i].agenda includes "Rain starts"/"Rain stops" markers at the right hours, in chronological order with real events', async () => {
    const events = [
      { uid: 1, start: '20260905T100000Z', end: '20260905T103000Z', summary: 'Morning Standup' },
      { uid: 2, start: '20260905T180000Z', end: '20260905T183000Z', summary: 'Evening Call' },
    ];
    const fetchImpl = async (url) => {
      if (url.includes('open-meteo')) return okJson(weatherJsonWithRain());
      return okText(icsWithEvents(events));
    };
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', lat_lon: '52.0,4.0', view_days: '1' }));
    const titles = r.data.days[0].agenda.map((i) => i.title);
    assertEqual(titles, ['Morning Standup', 'Rain starts', 'Rain stops', 'Evening Call'], 'weather markers should be interleaved chronologically with real events');

    const start = r.data.days[0].agenda.find((i) => i.title === 'Rain starts');
    const stop = r.data.days[0].agenda.find((i) => i.title === 'Rain stops');
    assert(start.icon_url.includes('rain'), 'the start marker should use a rain icon: ' + start.icon_url);
    assert(stop.icon_url.includes('sunny'), 'the stop marker should use a sunny icon: ' + stop.icon_url);
    assertEqual(start.time, '14:00', 'the start marker should be labeled with the hour it starts');
    assertEqual(stop.time, '16:00', 'the stop marker should be labeled with the hour it stops (rain was at 14 and 15, clear again at 16)');
  });

  test('data.single_day.agenda only includes still-upcoming weather markers, matching how it treats events', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('open-meteo')) return okJson(weatherJsonWithRain());
      return okText(icsWithEvents([]));
    };
    const { run } = runTransform(fetchImpl, NOW);
    // NOW is 08:00 — both the 14:00 start and the 16:00 stop are still ahead, so both show.
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', lat_lon: '52.0,4.0' }));
    assertEqual(r.data.single_day.agenda.map((i) => i.title), ['Rain starts', 'Rain stops']);
  });

  test('a day with no rain at all has no weather markers in its agenda', async () => {
    function weatherJsonClear() {
      const time = [];
      const weathercode = [];
      for (let h = 0; h < 24; h++) {
        time.push('2026-09-05T' + String(h).padStart(2, '0') + ':00');
        weathercode.push(0);
      }
      return {
        daily: { sunrise: ['2026-09-05T06:00'], sunset: ['2026-09-05T20:00'], temperature_2m_max: [20], temperature_2m_min: [12] },
        hourly: { time, weathercode },
      };
    }
    const fetchImpl = async (url) => {
      if (url.includes('open-meteo')) return okJson(weatherJsonClear());
      return okText(icsWithEvents([]));
    };
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', lat_lon: '52.0,4.0' }));
    assertEqual(r.data.days[0].agenda, []);
    assertEqual(r.data.single_day.agenda, []);
  });
};
