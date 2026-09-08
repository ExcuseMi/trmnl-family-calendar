# Metro Calendar for TRMNL

Your family's day drawn as a transit map. One line per person runs along a
central spine with the hour axis down its middle; events are stations,
labels sit on 45° branches, long events loop out and rejoin their line, and
the whole thing lays itself out to the screen it lands on: TRMNL OG, OG V2,
TRMNL X in landscape or portrait, and every mashup size.

![TRMNL X, landscape](docs/trmnl-x-landscape.png)

It runs entirely on TRMNL **Serverless**: `plugin/src/transform.js` fetches
your ICS feeds and normalises them, `plugin/src/shared.liquid` draws the map.
No server of your own.

## What it shows

- Today, 07:00–21:00 (narrowed around now on small views), with "+N earlier"
  and "+N more" counts at the ends of the line.
- Work on one side of the spine, family on the other. Each person's line has
  its own dash pattern (and shade on grayscale panels), is named where it
  enters the map, and appears in the legend.
- Events as rings at their true start time; shared events as capsules across
  the lines involved. Title, time and location on the branch.
- The current time, sunrise and sunset, and rain start/stop markers across
  the map; today's high/low and conditions in the header.
- English, French, Spanish, German and Dutch, following your TRMNL account
  language; 12- or 24-hour clocks.

## Setup

1. In TRMNL: **Plugins → Private Plugins → New**, name it, save. Then from
   this repo's `plugin/` folder run `trmnlp push` (it uploads settings,
   templates and `transform.js`).
2. The plugin starts with demo data. To show your own calendars turn **Use
   Demo Data** off and paste a configuration into **Calendar Config (JSON)**.
   Build it with the [Configuration editor](https://excusemi.github.io/trmnl-metro-calendar-plugin/tools/config-editor.html),
   which also previews the map at every device size, or write it by hand
   (see [CONFIG.md](CONFIG.md)). The simplest possible config is one ICS
   link per line.
3. Optional settings: **Timeline Orientation** (auto picks horizontal on a
   landscape screen), **Time Format**, and **Location** for weather and sun
   times.

### Getting an ICS link

- Google Calendar: calendar settings → *Secret address in iCal format*.
- Apple iCloud: share the calendar as public, copy the `webcal://` link.
- Outlook: calendar settings → *Shared calendars* → publish → ICS link.

## Configuration in one glance

```json
{
  "people": [
    { "name": "Sam", "side": "work" },
    { "name": "Alex" },
    { "name": "Kids", "color": "gray-40" }
  ],
  "calendars": [
    { "name": "Work", "url": "https://…/work.ics", "rules": [{ "match": { "type": "any" }, "person": "Sam" }] },
    { "name": "Alex", "url": "https://…/alex.ics", "rules": [{ "match": { "type": "any" }, "person": "Alex" }] },
    { "name": "School", "url": "https://…/school.ics",
      "rules": [{ "match": { "type": "word", "value": "L2" }, "person": "Kids" }, { "match": { "type": "contains", "value": "staff" }, "hide": true }] }
  ]
}
```

Rules match on the title (`word`, `contains`, `exact`, `regex`, `status`,
`weekday`, `any`, or `and`/`or` of those) and can assign one or more people,
rewrite the title, or hide the event. Everything is documented in
[CONFIG.md](CONFIG.md); the design of the map itself in [DESIGN.md](DESIGN.md).

Limits worth knowing: recurring events are expanded for `FREQ=WEEKLY` rules
(with `BYDAY`/`UNTIL`) plus any single occurrence dated today; all-day events
are not drawn.

## Development

```bash
cd plugin && trmnlp serve      # local preview at http://127.0.0.1:4567
./test.sh                      # transform + editor test suites (Node only)
```

The layout is verified with headless-Chrome screenshots of `trmnlp build`
output at real device sizes; the renders in `docs/` come from that. The
editor needs to be served over http to load the plugin template for its
preview (`python3 -m http.server` from the repo root works).

## License

MIT, see [LICENSE](LICENSE).
