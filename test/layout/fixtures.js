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
function siding(owner, title, startMin, endMin, extra) {
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
    legend: TRACKS, all_day: [], sidings: [], items: [],
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
// as a full-width siding band, which moves every line off its baseline for
// the whole day — that is what broke the interchange capsule (it reached for
// a baseline nobody was sitting on any more) and what put a track's own line
// through its caption.
const allDayEveryTrack = base({
  sidings: [
    siding('work', 'Office Closed', 420, 1260, { all_day: true }),
    siding('alex', 'PTO', 420, 1260, { all_day: true }),
    siding('sam', 'Conference', 420, 1260, { all_day: true }),
    siding('kids', 'School Holiday', 420, 1260, { all_day: true }),
  ],
  items: busyDay.items,
});

// A siding (config `siding: true`) with a location line, spanning
// most of the day, with real meetings inside its span. The caption is two
// lines here, which is what used to overflow the gap the kink opens up.
const sidingDay = base({
  sidings: [
    siding('work', 'Desk booking', 480, 1020, { location: 'BE - Ghent / A01 / D01.01' }),
    siding('kids', 'Schoolfotografie', 420, 1260, { all_day: true }),
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

// One siding shared by two lines: both kink (they really are both there)
// but it is one event, so one caption, set between them. Drawn once per line
// it appeared twice, on lines that could be at opposite ends of the board.
const sharedSiding = base({
  sidings: [
    siding('sam', 'School Day', 480, 960, { location: 'Springfield Elementary', group: 'g1' }),
    siding('kids', 'School Day', 480, 960, { location: 'Springfield Elementary', group: 'g1' }),
  ],
  items: [
    ev('Standup', 'work', 540, 555, { track_width: 4 }),
    ev('Assembly', 'kids', 600, 630, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Swim Training', 'sam', 990, 1050, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

// Five lines, two on one side and three on the other — the shape the demo
// board actually has, and the one the four-line fixtures never produced:
// each side's innermost track sits half a pitch off the spine, so those two
// are neighbours with nothing between them. That pair is the tightest gap
// on the board and it is where a line's NAME, set above its own rail, ran
// into the rail belonging to the line above it.
const FIVE = [
  track('mag', 'Maggie', 'left', 'black', -20, 3, 'solid'),
  track('hom', 'Homer', 'left', 'black', -10, 6, 'solid'),
  track('mar', 'Marge', 'right', 'black', 10, 5, 'dashed'),
  track('bar', 'Bart', 'right', 'black', 20, 4, 'dotted'),
  track('lis', 'Lisa', 'right', 'black', 30, 3, 'solid'),
];
const fiveLines = Object.assign(base({
  now_min: 519,
  sidings: [
    siding('bar', 'School Day', 510, 900, { location: 'Springfield Elementary', group: 'g1' }),
    siding('lis', 'School Day', 510, 900, { location: 'Springfield Elementary', group: 'g1' }),
    siding('hom', 'Desk booking', 480, 1020, { location: 'BE - Ghent / A01 / D01.01' }),
  ],
  items: [
    ev('School Run', 'mar', 480, 510, { co_owners: ['bar', 'lis'], side: 'right', hue: 'black', track_offset: 10 }),
    ev('Shift Handover', 'hom', 480, 495, { side: 'left', hue: 'black', track_width: 6, track_offset: -10 }),
    ev('Book Club', 'mar', 540, 600, { side: 'right', hue: 'black', track_style: 'dashed', track_offset: 10 }),
    ev('Assembly', 'lis', 540, 570, { side: 'right', hue: 'black', track_offset: 30 }),
    ev('Donut Break', 'hom', 600, 620, { side: 'left', hue: 'black', track_width: 6, track_offset: -10 }),
    ev('Playgroup', 'mag', 630, 690, { side: 'left', hue: 'black', track_offset: -20 }),
    ev('Grocery Run', 'mar', 720, 780, { location: 'Kwik-E-Mart', side: 'right', hue: 'black', track_style: 'dashed', track_offset: 10 }),
    ev('Nap', 'mag', 780, 870, { side: 'left', hue: 'black', track_offset: -20 }),
    ev('Reactor Core Check', 'hom', 840, 900, { side: 'left', hue: 'black', track_width: 6, track_offset: -10 }),
    ev('Detention', 'bar', 930, 990, { location: 'Room 12', side: 'right', hue: 'black', track_style: 'dotted', track_offset: 20 }),
    ev('PTA Meeting', 'mar', 960, 1020, { side: 'right', hue: 'black', track_style: 'dashed', track_offset: 10 }),
    ev('Saxophone Lesson', 'lis', 960, 1020, { side: 'right', hue: 'black', track_offset: 30 }),
    ev("Moe's Tavern", 'hom', 1050, 1110, { location: "Moe's", side: 'left', hue: 'black', track_width: 6, track_offset: -10 }),
    ev('Skate Park', 'bar', 1020, 1080, { side: 'right', hue: 'black', track_style: 'dotted', track_offset: 20 }),
    ev('Mensa Meeting', 'lis', 1110, 1170, { side: 'right', hue: 'black', track_offset: 30 }),
    ev('Family Dinner', 'mar', 1140, 1200, { co_owners: ['mag', 'hom', 'bar', 'lis'], side: 'right', hue: 'black', track_offset: 10 }),
  ],
}), { legend: FIVE });

// A work crew rather than a family, and the shape the Futurama demo board
// has: a whole-crew interchange first thing, three of them on one siding
// for most of the day, and two short events just before the interchange
// whose captions the interchange bar cuts across. Those two are what caught
// a caption being thrown 71px off its own rail to dodge that bar.
const CREW = [
  track('prof', 'Professor', 'left', 'black', -20, 6, 'solid'),
  track('amy', 'Amy', 'left', 'black', -10, 3, 'solid'),
  track('fry', 'Fry', 'right', 'black', 10, 4, 'dotted'),
  track('leela', 'Leela', 'right', 'black', 20, 3, 'solid'),
  track('bender', 'Bender', 'right', 'black', 30, 3.5, 'dashed'),
];
const crewDay = Object.assign(base({
  day_start_min: 360, day_end_min: 1380, window_label: '6am 11pm', now_min: 611,
  sidings: [
    siding('fry', 'Delivery Run', 540, 960, { location: 'Chapek 9', group: 'c1' }),
    siding('leela', 'Delivery Run', 540, 960, { location: 'Chapek 9', group: 'c1' }),
    siding('bender', 'Delivery Run', 540, 960, { location: 'Chapek 9', group: 'c1' }),
  ],
  items: [
    ev('Coffee (100 cups)', 'fry', 450, 480, { side: 'right', hue: 'black', track_style: 'dotted', track_offset: 10 }),
    ev('Bend Some Girders', 'bender', 450, 495, { side: 'right', hue: 'black', track_style: 'dashed', track_offset: 30 }),
    ev('Pre-flight Check', 'leela', 480, 510, { location: 'Docking Bay', side: 'right', hue: 'black', track_offset: 20 }),
    ev('Good News Everyone', 'prof', 525, 540, { co_owners: ['amy', 'fry', 'leela', 'bender'], side: 'left', hue: 'black', track_width: 6, track_offset: -20 }),
    ev('Lab Rotation', 'amy', 570, 690, { location: 'Mars University', side: 'left', hue: 'black', track_offset: -10 }),
    ev('Nap', 'prof', 840, 960, { side: 'left', hue: 'black', track_width: 6, track_offset: -20 }),
    ev('Scooter Service', 'amy', 960, 1020, { side: 'left', hue: 'black', track_offset: -10 }),
    ev('Crew Debrief', 'fry', 990, 1050, { co_owners: ['leela', 'bender'], side: 'right', hue: 'black', track_style: 'dotted', track_offset: 10 }),
    ev('Walk Nibbler', 'leela', 1050, 1095, { side: 'right', hue: 'black', track_offset: 20 }),
    ev('All My Circuits', 'fry', 1110, 1140, { side: 'right', hue: 'black', track_style: 'dotted', track_offset: 10 }),
    ev('Hedonism Lounge', 'bender', 1170, 1260, { side: 'right', hue: 'black', track_style: 'dashed', track_offset: 30 }),
  ],
}), { legend: CREW });

// The board a chat assistant actually produced for the Futurama demo: five
// people plus two lines that are not people at all, because it gave each
// calendar a `name` and an unnamed event falls back to it. Seven lines and
// nothing to be done about it from the layout's side — which is the point.
// This is the board that was drawn at a 20px pitch in a 780px-deep canvas
// with every line's name lying across its own rail, and the whole crew's
// siding drawn as a stack of unrelated pills.
const SEVEN = [
  track('deliv', 'Deliveries', 'left', 'black', -20, 5.5, 'dashed'),
  track('crew', 'Crew', 'left', 'black', -10, 5, 'dotted'),
  track('fry', 'Fry', 'right', 'black', 10, 6, 'solid'),
  track('leela', 'Leela', 'right', 'black', 20, 3, 'dashdot'),
  track('bender', 'Bender', 'right', 'black', 30, 3, 'dotted'),
  track('amy', 'Amy', 'right', 'black', 40, 3.5, 'dashed'),
  track('prof', 'Professor', 'right', 'black', 50, 4.5, 'dashdot'),
];
const CREW_KEYS = ['fry', 'leela', 'bender', 'amy', 'prof'];
const sevenLines = Object.assign(base({
  day_start_min: 360, day_end_min: 1380, window_label: '6am 11pm', now_min: 683,
  sidings: [
    siding('amy', 'Lab Rotation', 570, 690, { location: 'Mars University' }),
  ].concat(CREW_KEYS.map(function (k) {
    return siding(k, 'Delivery Run', 540, 960, { location: 'Chapek 9', group: 's1' });
  })),
  items: [
    ev('Coffee (100 cups)', 'fry', 450, 480, { side: 'right', hue: 'black', track_offset: 10 }),
    ev('Bend Some Girders', 'bender', 450, 495, { side: 'right', hue: 'black', track_style: 'dotted', track_offset: 30 }),
    ev('Pre-flight Check', 'leela', 480, 510, { location: 'Docking Bay', side: 'right', hue: 'black', track_style: 'dashdot', track_offset: 20 }),
    ev('Good News Everyone', 'fry', 525, 540, { co_owners: ['leela', 'bender', 'amy', 'prof'], location: 'Conference Table', side: 'right', hue: 'black', track_width: 6, track_offset: 10 }),
    ev('Nap', 'prof', 840, 960, { side: 'right', hue: 'black', track_style: 'dashdot', track_offset: 50 }),
    ev('Scooter Service', 'amy', 960, 1020, { side: 'right', hue: 'black', track_style: 'dashed', track_offset: 40 }),
    ev('Crew Debrief', 'fry', 990, 1050, { co_owners: ['leela', 'bender', 'amy', 'prof'], side: 'right', hue: 'black', track_width: 6, track_offset: 10 }),
    ev('Walk Nibbler', 'leela', 1050, 1095, { side: 'right', hue: 'black', track_style: 'dashdot', track_offset: 20 }),
    ev('All My Circuits', 'fry', 1110, 1140, { side: 'right', hue: 'black', track_width: 6, track_offset: 10 }),
    ev('Hedonism Lounge', 'bender', 1170, 1260, { location: "O'Zorgnax's Pub", side: 'right', hue: 'black', track_style: 'dotted', track_offset: 30 }),
  ],
}), { legend: SEVEN });

// A day with two entries that have no duration: a reminder saved at a
// moment, and a shared one at the same minute for several people. Real
// calendars are full of these (a birthday, an invitation accepted with no
// end, anything a phone saved as "now"), and every part of the drawing that
// reasons about a span has to survive one that is zero minutes long.
const momentDay = base({
  day_start_min: 420, day_end_min: 1260, window_label: '7am 9pm', now_min: 600,
  items: [
    ev('Bin Day', 'work', 480, 480),
    ev('Standup', 'work', 540, 555, { track_width: 4 }),
    ev('Family Dinner', 'alex', 1110, 1110, { co_owners: ['sam', 'kids'], side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Swim', 'sam', 900, 960, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

module.exports = [
  { name: 'busy-day', metro: busyDay },
  { name: 'all-day-every-track', metro: allDayEveryTrack },
  { name: 'siding-day', metro: sidingDay },
  { name: 'quiet-day', metro: quietDay },
  { name: 'tight-pair', metro: tightPair },
  { name: 'full-day', metro: fullDay },
  { name: 'shared-siding', metro: sharedSiding },
  { name: 'five-lines', metro: fiveLines },
  { name: 'crew-day', metro: crewDay },
  { name: 'seven-lines', metro: sevenLines },
  { name: 'moment-day', metro: momentDay },
];
