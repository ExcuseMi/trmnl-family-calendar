// metro-plugin/src/transform.js — TRMNL Serverless entry point.
//
// Two data sources, chosen by the "Use Demo Data" boolean setting:
//   - demo (default): the same hardcoded dummy events this plugin has
//     always shown — no network, no config needed, safe fallback.
//   - config: a real calendar config pasted into the "Calendar Config"
//     setting, same JSON shape as this repo's calendar-config.json /
//     demo-config.json ({ calendars: [{url,name,rules}], tracks, timeZone,
//     rules }). Calendars are fetched as plain ICS and parsed with a small
//     hand-rolled parser (TRMNL Serverless only guarantees the built-in
//     HTTP client, not an ICS library — see topics/serverless.md).
//
// The config parser/rule engine (parseConfig/compileMatcher/
// applyCalendarRules below) is ported from plugin/src/transform.js's own
// — same config shape, same semantics, minus the pieces that plugin's
// flat agenda list needs but this metro map doesn't (multi-day windows,
// saved-state/calendar-down alerts, X-WR-CALNAME derived names). It
// supports: string-shorthand calendars (`"https://.../a.ics"` as well as
// `{url:...}`), non-JSON config text falling back to a newline-separated
// URL list, per-calendar `headers` (sent alongside the default
// User-Agent), match types any/all/exact/word/contains/regex/status/
// weekday/and/or, `rewrite`(+`rewriteFull`) and `rename` (defaults to
// true, EXCEPT on an any/all match where it defaults to false — a
// catch-all shouldn't silently rewrite every title unless asked), a
// top-level `rules` array applied before each calendar's own (a
// calendar's own rule wins when both assign a track to the same event),
// a `track` field that can be a list (multiple tracks on the same
// event become an interchange node, metro-plugin's own concept for a
// shared event), and an `everyoneTrack` fallback (the first entry in
// `tracks[]`) for any event no rule assigns a track to.
//
// (For compatibility with configs written before tracks were called
// tracks: the legacy top-level `people` key and per-rule `person` field
// are still accepted as aliases for `tracks`/`track`.)
//
// `tracks[].side` ("left"/"work" or "right"/"family") pins a track to a
// side of the map; without it the track a calendar named "Work" assigns
// goes left and everyone else right. `locale` in the config overrides the
// account locale for the string table and date names.
//
// Known, deliberate limitations of the config path (documented rather
// than silently wrong):
//   - RRULE support is a bounded subset, not full recurrence: only
//     FREQ=WEEKLY (with optional BYDAY/UNTIL) is evaluated against
//     today — the pattern real calendar exports actually use for
//     standing meetings/family routines, and what this repo's own
//     demo-config.json fixtures use throughout. DAILY/MONTHLY/YEARLY and
//     COUNT are not handled; an event using one of those only shows if
//     its DTSTART itself falls on today. A RECURRENCE-ID override IS
//     handled (it suppresses the master's occurrence on that date, so a
//     moved/cancelled single instance doesn't show up twice).
//   - No all-day lane — all-day events are skipped (this UI has no place
//     to put them yet).
//   - A rule's `desc` match only sees an event's DESCRIPTION when that
//     calendar opts in via `includeDescription: true` — off by default
//     since most calendars don't need it parsed/matched against.
//   - Weather needs a `lat_lon` setting; without one it stays a
//     placeholder in both modes.
//
// Both branches converge on the SAME buildMetro() — the rest of the
// pipeline (hour ticks, sub-spur detection, the "now" marker, tracks
// list) doesn't care whether events came from DUMMY_EVENTS or real ICS.

var DAY_START_MIN = 7 * 60;
var DAY_END_MIN = 21 * 60;
var SECONDARY_THRESHOLD_MIN = 30;
var TRACK_STEP = 10; // px between adjacent track offsets
var LINE_STYLES = ['solid', 'dashed', 'dotted', 'dashdot']; // per side, in track order — pattern (not just hue) tells lines apart on a 1-bit panel
// -40 steps: dark enough to read as a line on grayscale panels (the framework's scale runs 10 = darkest … 75 = lightest)
var HUE_CYCLE = ['blue-40', 'orange-40', 'purple-40', 'red-40', 'cyan-40', 'pink-40', 'lime-40', 'violet-40', 'yellow-40', 'green-40'];
var HUE_NAMES = ['blue', 'green', 'orange', 'purple', 'red', 'cyan', 'pink', 'lime', 'violet', 'yellow'];

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function timeLabel(min) {
  var h = Math.floor(min / 60) % 24;
  var m = min % 60;
  return pad2(h) + ':' + pad2(m);
}

// ---------------------------------------------------------------------
// i18n — every user-facing string the plugin renders, keyed by the first
// two letters of the TRMNL account locale (en, fr, es, de, nl; anything
// else falls back to English). Embedded here rather than in separate
// files because Serverless only ships this one file. Weekday and month
// names come from Intl with the full locale instead, so they cover any
// language Intl knows.
// ---------------------------------------------------------------------
var I18N = {
  en: { today: 'Today', more: '+{n} more', earlier: '+{n} earlier', rain_pct: '{n}% rain',
        clear: 'Clear', partly_cloudy: 'Partly cloudy', cloudy: 'Cloudy', foggy: 'Foggy', rain: 'Rain', snow: 'Snow', storms: 'Storms',
        rain_starts: 'Rain starts', rain_stops: 'Rain stops', sunrise: 'Sunrise', sunset: 'Sunset' },
  fr: { today: "Aujourd'hui", more: '+{n} de plus', earlier: '+{n} plus tôt', rain_pct: '{n} % de pluie',
        clear: 'Dégagé', partly_cloudy: 'Partiellement nuageux', cloudy: 'Nuageux', foggy: 'Brouillard', rain: 'Pluie', snow: 'Neige', storms: 'Orages',
        rain_starts: 'Début de la pluie', rain_stops: 'Fin de la pluie', sunrise: 'Lever du soleil', sunset: 'Coucher du soleil' },
  es: { today: 'Hoy', more: '+{n} más', earlier: '+{n} antes', rain_pct: '{n}% lluvia',
        clear: 'Despejado', partly_cloudy: 'Parcialmente nublado', cloudy: 'Nublado', foggy: 'Niebla', rain: 'Lluvia', snow: 'Nieve', storms: 'Tormentas',
        rain_starts: 'Empieza la lluvia', rain_stops: 'Para la lluvia', sunrise: 'Amanecer', sunset: 'Atardecer' },
  de: { today: 'Heute', more: '+{n} weitere', earlier: '+{n} früher', rain_pct: '{n} % Regen',
        clear: 'Klar', partly_cloudy: 'Teils bewölkt', cloudy: 'Bewölkt', foggy: 'Neblig', rain: 'Regen', snow: 'Schnee', storms: 'Gewitter',
        rain_starts: 'Regen beginnt', rain_stops: 'Regen endet', sunrise: 'Sonnenaufgang', sunset: 'Sonnenuntergang' },
  nl: { today: 'Vandaag', more: '+{n} meer', earlier: '+{n} eerder', rain_pct: '{n}% regen',
        clear: 'Helder', partly_cloudy: 'Half bewolkt', cloudy: 'Bewolkt', foggy: 'Mistig', rain: 'Regen', snow: 'Sneeuw', storms: 'Onweer',
        rain_starts: 'Regen begint', rain_stops: 'Regen stopt', sunrise: 'Zonsopgang', sunset: 'Zonsondergang' },
};

// The account locale ("nl", "fr-BE", "en-US", ...): the full tag drives
// Intl (dates, 12h/24h default); the two-letter language picks the string
// table.
function userLocale(input) {
  try {
    var l = input.trmnl.user.locale;
    return (typeof l === 'string' && l.trim()) ? l.trim().replace('_', '-') : 'en';
  } catch (e) {
    return 'en';
  }
}

function stringsFor(locale) {
  var lang = String(locale || 'en').slice(0, 2).toLowerCase();
  return I18N[lang] || I18N.en;
}

function tr(strings, key, n) {
  var v = strings[key] || I18N.en[key] || key;
  return n == null ? v : v.replace('{n}', String(n));
}

// Weekday and month names come from Intl, one part at a time and cached.
// Formatters are not cheap to build and the same handful get asked for over
// and over, and taking the parts separately means the label can be composed
// per locale rather than accepting whatever order a full format string
// produces. Some locales return a trailing dot or a lowercase name; both are
// tidied here so the header reads consistently.
var _weekdayFmtCache = {}, _monthFmtCache = {};
function localeDatePart(locale, width, kind, y, mo, d) {
  var key = locale + '|' + width;
  var cache = kind === 'weekday' ? _weekdayFmtCache : _monthFmtCache;
  var fmt = cache[key];
  if (!fmt) {
    var opts = { timeZone: 'UTC' };
    opts[kind] = width;
    try {
      fmt = new Intl.DateTimeFormat(locale, opts);
    } catch (e) {
      fmt = new Intl.DateTimeFormat('en', opts);
    }
    cache[key] = fmt;
  }
  var raw = fmt.format(new Date(Date.UTC(y, mo - 1, d))).replace(/\.$/, '');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// "Tue 8 Sep" / "Di 8 sep" / "Mar 8 sept" — header date, in the board's own
// language.
function dateLabel(civil, locale) {
  if (!civil) return null;
  var loc = locale || 'en';
  var wd = localeDatePart(loc, 'short', 'weekday', civil.y, civil.mo, civil.d);
  var month = localeDatePart(loc, 'short', 'month', civil.y, civil.mo, civil.d);
  return wd + ' ' + civil.d + ' ' + month;
}

// 12-hour clocks where the locale itself uses them, unless the setting says
// otherwise. Ask Intl rather than keeping a list of regions: the runtime
// already knows every locale's clock convention, a hand-kept list is wrong
// the moment it meets a locale nobody thought of, and "does en-IE use a
// 12-hour clock" is not a question this file should be answering from
// memory.
var _hourCycleCache = {};
function localeUses12h(locale) {
  var key = String(locale || 'en');
  if (key in _hourCycleCache) return _hourCycleCache[key];
  var out = false;
  try {
    var ro = new Intl.DateTimeFormat(key, { hour: 'numeric' }).resolvedOptions();
    // hourCycle is the modern answer (h11/h12 are the 12-hour ones); hour12
    // is the older one. A bare "en" resolves to a 12-hour clock, which is
    // not what a TRMNL account defaulting to "en" wants, so that one case
    // stays explicit.
    out = ro.hourCycle ? (ro.hourCycle === 'h11' || ro.hourCycle === 'h12') : !!ro.hour12;
    if (key.toLowerCase() === 'en') out = false;
  } catch (e) { out = false; }
  _hourCycleCache[key] = out;
  return out;
}

function resolveHour12(timeFormatRaw, locale) {
  if (timeFormatRaw === '12h') return true;
  if (timeFormatRaw === '24h') return false;
  return localeUses12h(locale);
}

// ---------------------------------------------------------------------
// Timezone helpers (Intl-based, no library) — same technique used by
// this project's other plugin (plugin/src/transform.js: fromEpoch /
// zonedTimeToUtc), ported compactly rather than re-derived.
// ---------------------------------------------------------------------

var _offsetFmtCache = {};
// Validates an IANA zone name before it's ever handed to
// getOffsetMinutes()/zonedTimeToUtc() — Intl throws on anything it
// doesn't recognize (notably Windows-style TZIDs like "Eastern Standard
// Time" that Outlook exports use instead of "America/New_York"), and an
// uncaught throw here would silently drop that entire calendar's events
// (swallowed by the per-calendar try/catch in buildFromConfig) with
// nothing pointing at why. Ported from plugin/src/transform.js's own
// safeZone — same fix, same reason.
var _safeZoneCache = {};
function safeZone(name) {
  if (!name) return null;
  if (name in _safeZoneCache) return _safeZoneCache[name];
  var ok;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    ok = name;
  } catch (e) {
    ok = null;
  }
  _safeZoneCache[name] = ok;
  return ok;
}

function offsetFormatter(tz) {
  if (!_offsetFmtCache[tz]) {
    _offsetFmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', timeZoneName: 'longOffset' });
  }
  return _offsetFmtCache[tz];
}

function getOffsetMinutes(epochMs, tz) {
  if (typeof tz === 'number') return tz; // already a raw UTC offset in minutes — the utc_offset fallback case
  if (!isFinite(epochMs)) return 0;
  var parts = offsetFormatter(tz).formatToParts(new Date(epochMs));
  var part = parts.filter(function (p) { return p.type === 'timeZoneName'; })[0];
  var v = part ? part.value : 'GMT';
  if (v === 'GMT' || v === 'UTC') return 0;
  var m = /GMT([+-])(\d{1,2}):(\d{2})/.exec(v);
  if (m) return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  m = /GMT([+-])(\d{1,2})$/.exec(v);
  if (m) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10) * 60;
  return 0;
}

var _civilFmtCache = {};
function civilFormatter(tz) {
  if (!_civilFmtCache[tz]) {
    _civilFmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  return _civilFmtCache[tz];
}

function fromEpoch(epochMs, tz) {
  if (typeof tz === 'number') {
    var dNum = new Date(epochMs + tz * 60000);
    return { y: dNum.getUTCFullYear(), mo: dNum.getUTCMonth() + 1, d: dNum.getUTCDate(), h: dNum.getUTCHours(), mi: dNum.getUTCMinutes(), s: dNum.getUTCSeconds() };
  }
  var parts = {};
  civilFormatter(tz).formatToParts(new Date(epochMs)).forEach(function (p) { parts[p.type] = p.value; });
  var h = +parts.hour;
  if (h === 24) h = 0;
  return { y: +parts.year, mo: +parts.month, d: +parts.day, h: h, mi: +parts.minute, s: +parts.second };
}

function zonedTimeToUtc(y, mo, d, h, mi, s, tz) {
  if (typeof tz === 'number') return Date.UTC(y, mo - 1, d, h, mi, s) - tz * 60000;
  var guess = Date.UTC(y, mo - 1, d, h, mi, s);
  var off1 = getOffsetMinutes(guess, tz);
  var t1 = guess - off1 * 60000;
  var off2 = getOffsetMinutes(t1, tz);
  return guess - off2 * 60000;
}

function cf(input, key) {
  try {
    var v = input.trmnl.plugin_settings.custom_fields_values[key];
    return v == null ? '' : String(v);
  } catch (e) {
    return '';
  }
}

// User's own TRMNL account timezone/offset — the fallback chain a config
// (or demo mode, which has no timeZone of its own at all) should use
// before ever defaulting to plain UTC, so "now" and any floating-time ICS
// events land on the viewer's actual local day instead of an arbitrary
// one. Ported from plugin/src/transform.js's userTz/userUtcOffsetMinutes/
// resolveTz — same fallback order: explicit override > account IANA zone
// > account UTC offset (seconds, per the merge-variable, hence /60) > UTC.
function userTz(input) {
  try {
    var tz = input.trmnl.user.time_zone_iana;
    return (typeof tz === 'string' && tz.trim()) ? tz.trim() : null;
  } catch (e) {
    return null;
  }
}

function userUtcOffsetMinutes(input) {
  try {
    var n = Number(input.trmnl.user.utc_offset);
    return isFinite(n) ? n / 60 : null;
  } catch (e) {
    return null;
  }
}

function resolveTz(explicitTzname, input) {
  var explicit = explicitTzname ? safeZone(explicitTzname) : null;
  if (explicit) return explicit;
  var accountTz = safeZone(userTz(input));
  if (accountTz) return accountTz;
  var offsetMin = userUtcOffsetMinutes(input);
  if (offsetMin !== null) return offsetMin; // numeric — getOffsetMinutes/fromEpoch/zonedTimeToUtc all handle this
  return 'UTC';
}

// ---------------------------------------------------------------------
// buildMetro: the shared pipeline. `events`: [{track, title, startMin,
// endMin, location, interchange_with}], startMin/endMin are minutes
// since midnight LOCAL time. `tracks`: [{key,name,side,hue,track_offset,
// line_width,line_style}].
//
// transform.js is a pure data normalizer — it does NOT decide where
// anything sits on the canvas, which events are "close enough" to become
// a sub-spur, or which same-event entries are duplicates across feeds.
// It can't: it has no idea what the real rendered canvas height is, how
// many pixels a wrapped multi-line title needs, or whether two calendars
// happened to both return the same event. Event items here are raw facts
// only (title/times/location/owner/side/track styling); shared.liquid's
// client-side script does the dedup pass, maps start_min/end_min to a
// real pixel Y against the canvas's own measured height, measures each
// label's ACTUAL rendered box before deciding the next one's position,
// and decides sub-spur grouping from the deduped, time-sorted list
// itself. See that file's own header comment for the full breakdown.
// ---------------------------------------------------------------------

function timeLabel12(min, extra) {
  var h = Math.floor(min / 60) % 24, m = min % 60;
  if (!(extra && extra.hour12)) return pad2(h) + ':' + pad2(m);
  return (h % 12 || 12) + (m ? ':' + pad2(m) : '') + (h < 12 ? 'am' : 'pm');
}
function buildMetro(tracks, events, weatherMilestones, headerWeather, nowMin, windowLabel, allDayEvents, extra, stationEvents) {
  var trackByKey = {};
  tracks.forEach(function (t) { trackByKey[t.key] = t; });

  // ---- how much of the day is on the board -----------------------------
  //
  // A fixed 7am-to-9pm day cut the ends off: an early shift or a late
  // dinner fell outside it and became a "+1 later" note. It also left a
  // late event's label nothing to run into — the last thing on the map
  // ended AT the edge, so its caption had to be ellipsised or turned back
  // on itself.
  //
  // The day now stretches to fit what is actually on it, an hour before the
  // first thing and an hour and a half after the last, clamped to real
  // midnight either way. That tail is the room a label needs. The quiet
  // ends cost almost nothing to show because the client runs them as
  // express sections rather than at full scale, so a wider day is mostly a
  // wider view of the same busy hours.
  var dayLo = DAY_START_MIN, dayHi = DAY_END_MIN;
  (events || []).forEach(function (e) {
    if (e.startMin != null) dayLo = Math.min(dayLo, e.startMin);
    if (e.endMin != null) dayHi = Math.max(dayHi, e.endMin);
  });
  (stationEvents || []).forEach(function (e) {
    if (e.startMin != null) dayLo = Math.min(dayLo, e.startMin);
    if (e.endMin != null) dayHi = Math.max(dayHi, e.endMin);
  });
  if (nowMin != null) { dayLo = Math.min(dayLo, nowMin); dayHi = Math.max(dayHi, nowMin); }
  var DAY_LO = Math.max(0, Math.floor((dayLo - 60) / 60) * 60);
  var DAY_HI = Math.min(24 * 60, Math.ceil((dayHi + 90) / 60) * 60);
  if (DAY_HI - DAY_LO < 8 * 60) DAY_HI = Math.min(24 * 60, DAY_LO + 8 * 60);

  // A configured track with nothing on today's board gets no line and no
  // legend entry — otherwise every day carries every ever-configured
  // track's empty line, permanently eating spine width. Side/hue/style
  // stay whatever finalize() decided from the FULL registered set (so a
  // track's color/side identity doesn't shift day to day depending on
  // who else happens to be busy); only the per-side offset is repacked
  // against just today's active tracks, closing the gaps a filtered-out
  // track would otherwise leave.
  var activeKeys = {};
  events.forEach(function (ev) {
    if (!trackByKey[ev.track]) return;
    activeKeys[ev.track] = true;
    (ev.interchange_with || []).forEach(function (key) { if (trackByKey[key]) activeKeys[key] = true; });
  });
  (allDayEvents || []).forEach(function (ev) { if (trackByKey[ev.track]) activeKeys[ev.track] = true; });
  (stationEvents || []).forEach(function (ev) {
    if (trackByKey[ev.track]) activeKeys[ev.track] = true;
    // a station shared across lines keeps EVERY line it is on: two children
    // at the same school are both at school, and dropping the co-owner as
    // "inactive" took away one of the two kinks
    (ev.interchange_with || []).forEach(function (key) { if (trackByKey[key]) activeKeys[key] = true; });
  });
  tracks = tracks.filter(function (t) { return activeKeys[t.key]; });
  var sideIdx = { left: 0, right: 0 };
  tracks.forEach(function (t) { t.track_offset = TRACK_STEP * (++sideIdx[t.side]) * (t.side === 'left' ? -1 : 1); });
  trackByKey = {};
  tracks.forEach(function (t) { trackByKey[t.key] = t; });

  var items = [];

  events.forEach(function (ev) {
    var track = trackByKey[ev.track];
    if (!track) return; // no resolved/known track for this event — drop it rather than guess
    var coOwners = (ev.interchange_with || []).filter(function (key) { return !!trackByKey[key]; });
    items.push({
      type: 'event',
      _sortMin: ev.startMin,
      title: ev.title,
      start_min: ev.startMin,
      end_min: ev.endMin,
      location: ev.location || null,
      owner: track.key,
      co_owners: coOwners, // other track keys sharing this event (an interchange) — empty for a normal event
      side: track.side,
      hue: track.hue,
      track_width: track.line_width,
      track_style: track.line_style,
      track_offset: track.track_offset,
    });
  });

  // stations: a track's own line, not a lane branch — the client kinks
  // the spine itself out to "station level" for [startMin,endMin] rather
  // than drawing a diagonal/label run, so a status/location block doesn't
  // compete with real meetings for lane space
  var stationsOut = [];
  (stationEvents || []).forEach(function (ev, gi) {
    var owners = [ev.track].concat(ev.interchange_with || []).filter(function (k) { return trackByKey[k]; });
    if (!owners.length) return;
    // One station on several lines is still a kink on EACH of them — they
    // are all really at school — but it is one event, so it gets one
    // caption. The group id is what lets the client draw the kinks per line
    // and the caption once.
    var group = owners.length > 1 ? 's' + gi : null;
    owners.forEach(function (k) {
      stationsOut.push({ owner: k, title: ev.title, location: ev.location || null,
        start_min: ev.startMin, end_min: ev.endMin, group: group });
    });
  });
  // An all-day event is ALSO a station on its owner's line, spanning the
  // whole day — this now REPLACES the old header-strip rendering (an
  // all-day event used to appear only as small text under the date; now
  // it shows as a real kink on the person's own line instead, so a day
  // with a genuine all-day event (a holiday, "Out of office") reads the
  // same way any other station does, deduped by title+owner). `all_day:
  // true` tells the client not to let this (deliberately full-day-wide)
  // span drag the content-fit time window out to match — it always
  // renders across whatever window is chosen, clamped, same as any other
  // station.
  var seenAllDay = {};
  (allDayEvents || []).forEach(function (ev) {
    var track = trackByKey[ev.track];
    if (!track) return;
    var key = ev.title + '|' + track.key;
    if (seenAllDay[key]) return;
    seenAllDay[key] = true;
    stationsOut.push({ owner: track.key, title: ev.title, location: null, start_min: DAY_LO, end_min: DAY_HI, all_day: true });
  });

  (weatherMilestones || []).forEach(function (w) {
    items.push({ type: 'weather', _sortMin: w.atMin, at_min: w.atMin, icon: w.icon, label: w.label });
  });

  ((extra && extra.sun) || []).forEach(function (m) {
    if (m.atMin == null) return;
    items.push({ type: 'sun', _sortMin: m.atMin, at_min: m.atMin, kind: m.kind, icon: WEATHER_ICON_BASE + (m.kind === 'sunrise' ? 'wi-sunrise.svg' : 'wi-sunset.svg'), label: tr((extra && extra.strings) || I18N.en, m.kind) });
  });

  items.sort(function (a, b) { return a._sortMin - b._sortMin; });
  items.forEach(function (item) { delete item._sortMin; });

  return {
    day_start_min: DAY_LO,
    day_end_min: DAY_HI,
    secondary_threshold_min: SECONDARY_THRESHOLD_MIN, // sub-spur grouping window — client decides sub-spurs, but this constant is config, not geometry
    // the day the board actually shows, computed here rather than by the
    // caller, which cannot know it until the events are in
    window_label: timeLabel12(DAY_LO, extra) + ' ' + timeLabel12(DAY_HI, extra),
    date_label: (extra && extra.dateLabel) || null,
    now_min: nowMin != null ? nowMin : null, // minutes since local midnight; the client decides whether/where to draw it
    orientation: (extra && extra.orientation) || 'auto', // auto | horizontal | vertical — client picks for auto from the canvas aspect
    hour12: !!(extra && extra.hour12),
    i18n: (function (st) { return { today: tr(st, 'today'), more: tr(st, 'more'), earlier: tr(st, 'earlier'), rain_pct: tr(st, 'rain_pct') }; })((extra && extra.strings) || I18N.en),
    header_weather: headerWeather,
    legend: tracks,
    all_day: [], // all-day events now render as stations (see stationsOut) instead of a header strip; the key stays for shape compatibility
    stations: stationsOut,
    items: items,
  };
}

// ---------------------------------------------------------------------
// Demo path — unchanged hardcoded data.
// ---------------------------------------------------------------------

// The offline fallback, for when GitHub is unreachable. Hues and patterns
// match what makeTrackRegistry would assign these five from HUE_CYCLE and
// LINE_STYLES, so a device that loses the network does not also change
// colour — and no grey is pinned, so a theme still gets to repaint them.
var DEMO_TRACKS = [
  { key: 'homer', name: 'Homer', side: 'left', hue: 'black', track_offset: -10, line_width: 6, line_style: 'solid' },
  { key: 'lisa', name: 'Lisa', side: 'left', hue: 'red-40', track_offset: -20, line_width: 5.5, line_style: 'dashed' },
  { key: 'marge', name: 'Marge', side: 'right', hue: 'orange-40', track_offset: 10, line_width: 5, line_style: 'dotted' },
  { key: 'bart', name: 'Bart', side: 'right', hue: 'purple-40', track_offset: 20, line_width: 4.5, line_style: 'dashdot' },
  { key: 'maggie', name: 'Maggie', side: 'right', hue: 'cyan-40', track_offset: 30, line_width: 4, line_style: 'dashed' },
];

// A deliberately busy day in Springfield: two meetings starting minutes
// apart on one line (lane stacking), two- and four-track interchanges, a
// long day at school and a shift at the plant as waypoint stations, and an
// evening cluster once everyone is home.
var DEMO_EVENTS = [
  { track: 'marge', interchange_with: ['bart', 'lisa'], title: 'School Run', startMin: 7 * 60 + 45, endMin: 8 * 60 + 15 },
  { track: 'homer', title: 'Shift Briefing', startMin: 8 * 60, endMin: 8 * 60 + 15 },
  { track: 'homer', title: 'Donut Run', startMin: 8 * 60 + 20, endMin: 8 * 60 + 35 },
  { track: 'marge', title: 'Dr. Hibbert', startMin: 10 * 60, endMin: 10 * 60 + 45 },
  { track: 'homer', title: '1:1 with Mr. Burns', startMin: 11 * 60, endMin: 11 * 60 + 30, location: 'The Office' },
  { track: 'marge', interchange_with: ['homer'], title: 'Lunch at Krusty Burger', startMin: 12 * 60, endMin: 13 * 60 },
  { track: 'homer', title: 'Safety Inspection', startMin: 14 * 60, endMin: 15 * 60 },
  { track: 'lisa', title: 'Sax Practice', startMin: 15 * 60 + 30, endMin: 16 * 60 + 15, location: 'Band Room' },
  { track: 'marge', interchange_with: ['bart', 'lisa'], title: 'Pick Up', startMin: 16 * 60, endMin: 16 * 60 + 20 },
  { track: 'bart', title: 'Skate Park', startMin: 16 * 60 + 30, endMin: 17 * 60 + 30 },
  { track: 'marge', title: 'Groceries', startMin: 17 * 60 + 30, endMin: 18 * 60, location: 'Kwik-E-Mart' },
  { track: 'marge', interchange_with: ['homer', 'bart', 'lisa', 'maggie'], title: 'Family Dinner', startMin: 18 * 60 + 30, endMin: 19 * 60 + 30 },
  { track: 'homer', title: "Moe's Tavern", startMin: 19 * 60 + 45, endMin: 21 * 60 },
  { track: 'bart', interchange_with: ['lisa'], title: 'Itchy & Scratchy', startMin: 20 * 60, endMin: 20 * 60 + 30 },
];

// Waypoint stations: the line kinks out to "station level" for the span
// rather than branching, for a place you simply ARE for a while.
var DEMO_STATIONS = [
  { track: 'homer', title: 'Sector 7-G', location: 'Springfield Nuclear', startMin: 9 * 60, endMin: 17 * 60 },
  { track: 'bart', title: 'Springfield Elementary', location: 'Room 12', startMin: 8 * 60 + 30, endMin: 15 * 60 },
  { track: 'lisa', title: 'Springfield Elementary', location: 'Room 4', startMin: 8 * 60 + 30, endMin: 15 * 60 },
];

var DEMO_ALLDAY = [
  { track: 'maggie', title: 'With Grampa' },
];

var DEMO_WEATHER_MILESTONES = [
  { atMin: 15 * 60, icon: 'https://trmnl.com/images/plugins/weather/wi-rain.svg', label: 'Rain Starts 15:00' },
];

var DEMO_NOW_MIN = 11 * 60;
var DEMO_SUN = [{ kind: 'sunrise', atMin: 7 * 60 + 8 }, { kind: 'sunset', atMin: 19 * 60 + 58 }];

function demoWeather(strings) {
  return {
    header: { hi: 21, lo: 13, condition: tr(strings, 'rain'), rain_chance: 60, icon: WEATHER_ICON_BASE + 'wi-day-rain.svg' },
    milestones: [{ atMin: 15 * 60, icon: WEATHER_ICON_BASE + 'wi-rain.svg', label: tr(strings, 'rain_starts') + ' ' + timeLabel(15 * 60) }],
    sun: DEMO_SUN,
  };
}

// The demo can also be driven the way a real setup is: this exact config,
// against ICS files living in this repo's demo/ folder. That keeps the demo
// honest — it exercises fetching, parsing, the rule engine and track
// resolution rather than a hand-built shortcut — and doubles as a worked
// example of the config format. It needs the network, so the hardcoded
// Springfield data above stays as the offline fallback.
var DEMO_ICS_BASE = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-family-calendar/main/demo/';
function demoCalendar(name, file, rules) {
  return { name: name, url: DEMO_ICS_BASE + file, rules: rules };
}
function demoOwnTrack(name, file) {
  return demoCalendar(name, file, [{ match: { type: 'any' }, track: name }]);
}
var DEMO_CONFIG = {
  // Springfield is American, so the demo reads American: US date order and a
  // 12-hour clock, both set here rather than inherited from the account, so
  // the demo looks the same on every device. The zone is deliberately NOT
  // American — it stays European so that the "config overrides the account"
  // path is exercised by the demo every device runs on first boot, instead
  // of only by a test.
  locale: 'en-US',
  timeZone: 'Europe/Brussels',
  timeFormat: '12h',
  // No pinned colours. A track's hue and dash pattern are assigned
  // automatically from the framework's own hue cycle, which is what a THEME
  // remaps — pin "gray-40" and the line stays that grey whatever theme the
  // device is set to. Pinning is still available per track for anyone who
  // wants it; the shipped configs just don't use it.
  tracks: [
    { name: 'Homer', side: 'left' },
    { name: 'Marge' },
    { name: 'Bart' },
    { name: 'Lisa' },
    { name: 'Maggie' },
  ],
  calendars: [
    demoOwnTrack('Homer', 'homer.ics'),
    demoOwnTrack('Marge', 'marge.ics'),
    demoOwnTrack('Bart', 'bart.ics'),
    demoOwnTrack('Lisa', 'lisa.ics'),
    demoOwnTrack('Maggie', 'maggie.ics'),
    // One school calendar split by class code, the way a real school feed
    // is. rename:false throughout — a track assignment rewrites the matched
    // text into the track's name by default, which would turn "Family
    // Dinner" into the entire guest list.
    demoCalendar('School', 'school.ics', [
      { match: { type: 'word', value: 'L6' }, track: 'Bart', rename: false },
      { match: { type: 'word', value: 'K3' }, track: 'Lisa', rename: false },
      { match: { type: 'regex', value: '^(?:L6|K3)\\s+' }, rewrite: '' },
      { match: { type: 'contains', value: 'School Day' }, station: true },
    ]),
    demoCalendar('Family', 'family.ics', [
      { match: { type: 'contains', value: 'Family Dinner' }, track: ['Marge', 'Homer', 'Bart', 'Lisa', 'Maggie'], rename: false },
      { match: { type: 'contains', value: 'School Run' }, track: ['Marge', 'Bart', 'Lisa'], rename: false },
      { match: { type: 'contains', value: 'Spring Break' }, track: 'Bart', allDay: true, rename: false },
    ]),
  ],
};

function buildFromDemo(weather, nowMin, extra) {
  var strings = (extra && extra.strings) || I18N.en;
  var demo = demoWeather(strings);
  var w = weather || demo;
  return buildMetro(
    DEMO_TRACKS, DEMO_EVENTS,
    w.milestones || [],
    w.header || demo.header,
    nowMin != null ? nowMin : DEMO_NOW_MIN,
    timeLabel(DAY_START_MIN) + ' ' + timeLabel(DAY_END_MIN),
    DEMO_ALLDAY,
    Object.assign({}, extra || {}, { sun: (w.sun && w.sun.length) ? w.sun : DEMO_SUN }),
    DEMO_STATIONS.map(function (st) {
      return { track: st.track, title: st.title, location: st.location || null, startMin: st.startMin, endMin: st.endMin };
    })
  );
}

// ---------------------------------------------------------------------
// Weather — Open-Meteo (no API key), same provider/icon convention as
// plugin/src/transform.js's own fetchSky(). Ported parseLatLon/weather
// code mapping rather than re-derived, for the same reason as the TZ
// helpers above: it's already correct, no need to risk a fresh bug.
// ---------------------------------------------------------------------

function parseLatLon(raw) {
  var parts = (raw || '').split(',');
  if (parts.length !== 2) return null;
  var lat = parseFloat(parts[0].trim()), lon = parseFloat(parts[1].trim());
  return (isFinite(lat) && isFinite(lon)) ? [lat, lon] : null;
}

var WEATHER_ICON_BASE = 'https://trmnl.com/images/plugins/weather/';
// code -> { label, icon } — condition text is intentionally coarse (a
// header summary, not a forecast detail); icons reuse the exact
// filenames confirmed present in plugin/src/transform.js's own ICON_FILE
// map, plus wi-day-sunny/wi-day-cloudy for the clear/cloudy default.
function weatherCodeInfo(code) {
  if (code === 0) return { key: 'clear', icon: 'wi-day-sunny.svg' };
  if (code === 1 || code === 2) return { key: 'partly_cloudy', icon: 'wi-day-cloudy.svg' };
  if (code === 3) return { key: 'cloudy', icon: 'wi-day-cloudy.svg' };
  if (code === 45 || code === 48) return { key: 'foggy', icon: 'wi-day-fog.svg' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { key: 'rain', icon: 'wi-day-rain.svg' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { key: 'snow', icon: 'wi-day-snow.svg' };
  if (code >= 95) return { key: 'storms', icon: 'wi-day-thunderstorm.svg' };
  return { key: 'clear', icon: 'wi-day-sunny.svg' };
}

// "2026-09-08T07:05" (Open-Meteo local time) → minutes since midnight
function isoToMinutes(iso) {
  var m = /T(\d{2}):(\d{2})/.exec(iso || '');
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

var RAIN_THRESHOLD = 50; // %, precipitation_probability crossing this is what draws a "Rain Starts/Stops" milestone

async function fetchWeather(latLonRaw, tz, deadline, strings) {
  var latlon = parseLatLon(latLonRaw);
  if (!latlon) return null;
  strings = strings || I18N.en;
  try {
    var params = new URLSearchParams({
      latitude: String(latlon[0]), longitude: String(latlon[1]),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,sunrise,sunset',
      hourly: 'precipitation_probability',
      timezone: tz, forecast_days: '1',
    });
    var budget = deadline - Date.now();
    if (budget <= 0) return null;
    var resp = await fetchWithTimeout('https://api.open-meteo.com/v1/forecast?' + params.toString(), Math.min(budget, 3000));
    if (!resp.ok) return null;
    var body = await resp.json();
    var daily = body.daily || {};
    var info = weatherCodeInfo((daily.weathercode || [])[0]);

    var header = {
      hi: Math.round((daily.temperature_2m_max || [])[0]),
      lo: Math.round((daily.temperature_2m_min || [])[0]),
      condition: tr(strings, info.key),
      rain_chance: Math.round((daily.precipitation_probability_max || [])[0]),
      icon: WEATHER_ICON_BASE + info.icon,
    };
    var sun = [];
    var sr = isoToMinutes((daily.sunrise || [])[0]), ss = isoToMinutes((daily.sunset || [])[0]);
    if (sr != null) sun.push({ kind: 'sunrise', atMin: sr });
    if (ss != null) sun.push({ kind: 'sunset', atMin: ss });

    // Milestones: first threshold up-crossing -> "Rain Starts", the next
    // down-crossing after it -> "Rain Stops" — same idea as the dummy
    // data's illustrative example, just driven from real hourly
    // probabilities within the visible window.
    var hourly = body.hourly || {};
    var times = hourly.time || [];
    var probs = hourly.precipitation_probability || [];
    var milestones = [];
    var wasAbove = false;
    for (var i = 0; i < times.length && milestones.length < 2; i++) {
      var hourMatch = /T(\d{2}):/.exec(times[i]);
      if (!hourMatch) continue;
      var hour = +hourMatch[1];
      var atMin = hour * 60;
      if (atMin < DAY_START_MIN || atMin > DAY_END_MIN) continue;
      var above = (probs[i] || 0) >= RAIN_THRESHOLD;
      if (above && !wasAbove) {
        milestones.push({ atMin: atMin, icon: WEATHER_ICON_BASE + 'wi-rain.svg', label: tr(strings, 'rain_starts') + ' ' + pad2(hour) + ':00' });
      } else if (!above && wasAbove) {
        milestones.push({ atMin: atMin, icon: WEATHER_ICON_BASE + 'wi-day-sunny.svg', label: tr(strings, 'rain_stops') + ' ' + pad2(hour) + ':00' });
      }
      wasAbove = above;
    }

    return { header: header, milestones: milestones, sun: sun };
  } catch (e) {
    return null;
  }
}

async function fetchWithTimeout(url, ms, extraHeaders) {
  var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var headers = Object.assign({ 'User-Agent': 'TRMNL-Metro-Calendar' }, extraHeaders || {});
  var timer = controller ? setTimeout(function () { controller.abort(); }, ms) : null;
  try {
    var resp = await fetch(url, controller ? { signal: controller.signal, headers: headers } : { headers: headers });
    return resp;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Unfold RFC5545 continuation lines (a line starting with a space/tab
// continues the previous one) and split into logical lines.
function unfoldIcs(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeIcsText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Parses a raw DTSTART/DTEND value+params into {y,mo,d,h,mi,isAllDay},
// converted to civil LOCAL (fallbackTz) date/time — this is the "what
// date/time does this property mean, in our target zone" step, kept
// separate from "does that land on today" so the same parsed value can
// be reused for both a direct hit and the weekly-recurrence check below.
function parseIcsDateTime(paramsStr, value, fallbackTz) {
  if (/VALUE=DATE\b/i.test(paramsStr) || /^\d{8}$/.test(value)) {
    var dm = /^(\d{4})(\d{2})(\d{2})/.exec(value);
    return dm ? { isAllDay: true, y: +dm[1], mo: +dm[2], d: +dm[3] } : { isAllDay: true };
  }

  var m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  var evY = +m[1], evMo = +m[2], evD = +m[3], evH = +m[4], evMi = +m[5], evS = +m[6], isUtc = !!m[7];

  var tzidMatch = /TZID=([^:;]+)/.exec(paramsStr);
  var epochMs;
  if (isUtc) {
    epochMs = Date.UTC(evY, evMo - 1, evD, evH, evMi, evS);
  } else {
    var eventTz = (tzidMatch && safeZone(tzidMatch[1])) || fallbackTz;
    epochMs = zonedTimeToUtc(evY, evMo, evD, evH, evMi, evS, eventTz);
  }
  var c = fromEpoch(epochMs, fallbackTz);
  c.isAllDay = false;
  return c;
}

// Bounded RRULE subset: FREQ=WEEKLY only (the pattern real calendar
// exports use constantly for standing meetings/family routines), with
// optional BYDAY and UNTIL. Anything else (DAILY/MONTHLY/YEARLY, COUNT,
// ...) is intentionally not handled — see the file header. RECURRENCE-ID
// overrides ARE handled, in parseIcs below. Returns true if `today`
// (y/mo/d, weekday 0=Mon..6=Sun) is an occurrence.
var WD_NAMES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
function weeklyRruleMatchesToday(rruleValue, dtstartCivil, todayY, todayMo, todayD, todayWeekday, tz) {
  var parts = {};
  rruleValue.split(';').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1);
  });
  if ((parts.FREQ || '').toUpperCase() !== 'WEEKLY') return false;

  var todayOrdinal = Date.UTC(todayY, todayMo - 1, todayD);
  var startOrdinal = Date.UTC(dtstartCivil.y, dtstartCivil.mo - 1, dtstartCivil.d);
  if (todayOrdinal < startOrdinal) return false; // recurrence hasn't started yet

  if (parts.UNTIL) {
    var um = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL);
    if (um && todayOrdinal > Date.UTC(+um[1], +um[2] - 1, +um[3])) return false;
  }

  if (parts.BYDAY) {
    var days = parts.BYDAY.split(',');
    return days.indexOf(WD_NAMES[todayWeekday]) !== -1;
  }
  // No BYDAY: recurs weekly on DTSTART's own weekday.
  var startWeekday = (new Date(startOrdinal).getUTCDay() + 6) % 7; // 0=Mon
  return startWeekday === todayWeekday;
}

// `includeDescription` (a per-calendar config flag, off by default) is the
// only thing that makes parseIcs pay for DESCRIPTION at all — it's usually
// a large multi-line blob and most calendars' rules never need it.
//
// Returns { timed, allDay } — allDay entries carry no time-of-day (they're
// {title, desc, status} only): only whole-day coverage decides whether one
// applies today, matched to the day's own civil date, not a UTC one.
function parseIcs(text, tz, today, includeDescription) {
  var lines = unfoldIcs(text);
  var raw = [];
  var cur = null;
  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { cur = {}; return; }
    if (line === 'END:VEVENT') { if (cur) raw.push(cur); cur = null; return; }
    if (!cur) return;
    var idx = line.indexOf(':');
    if (idx < 0) return;
    var keyPart = line.slice(0, idx);
    var value = line.slice(idx + 1);
    var key = keyPart.split(';')[0];
    var params = keyPart.slice(key.length);
    if (key === 'DTSTART') cur.dtstart = parseIcsDateTime(params, value, tz);
    else if (key === 'DTEND') cur.dtend = parseIcsDateTime(params, value, tz);
    else if (key === 'SUMMARY') cur.title = unescapeIcsText(value);
    else if (key === 'LOCATION') cur.location = unescapeIcsText(value);
    else if (key === 'DESCRIPTION' && includeDescription) cur.desc = unescapeIcsText(value);
    else if (key === 'STATUS') cur.status = value.trim().toUpperCase();
    else if (key === 'RRULE') cur.rrule = value;
    else if (key === 'UID') cur.uid = value.trim();
    else if (key === 'RECURRENCE-ID') cur.recurrenceId = parseIcsDateTime(params, value, tz);
  });

  var todayWeekday = (new Date(Date.UTC(today.y, today.mo - 1, today.d)).getUTCDay() + 6) % 7;
  var todayKey = today.y + '-' + today.mo + '-' + today.d;
  var todayOrdinal = Date.UTC(today.y, today.mo - 1, today.d);
  var DAY_MS = 24 * 60 * 60 * 1000;

  // A RECURRENCE-ID override (same UID, own DTSTART/SUMMARY) REPLACES the
  // master's occurrence on that specific date — without this, an edited
  // or moved single instance of a recurring event shows up twice: once
  // from the master's own weekly-RRULE match, once from the override's
  // own direct-hit DTSTART. Suppress the master on any date an override
  // for its UID targets, keyed by civil date (not exact minute) since
  // that's what RECURRENCE-ID identifies — "which occurrence", not "what
  // time it now is". Applies equally to timed and all-day masters.
  var overriddenDates = {};
  raw.forEach(function (ev) {
    if (!ev.uid || !ev.recurrenceId) return;
    overriddenDates[ev.uid + '|' + ev.recurrenceId.y + '-' + ev.recurrenceId.mo + '-' + ev.recurrenceId.d] = true;
  });

  var out = [], allDay = [];
  raw.forEach(function (ev) {
    if (!ev.title || !ev.dtstart) return;

    if (ev.dtstart.isAllDay) {
      // Whole-day coverage: DTEND is EXCLUSIVE per RFC5545 (a single-day
      // all-day event has DTEND the day AFTER DTSTART) — no DTEND means a
      // single day. A bounded weekly RRULE only applies to a single-day
      // all-day event; a genuine multi-day span (a real vacation/trip) has
      // no recurrence support here, same "bounded subset" limit as timed.
      var startOrd = Date.UTC(ev.dtstart.y, ev.dtstart.mo - 1, ev.dtstart.d);
      var endOrd = (ev.dtend && ev.dtend.isAllDay) ? Date.UTC(ev.dtend.y, ev.dtend.mo - 1, ev.dtend.d) : startOrd + DAY_MS;
      var isDirectSpan = todayOrdinal >= startOrd && todayOrdinal < endOrd;
      var isWeeklySpan = !isDirectSpan && ev.rrule && (endOrd - startOrd) <= DAY_MS
        && weeklyRruleMatchesToday(ev.rrule, ev.dtstart, today.y, today.mo, today.d, todayWeekday, tz);
      if (!isDirectSpan && !isWeeklySpan) return;
      if (!ev.recurrenceId && ev.uid && overriddenDates[ev.uid + '|' + todayKey]) return;
      allDay.push({ title: ev.title, desc: ev.desc || '', status: ev.status || '' });
      return;
    }

    var durationMin = null;
    if (ev.dtend && !ev.dtend.isAllDay) {
      durationMin = (ev.dtend.h * 60 + ev.dtend.mi) - (ev.dtstart.h * 60 + ev.dtstart.mi);
      if (durationMin < 0) durationMin += 24 * 60; // crossed midnight in local time — approximate
    }

    var isDirectHit = ev.dtstart.y === today.y && ev.dtstart.mo === today.mo && ev.dtstart.d === today.d;
    var isWeeklyHit = !isDirectHit && ev.rrule && weeklyRruleMatchesToday(ev.rrule, ev.dtstart, today.y, today.mo, today.d, todayWeekday, tz);
    if (!isDirectHit && !isWeeklyHit) return;

    if (!ev.recurrenceId && ev.uid && overriddenDates[ev.uid + '|' + todayKey]) return; // superseded by today's override

    var startMin = ev.dtstart.h * 60 + ev.dtstart.mi; // same time-of-day, whichever day it landed on
    out.push({
      title: ev.title,
      desc: ev.desc || '',
      status: ev.status || '',
      location: ev.location,
      startMin: startMin,
      endMin: durationMin != null ? startMin + durationMin : null,
    });
  });
  return { timed: out, allDay: allDay };
}

// ---------------------------------------------------------------------
// Rule engine — ported from plugin/src/transform.js's own compileMatcher/
// compileRule/compileRuleList/parseConfig/applyCalendarRules (same config
// shape, same semantics). See the file header for the feature summary.
// ---------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A `track` field can be one name or a list — always normalized to a
// non-empty array (or null if nothing usable was given).
function normalizeNameList(raw) {
  var list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
  var names = list.filter(function (n) { return typeof n === 'string' && n.trim(); }).map(function (n) { return n.trim(); });
  return names.length ? names : null;
}

function compileMatcher(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (spec.type === 'any' || spec.type === 'all') {
    return { rx: /[\s\S]*/i, test: function () { return true; } };
  }
  if (spec.type === 'and' || spec.type === 'or') {
    var subs = (Array.isArray(spec.matchers) ? spec.matchers : []).map(compileMatcher).filter(Boolean);
    if (!subs.length) return null;
    var isAnd = spec.type === 'and';
    return { rx: null, test: function (ctx) {
      return isAnd ? subs.every(function (m) { return m.test(ctx); }) : subs.some(function (m) { return m.test(ctx); });
    } };
  }
  // Negation — the only way to express "everything except X" without this
  // used to be a regex negative lookahead, which meant hand-writing
  // backslash-heavy JSON (\\b) that's easy to mis-escape when copying
  // through a browser field. {"type":"not","matcher":{...}} covers the
  // common case with zero backslashes.
  if (spec.type === 'not') {
    var negated = compileMatcher(spec.matcher);
    if (!negated) return null;
    return { rx: null, test: function (ctx) { return !negated.test(ctx); } };
  }
  if (spec.type === 'status') {
    var want = typeof spec.value === 'string' ? spec.value.trim().toUpperCase() : '';
    if (!want) return null;
    return { rx: null, test: function (ctx) { return ctx.status === want; } };
  }
  if (spec.type === 'weekday') {
    var rawDays = Array.isArray(spec.value) ? spec.value : [spec.value];
    var wanted = {};
    var any = false;
    rawDays.forEach(function (v) {
      if (typeof v !== 'string') return;
      var idx = WD_NAMES.indexOf(v.trim().toUpperCase().slice(0, 2));
      if (idx !== -1) { wanted[idx] = true; any = true; }
    });
    if (!any) return null;
    return { rx: null, test: function (ctx) { return ctx.weekday !== null && ctx.weekday !== undefined && !!wanted[ctx.weekday]; } };
  }
  if (typeof spec.value !== 'string') return null;
  var p = spec.value.trim();
  if (!p) return null;
  var rx;
  if (spec.type === 'regex') {
    try { rx = new RegExp(p, 'i'); } catch (e) { return null; }
  } else if (spec.type === 'contains') {
    rx = new RegExp(escapeRegExp(p), 'i');
  } else if (spec.type === 'exact') {
    rx = new RegExp('^' + escapeRegExp(p) + '$', 'i');
  } else {
    rx = new RegExp('\\b' + escapeRegExp(p) + '\\b', 'i');
  }
  return { rx: rx, test: function (ctx) { return rx.test(ctx.title) || (!!ctx.desc && rx.test(ctx.desc)); } };
}

function compileRule(spec) {
  if (!spec || typeof spec !== 'object') return null;
  var m = compileMatcher(spec.match);
  if (!m) return null;
  // `track` is the current field name; `person` is accepted too, for
  // configs written before tracks were called tracks.
  var track = normalizeNameList(spec.track !== undefined ? spec.track : spec.person);
  var allDay = spec.allDay === true;
  var hide = spec.hide === true;
  // `station`: the event's own track kinks out to "station level" for its
  // duration instead of branching into a lane — for a status/location
  // block (e.g. "Desk booking") that spans real meetings without being
  // one itself. Only meaningful for a timed event with both ends; see
  // buildFromConfig.
  var station = spec.station === true;
  var rewrite = typeof spec.rewrite === 'string' ? spec.rewrite : null;
  var rewriteFull = spec.rewriteFull === true;
  if (!track && !allDay && !hide && !station && rewrite === null) return null; // a no-op rule is dropped, not kept
  var isAnyMatch = spec.match && (spec.match.type === 'any' || spec.match.type === 'all');
  // rename defaults to true (a rule assigning a track also renames the
  // title to that track, historically the common case) EXCEPT on an
  // any/all match, where there's no specific text to rename and silently
  // overwriting every title would be surprising — there it defaults to
  // false and must be opted into.
  var rename = track ? (isAnyMatch ? spec.rename === true : spec.rename !== false) : false;
  return { match: m.test, rx: m.rx, track: track, allDay: allDay, hide: hide, station: station, rename: rename, rewrite: rewrite, rewriteFull: rewriteFull };
}

function compileRuleList(raw) {
  var rules = [];
  (Array.isArray(raw) ? raw : []).forEach(function (spec) {
    var compiled = compileRule(spec);
    if (compiled) rules.push(compiled);
  });
  return rules;
}

// Parses the "Calendar Config (JSON)" setting text into
// { calendars, tracks, timeZone, globalRules, everyoneTrack }. Never
// throws: invalid JSON falls back to treating the text as a plain
// newline-separated list of calendar URLs (a low-friction path for
// someone who just wants to paste ICS links with no rules at all).
function parseConfig(raw) {
  var data = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = { calendars: raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean) };
    }
  }
  if (!data || typeof data !== 'object') data = {};

  function str(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }
  // A config can set its own locale, zone and clock. All three are about how
  // this board should read rather than whose account it is on, so they beat
  // the account settings — a family board hanging in a Belgian kitchen may
  // still want a US-format demo, and the person configuring it is the one
  // who knows.
  var timeZone = str(data.timeZone);
  var locale = str(data.locale);
  var timeFormat = (function () {
    var v = str(data.timeFormat);
    if (!v) return null;
    v = v.toLowerCase();
    return v === '12h' || v === '24h' || v === 'auto' ? v : null;
  })();

  var tracks = {};
  var everyoneTrack = null;
  // `tracks` is the current field name; `people` is accepted too, for
  // configs written before tracks were called tracks.
  (Array.isArray(data.tracks) ? data.tracks : Array.isArray(data.people) ? data.people : []).forEach(function (item) {
    if (!item || typeof item !== 'object') return;
    var name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) return;
    var color = typeof item.color === 'string' ? item.color.trim().toLowerCase() : '';
    var badgeSrc = typeof item.badge === 'string' && item.badge.trim() ? item.badge.trim() : name;
    var badge = Array.from(badgeSrc)[0].toUpperCase(); // Array.from, not [0] — keeps a full surrogate pair (emoji) intact
    // optional explicit side of the map: "left"/"work" or "right"/"family"
    var sideRaw = typeof item.side === 'string' ? item.side.trim().toLowerCase() : '';
    var side = (sideRaw === 'left' || sideRaw === 'work') ? 'left' : (sideRaw === 'right' || sideRaw === 'family') ? 'right' : null;
    if (everyoneTrack === null) everyoneTrack = name;
    tracks[name.toLowerCase()] = { name: name, color: color, badge: badge, side: side };
  });

  var globalRules = compileRuleList(data.rules);

  var calendars = [];
  (Array.isArray(data.calendars) ? data.calendars : []).forEach(function (rawItem) {
    var item = typeof rawItem === 'string' ? { url: rawItem } : rawItem;
    if (!item || typeof item !== 'object' || typeof item.url !== 'string' || !item.url.trim()) return;
    var name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null;
    var rules = compileRuleList(item.rules);
    var headers = {};
    if (item.headers && typeof item.headers === 'object') {
      Object.keys(item.headers).forEach(function (k) {
        if (typeof item.headers[k] === 'string') headers[k] = item.headers[k];
      });
    }
    var includeDescription = item.includeDescription === true;
    calendars.push({ name: name, url: item.url.trim(), rules: rules, headers: headers, includeDescription: includeDescription });
  });

  return { calendars: calendars, tracks: tracks, timeZone: timeZone, locale: locale, timeFormat: timeFormat, globalRules: globalRules, everyoneTrack: everyoneTrack };
}

// A replace that never double-matches an empty-string-capable pattern
// (like the regex "any"/"all" compile to, or a user's own ".*") — a plain
// global replace on such a pattern matches the real text once, then the
// empty string right after it, turning "Ward" into "WardWard".
function replaceMatch(text, rx, replacement) {
  if (rx.test('')) return text.replace(new RegExp(rx.source, rx.flags.replace('g', '')), replacement);
  return text.replace(new RegExp(rx.source, rx.flags.indexOf('g') !== -1 ? rx.flags : rx.flags + 'g'), replacement);
}

// Applies global rules then this calendar's own (cumulatively, in order —
// a later matching rule's track/rewrite overrides an earlier one's,
// and a calendar's own rule is listed after globals so it wins ties).
// Returns { title, trackNames, allDay, hide }; trackNames is an array
// (possibly with more than one name — a multi-track rule becomes an
// interchange event) or null if nothing assigned one.
function applyCalendarRules(title, desc, status, weekday, cal, globalRules, everyoneTrack) {
  var originalTitle = title;
  var ctx = { title: originalTitle, desc: desc || '', status: status || '', weekday: (weekday === undefined || weekday === null) ? null : weekday };
  var trackNames = null;
  var renameRule = null;
  var rewriteRule = null;
  var allDay = false;
  var hide = false;
  var station = false;
  globalRules.concat(cal.rules).forEach(function (rule) {
    if (!rule.match(ctx)) return;
    if (rule.hide) hide = true;
    if (rule.allDay) allDay = true;
    if (rule.station) station = true;
    if (rule.track) {
      trackNames = rule.track;
      renameRule = rule.rename ? rule : null;
    }
    if (rule.rewrite !== null) rewriteRule = rule;
  });

  var finalTitle = originalTitle;
  if (rewriteRule) {
    finalTitle = rewriteRule.rewriteFull ? rewriteRule.rewrite
      : rewriteRule.rx ? replaceMatch(originalTitle, rewriteRule.rx, rewriteRule.rewrite)
      : originalTitle;
  } else if (renameRule && renameRule.rx) {
    finalTitle = replaceMatch(originalTitle, renameRule.rx, renameRule.track.join(' & '));
  }
  // NOTE: everyoneTrack is deliberately NOT applied here — a calendar's
  // own name is meant to be the fallback for one that has no rule
  // assigning anyone (see buildFromConfig), and everyoneTrack is the
  // last resort after THAT. Applying it here unconditionally used to make
  // the calendar-name fallback unreachable dead code: with tracks[] set,
  // EVERY unnamed-by-rule event (i.e. every event from any calendar with
  // no rules at all, or whose rules didn't match this one) landed on
  // everyoneTrack instead of that calendar's own name — so calendars
  // literally named after a track (a common real setup: one calendar per
  // family member, no rules needed) never got their events attributed to
  // themselves at all.

  return { title: finalTitle, trackNames: trackNames, allDay: allDay, hide: hide, station: station };
}

// Converts a config track's `color` (a plain framework hue name like
// "blue", or "gray-NN"/"black"/"white") into the "hue-65"-style token
// this plugin's tracks/nodes use ("hue-40" style) — null (fall back to the auto HUE_CYCLE)
// if unset or not one of those.
function hueTokenForColor(color) {
  if (!color) return null;
  if (HUE_NAMES.indexOf(color) !== -1) return color + '-40';
  if (color === 'black' || color === 'white' || /^gray-\d+$/.test(color)) return color;
  return null;
}

// A small, growable track registry — seeded from parsed.tracks, but
// calendars with no track-assigning rule (e.g. a shared "Family"
// calendar) fall back to using the CALENDAR's own name as an implicit
// track, added here the first time it's encountered, so those events
// still get a track instead of silently vanishing.
//
// Which SIDE each track ends up on is decided once, in finalize() —
// called after every calendar has been fetched and every event tallied —
// not by any calendar's name. A track's `side` in config (if set) is
// honored; everyone else is balanced across the two sides by their own
// event count (heaviest first, each going to whichever side is currently
// lighter), so the split reflects the actual day's data instead of a
// fixed "Work calendar" convention.
function makeTrackRegistry(parsed) {
  var order = [];
  var byName = {};
  var counts = {};
  var keyIdx = 0;

  function add(name, weight) {
    if (!byName[name]) {
      byName[name] = { key: 'p' + (keyIdx++), name: name, side: null, hue: null, track_offset: null, line_width: null, line_style: null, initial: null };
      order.push(name);
      counts[name] = 0;
    }
    counts[name] += (weight == null ? 1 : weight);
    return byName[name];
  }

  function explicitSide(name) {
    var c = parsed.tracks[name.toLowerCase()];
    return (c && (c.side === 'left' || c.side === 'right')) ? c.side : null;
  }

  // How often two tracks are in the same place at the same time. Every
  // shared event links each pair it joins, and those links decide the ORDER
  // the lines are laid out in: a family that eats dinner together should not
  // have to read across two other people's days to see that they did.
  var affinity = {};
  function pairKey(a, b) { return a < b ? a + '\u0000' + b : b + '\u0000' + a; }
  function link(names, weight) {
    for (var i = 0; i < names.length; i++) {
      for (var j = i + 1; j < names.length; j++) {
        var k = pairKey(names[i], names[j]);
        affinity[k] = (affinity[k] || 0) + (weight == null ? 1 : weight);
      }
    }
  }
  function affinityOf(a, b) { return affinity[pairKey(a, b)] || 0; }

  // Lay the tracks out as ONE chain, strongest link first, then extended at
  // whichever end offers the strongest next link. The board is a chain too —
  // outermost left ... innermost left, spine, innermost right ... outermost
  // right — so a chain laid along it keeps every consecutive pair adjacent,
  // including the pair either side of the spine. Cutting it anywhere gives a
  // valid two-sided layout, which is what lets the split be chosen for
  // balance without disturbing the order.
  function affinityChain() {
    var left = order.slice();
    if (left.length < 3) return left;
    var best = null;
    for (var i = 0; i < left.length; i++) {
      for (var j = i + 1; j < left.length; j++) {
        var w = affinityOf(left[i], left[j]);
        if (!best || w > best.w || (w === best.w && counts[left[i]] + counts[left[j]] > best.c)) {
          best = { a: left[i], b: left[j], w: w, c: counts[left[i]] + counts[left[j]] };
        }
      }
    }
    var chain = [best.a, best.b];
    left = left.filter(function (n) { return n !== best.a && n !== best.b; });
    while (left.length) {
      var pick = null;
      left.forEach(function (n) {
        [['head', chain[0]], ['tail', chain[chain.length - 1]]].forEach(function (endp) {
          var w = affinityOf(n, endp[1]);
          if (!pick || w > pick.w || (w === pick.w && counts[n] > counts[pick.n])) {
            pick = { n: n, end: endp[0], w: w };
          }
        });
      });
      if (pick.end === 'head') chain.unshift(pick.n); else chain.push(pick.n);
      left = left.filter(function (n) { return n !== pick.n; });
    }
    return chain;
  }

  function finalize() {
    var chain = affinityChain();
    var total = chain.reduce(function (a, n) { return a + counts[n]; }, 0);

    // Cut the chain once. Everything before the cut goes left, everything
    // after goes right, and the chain's order is preserved on the board. The
    // cut is chosen to balance the two sides AND to fall on a weak link, so
    // the people who are together most stay on one side of the spine; an
    // explicit `side` in the config rules out any cut that would contradict
    // it, and if nothing satisfies every pin the balance alone decides.
    // k runs from -1 (everything right) to length-1 (everything left), so a
    // board where every track is pinned to one side still has a cut that
    // honours the pins. The balance term makes those ends expensive, so they
    // only win when nothing else satisfies the pins.
    var bestCut = null;
    for (var k = -1; k < chain.length; k++) {
      var leftNames = chain.slice(0, k + 1), rightNames = chain.slice(k + 1);
      var pinOk = leftNames.every(function (n) { return explicitSide(n) !== 'right'; })
               && rightNames.every(function (n) { return explicitSide(n) !== 'left'; });
      var lw = leftNames.reduce(function (a, n) { return a + counts[n]; }, 0);
      var edge = (k < 0 || k >= chain.length - 1);
      var cost = Math.abs(lw - (total - lw))
               + (edge ? 0 : affinityOf(chain[k], chain[k + 1]) * 3);
      if (!bestCut || (pinOk && !bestCut.pinOk) || (pinOk === bestCut.pinOk && cost < bestCut.cost)) {
        bestCut = { k: k, cost: cost, pinOk: pinOk };
      }
    }
    var cut = bestCut ? bestCut.k : Math.floor((chain.length - 1) / 2);

    // The map's anchor line: black and boldest. The first track the config
    // names, which is also the one any unassigned event falls back to — the
    // household's main line. Failing that (a config that names no tracks at
    // all, or lists none that survived), the busiest line. It used to be
    // whichever line happened to sit innermost-left, which the chain no
    // longer decides by load.
    var configured0 = order.filter(function (n) { return parsed.tracks[n.toLowerCase()]; })[0];
    var anchor = configured0 || chain.slice().sort(function (a, b) { return counts[b] - counts[a]; })[0];

    var boardOrder = chain.slice();
    boardOrder.forEach(function (name, pos) {
      var t = byName[name];
      var side = pos <= cut ? 'left' : 'right';
      // the chain runs outward-left to outward-right, so the slot nearest
      // the spine is the LAST left entry and the FIRST right one
      var idx = side === 'left' ? cut - pos : pos - cut - 1;
      var configured = parsed.tracks[name.toLowerCase()];
      t.side = side;
      t.track_offset = TRACK_STEP * (idx + 1) * (side === 'left' ? -1 : 1);
      t.hue = (configured && hueTokenForColor(configured.color)) || (name === anchor ? 'black' : HUE_CYCLE[pos % HUE_CYCLE.length]);
      t.line_width = name === anchor ? 6 : 4.5;
      t.initial = (configured && configured.badge) || Array.from(name)[0].toUpperCase();
    });
    // Dash patterns are handed out GLOBALLY, in the order the lines appear on
    // the board, not per side. Per side, the second line on the left and the
    // second on the right both got "dashed" — and since every hue collapses
    // to the same grey on a greyscale panel, that left two lines a reader
    // cannot tell apart. Colour is decoration on this hardware; the pattern
    // is the identity, so it has to be unique.
    //
    // Past a full lap of the four patterns the lines also thin out, so a
    // sixth track is a thinner dashed rather than a second identical one.
    // Weight is the other half of telling lines apart. Every line is solid
    // and thick, so the ladder runs heavy to light in board order and pairs
    // with the four treatments — a reader separating two lines has both a
    // texture and a thickness to go on, and neither depends on colour.
    var WEIGHTS = [5.5, 5, 4.5, 4, 3.5];
    var styleIdx = 0;
    boardOrder.forEach(function (name) {
      var t = byName[name];
      if (name === anchor) { t.line_style = 'solid'; return; }
      var lap = Math.floor(styleIdx / (LINE_STYLES.length - 1));
      t.line_style = LINE_STYLES[1 + (styleIdx % (LINE_STYLES.length - 1))];
      t.line_width = WEIGHTS[Math.min(styleIdx, WEIGHTS.length - 1)];
      if (lap > 0) t.line_width = Math.max(3, t.line_width - lap * 0.5);
      styleIdx++;
    });
  }

  return {
    add: add,
    link: link,
    byName: byName,
    finalize: finalize,
    all: function () {
      var arr = order.map(function (n) { return byName[n]; });
      return arr.filter(function (p) { return p.side === 'left'; }).concat(arr.filter(function (p) { return p.side === 'right'; }));
    },
  };
}

async function buildFromConfig(input, parsed, weather, extra) {
  var tz = resolveTz(parsed.timeZone, input); // config.timeZone > account time_zone_iana > account utc_offset > UTC
  var nowTs = (input.trmnl && input.trmnl.system && input.trmnl.system.timestamp_utc) || Math.floor(Date.now() / 1000);
  var today = fromEpoch(nowTs * 1000, tz);
  var nowMin = today.h * 60 + today.mi;
  var todayWeekday = (new Date(Date.UTC(today.y, today.mo - 1, today.d)).getUTCDay() + 6) % 7;

  var registry = makeTrackRegistry(parsed);
  // Every explicitly-configured track is registered up front, even with
  // zero events today, so they still get a line and (if they set an
  // explicit side) it's honored regardless of load.
  Object.keys(parsed.tracks).forEach(function (key) { registry.add(parsed.tracks[key].name, 0); });

  var DEADLINE_MS = 4200;
  var deadline = Date.now() + DEADLINE_MS;
  var events = [];
  var allDayEvents = [];
  var stationEvents = [];

  await Promise.all((parsed.calendars || []).map(async function (cal) {
    var url = cal.url;
    if (url.indexOf('webcal://') === 0) url = 'https://' + url.slice('webcal://'.length);
    try {
      var budget = deadline - Date.now();
      if (budget <= 0) return;
      var resp = await fetchWithTimeout(url, Math.min(budget, 4000), cal.headers);
      if (!resp.ok) return;
      var text = await resp.text();
      var parsedIcs = parseIcs(text, tz, today, cal.includeDescription);
      parsedIcs.timed.forEach(function (ev) {
        var resolved = applyCalendarRules(ev.title, ev.desc, ev.status, todayWeekday, cal, parsed.globalRules, parsed.everyoneTrack);
        if (resolved.hide) return;
        var trackNames = resolved.trackNames || (cal.name ? [cal.name] : null) || (parsed.everyoneTrack ? [parsed.everyoneTrack] : null);
        if (!trackNames || !trackNames.length) return;
        // A rule can mark an otherwise-timed event allDay (e.g. a calendar
        // that lists "Public Holiday" as a timed 00:00 entry) — that now
        // routes into the all-day strip instead of the timeline, same as a
        // genuine ICS all-day entry, rather than being silently dropped.
        if (resolved.allDay) { allDayEvents.push({ track: registry.add(trackNames[0], 0.25).key, title: resolved.title }); return; }
        // A rule can mark a timed event as a station: a status/location
        // block (e.g. "Desk booking") that its own track passes through
        // rather than branches for — needs real start/end minutes, so
        // only meaningful here in the timed-events loop.
        if (resolved.station) {
          stationEvents.push({
            track: registry.add(trackNames[0], 0.25).key,
            title: resolved.title,
            location: ev.location || null,
            startMin: ev.startMin,
            endMin: ev.endMin != null ? ev.endMin : ev.startMin + 30,
          });
          return;
        }
        var primary = registry.add(trackNames[0], 1);
        // a co-owner on a shared/interchange event gets a smaller weight
        // toward side balancing — they have a ring there too, but it's not
        // "their" event the way the primary owner's is
        var interchangeWith = trackNames.slice(1).map(function (n) { return registry.add(n, 0.5).key; });
        if (trackNames.length > 1) registry.link(trackNames);
        events.push({
          track: primary.key,
          interchange_with: interchangeWith.length ? interchangeWith : undefined,
          title: resolved.title,
          startMin: ev.startMin,
          endMin: ev.endMin != null ? ev.endMin : ev.startMin + 30,
          location: ev.location || null,
        });
      });
      parsedIcs.allDay.forEach(function (ev) {
        var resolved = applyCalendarRules(ev.title, ev.desc, ev.status, todayWeekday, cal, parsed.globalRules, parsed.everyoneTrack);
        if (resolved.hide) return;
        var trackNames = resolved.trackNames || (cal.name ? [cal.name] : null) || (parsed.everyoneTrack ? [parsed.everyoneTrack] : null);
        if (!trackNames || !trackNames.length) return;
        allDayEvents.push({ track: registry.add(trackNames[0], 0.25).key, title: resolved.title });
      });
    } catch (e) {
      // one calendar failing shouldn't blank the whole render — skip it
    }
  }));

  // ---- one event, drawn once -------------------------------------------
  //
  // Two calendars can describe the SAME thing. Bart's "L6 School Day" and
  // Lisa's "L2 School Day" both rename to "School Day", run the same hours,
  // and are the same school day — but they arrived as two events and were
  // drawn as two stations with two captions, on lines that could be at
  // opposite ends of the board. Anything with the same title over the same
  // minutes is one event on several lines.
  //
  // Merging them here rather than in the template also means the layout
  // learns that those two people are together, which is what decides the
  // order the lines are laid out in.
  function mergeAcrossTracks(list) {
    var byWhat = {}, out = [];
    list.forEach(function (ev) {
      var k = ev.title + '\u0000' + ev.startMin + '\u0000' + ev.endMin;
      var seen = byWhat[k];
      if (!seen) { byWhat[k] = ev; out.push(ev); return; }
      var mine = [seen.track].concat(seen.interchange_with || []);
      if (mine.indexOf(ev.track) >= 0) return;             // the same track twice: a duplicate, drop it
      seen.interchange_with = (seen.interchange_with || []).concat([ev.track]);
      if (!seen.location && ev.location) seen.location = ev.location;
    });
    return out;
  }
  var keyToName = {};
  Object.keys(registry.byName).forEach(function (n) { keyToName[registry.byName[n].key] = n; });
  function linkMerged(list) {
    list.forEach(function (ev) {
      if (!ev.interchange_with || !ev.interchange_with.length) return;
      var names = [ev.track].concat(ev.interchange_with)
        .map(function (k) { return keyToName[k]; }).filter(Boolean);
      if (names.length > 1) registry.link(names);
    });
  }
  events = mergeAcrossTracks(events);
  stationEvents = mergeAcrossTracks(stationEvents);
  linkMerged(events);
  linkMerged(stationEvents);

  events.sort(function (a, b) { return a.startMin - b.startMin; });
  registry.finalize(); // every calendar is in and every event tallied — decide sides now

  return buildMetro(
    registry.all(), events,
    (weather && weather.milestones) || [],
    (weather && weather.header) || { hi: null, lo: null, condition: null, rain_chance: null },
    nowMin,
    timeLabel(DAY_START_MIN) + ' ' + timeLabel(DAY_END_MIN),
    allDayEvents,
    Object.assign({}, extra, { dateLabel: dateLabel(today, extra.locale), sun: (weather && weather.sun) || [] }),
    stationEvents
  );
}

// ---------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------

async function run(input) {
  var useDemoRaw = cf(input, 'use_demo_data').trim().toLowerCase();
  var useDemo = useDemoRaw !== 'false'; // default true (demo) unless explicitly turned off
  var configRaw = cf(input, 'config_json').trim();
  var latLonRaw = cf(input, 'lat_lon').trim();
  // The timeline runs along whichever side of the canvas is longer. That is
  // the only answer that is ever right — a vertical timeline on a landscape
  // panel wastes most of the board — so it is no longer a setting to get
  // wrong. The field still travels in the payload, always 'auto', because
  // the template reads it and a device on an older build still sends one.
  var orientation = 'auto';
  // Parse once, up front: locale, zone and clock all come from the config
  // when it sets them, and the demo is driven by a config too, so both paths
  // read the same three settings from the same place. (Demo mode may still
  // fall back to the built-in day further down; that fallback keeps whatever
  // locale and clock were resolved here.)
  var effectiveCfg = (useDemo || !configRaw) ? parseConfig(JSON.stringify(DEMO_CONFIG)) : parseConfig(configRaw);
  var locale = effectiveCfg.locale || userLocale(input);
  var strings = stringsFor(locale);
  var hour12 = resolveHour12(
    (effectiveCfg.timeFormat || cf(input, 'time_format').trim()).toLowerCase(), locale);
  var extra = { orientation: orientation, locale: locale, strings: strings, hour12: hour12 };

  var deadline = Date.now() + 4200;

  if (useDemo || !configRaw) {
    // Demo mode has no config.timeZone of its own — resolve straight to
    // the account's own zone/offset (still falling back to UTC) so the
    // "now" marker and any real weather fetch land on the viewer's
    // actual local day, not an arbitrary fixed one.
    var demoTz = resolveTz(effectiveCfg.timeZone, input);
    var demoNowMin = null;
    var demoDate = null;
    try {
      var nowTsDemo = (input.trmnl && input.trmnl.system && input.trmnl.system.timestamp_utc) || Math.floor(Date.now() / 1000);
      var demoToday = fromEpoch(nowTsDemo * 1000, demoTz);
      demoNowMin = demoToday.h * 60 + demoToday.mi;
      demoDate = dateLabel(demoToday, locale);
    } catch (e) { /* keep the illustrative fixed DEMO_NOW_MIN on failure */ }
    var liveWeather = latLonRaw ? await fetchWeather(latLonRaw, typeof demoTz === 'string' ? demoTz : 'GMT', deadline, strings) : null;
    var demoExtra = Object.assign({ dateLabel: demoDate }, extra);
    // Prefer driving the demo through the real pipeline against this repo's
    // own ICS files, so what it shows is what a working config produces.
    // Any failure — offline device, GitHub unreachable, a bad fetch — falls
    // straight back to the built-in Springfield data rather than an empty
    // board, so the demo is never blank.
    try {
      var demoMetro = await buildFromConfig(input, effectiveCfg, liveWeather, demoExtra);
      // Every demo member has something on every day, so all of them must
      // come back. Anything less means some calendars failed while others
      // answered — a stale CDN copy, a 404 on a newly added file — and a
      // half-resolved board (two lines out of five, someone else's events)
      // is worse than the offline day. "Some lines appeared" is not a
      // successful demo.
      // The demo is a known quantity: these five lines, no others. Every
      // member has something on every day, and every school/family entry
      // matches a rule that routes it to one of them, so a correct demo
      // resolves to exactly this set. Anything else means the pipeline read
      // something other than what this repo ships — a stale CDN copy of one
      // calendar while the rest are current is the case that actually
      // happens, and it renders a mixed board that is nobody's day. An
      // unexpected line is as wrong as a missing one; both fall back.
      var want = DEMO_CONFIG.tracks.map(function (t) { return t.name; });
      var got = (demoMetro && demoMetro.legend ? demoMetro.legend : []).map(function (t) { return t.name; });
      var complete = want.length === got.length
        && want.every(function (n) { return got.indexOf(n) >= 0; });
      if (complete) return { metro: demoMetro };
    } catch (e) { /* fall through to the offline demo below */ }
    return { metro: buildFromDemo(liveWeather, demoNowMin, demoExtra) };
  }

  var parsed = effectiveCfg; // never throws — falls back to a bare URL list on invalid JSON
  if (!parsed.calendars.length) {
    return { metro: buildFromDemo(null, null, extra) }; // nothing usable in the config — degrade to demo rather than error the render
  }

  try {
    var configTz = resolveTz(parsed.timeZone, input);
    var weather = latLonRaw ? await fetchWeather(latLonRaw, typeof configTz === 'string' ? configTz : 'GMT', deadline, strings) : null;
    return { metro: await buildFromConfig(input, parsed, weather, extra) };
  } catch (e) {
    return { metro: buildFromDemo(null, null, extra) };
  }
}

if (typeof module !== 'undefined') module.exports = run;
