'use strict';

// METRO payloads for the layout suite — the same shape transform.js emits.
// Each one pins down a situation that has actually gone wrong, so a fixture
// is a bug report as much as it is input.

function track(key, name, side, hue, offset, width, style) {
  return { key: key, name: name, side: side, hue: hue, track_offset: offset, line_width: width, line_style: style };
}
function ev(title, owner, startMin, endMin, extra) {
  return Object.assign({
    type: 'event', title: title, start_min: startMin, end_min: endMin, location: null,
    owner: owner, co_owners: [], side: 'left', hue: 'black', track_width: 3, track_style: 'solid', track_offset: -10,
  }, extra || {});
}
function station(owner, title, startMin, endMin, extra) {
  return Object.assign({ owner: owner, title: title, location: null, start_min: startMin, end_min: endMin }, extra || {});
}

const TRACKS = [
  track('work', 'Work', 'left', 'black', -10, 4, 'solid'),
  track('alex', 'Alex', 'right', 'orange-40', 10, 3, 'solid'),
  track('sam', 'Sam', 'right', 'green-40', 20, 3, 'dashed'),
  track('kids', 'Kids', 'right', 'purple-40', 30, 3, 'dotted'),
];

function base(over) {
  return Object.assign({
    day_start_min: 420, day_end_min: 1260, secondary_threshold_min: 30,
    window_label: '07:00 21:00', date_label: 'Tue, Sep 8', now_min: 870,
    orientation: 'auto', hour12: false,
    i18n: { today: 'Today', more: '+{n} more', earlier: '+{n} earlier', rain_pct: '{n}% rain' },
    header_weather: { hi: 21, lo: 13, condition: 'Rain', rain_chance: 60, icon: '' },
    legend: TRACKS, all_day: [], stations: [], items: [],
  }, over);
}

// A full, busy day on four tracks: back-to-back work meetings that have to
// stack into lanes, two- and three-way interchanges, an evening cluster.
// This is the everyday case — if anything here is unreadable, the plugin is
// unreadable.
const busyDay = base({
  items: [
    ev('Yoga', 'alex', 450, 510, { location: 'Studio 9', side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Team Standup', 'work', 480, 495, { track_width: 4 }),
    ev('School Run', 'kids', 495, 525, { co_owners: ['sam'], side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Quick Sync', 'work', 500, 515, { track_width: 4 }),
    ev('Client Workshop', 'work', 540, 630, { location: 'Room 4B', track_width: 4 }),
    ev('Dentist', 'alex', 600, 645, { side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('1:1 with Priya', 'work', 660, 690, { track_width: 4 }),
    ev('Lunch with Alex', 'alex', 720, 780, { location: 'The Garden Cafe', co_owners: ['work'], side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Design Review', 'work', 840, 900, { track_width: 4 }),
    ev('Sprint Planning', 'work', 930, 1020, { track_width: 4 }),
    ev('Pick Up Kids', 'kids', 960, 980, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Swim Training', 'sam', 990, 1050, { location: 'City Pool', side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
    ev('Piano Lesson', 'kids', 1020, 1065, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Groceries', 'alex', 1050, 1080, { side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Family Dinner', 'alex', 1110, 1170, { co_owners: ['sam', 'kids'], side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Book Club', 'sam', 1185, 1260, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

// The same day with an all-day event on EVERY track. All-day events render
// as a full-width station band, which moves every line off its baseline for
// the whole day — that is what broke the interchange capsule (it reached for
// a baseline nobody was sitting on any more) and what put a track's own line
// through its caption.
const allDayEveryTrack = base({
  stations: [
    station('work', 'Office Closed', 420, 1260, { all_day: true }),
    station('alex', 'PTO', 420, 1260, { all_day: true }),
    station('sam', 'Conference', 420, 1260, { all_day: true }),
    station('kids', 'School Holiday', 420, 1260, { all_day: true }),
  ],
  items: busyDay.items,
});

// A waypoint station (config `station: true`) with a location line, spanning
// most of the day, with real meetings inside its span. The caption is two
// lines here, which is what used to overflow the gap the kink opens up.
const waypointStation = base({
  stations: [
    station('work', 'Desk booking', 480, 1020, { location: 'BE - Ghent / A01 / D01.01' }),
    station('kids', 'Schoolfotografie', 420, 1260, { all_day: true }),
  ],
  items: busyDay.items,
});

// Barely anything on: the layout should use the canvas instead of leaving
// one line adrift, and must not invent overlaps out of empty space. The
// five-hour block is the one event on any fixture long enough to be allowed
// a rejoin, so it is what keeps the "only long solo events rejoin" rule from
// passing simply because nothing ever rejoins.
const quietDay = base({
  now_min: 600,
  items: [
    ev('Standup', 'work', 540, 555, { track_width: 4 }),
    ev('Rehearsal Day', 'kids', 540, 840, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Swim Training', 'sam', 990, 1050, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

// Two same-owner meetings starting within a few minutes of each other: the
// second one's branch used to be forced to cross back through the first's.
const tightPair = base({
  items: [
    ev('Team Standup', 'work', 480, 495, { track_width: 4 }),
    ev('Quick Sync', 'work', 500, 515, { track_width: 4 }),
    ev('Client Workshop', 'work', 540, 630, { track_width: 4 }),
  ],
});

// A full 24-hour day whose events all sit in the middle of it: the quiet
// early morning and late evening are what the express sections compress.
const fullDay = base({
  day_start_min: 0, day_end_min: 1440, window_label: '00:00 24:00', now_min: 600,
  items: [
    ev('Standup', 'work', 540, 555, { track_width: 4 }),
    ev('Workshop', 'work', 600, 690, { track_width: 4 }),
    ev('Dentist', 'alex', 780, 825, { side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Swim', 'sam', 900, 960, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

// One station shared by two lines: both kink (they really are both there)
// but it is one event, so one caption, set between them. Drawn once per line
// it appeared twice, on lines that could be at opposite ends of the board.
const sharedStation = base({
  stations: [
    station('sam', 'School Day', 480, 960, { location: 'Springfield Elementary', group: 'g1' }),
    station('kids', 'School Day', 480, 960, { location: 'Springfield Elementary', group: 'g1' }),
  ],
  items: [
    ev('Standup', 'work', 540, 555, { track_width: 4 }),
    ev('Assembly', 'kids', 600, 630, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Swim Training', 'sam', 990, 1050, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

module.exports = [
  { name: 'busy-day', metro: busyDay },
  { name: 'all-day-every-track', metro: allDayEveryTrack },
  { name: 'waypoint-station', metro: waypointStation },
  { name: 'quiet-day', metro: quietDay },
  { name: 'tight-pair', metro: tightPair },
  { name: 'full-day', metro: fullDay },
  { name: 'shared-station', metro: sharedStation },
];
