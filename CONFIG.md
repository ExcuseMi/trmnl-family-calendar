# Calendar Config reference

The **Calendar Config (JSON)** field accepts either plain text (one ICS URL
per line) or a JSON object with this shape. Unknown keys are ignored
silently, so check spelling.

```
{
  "timeZone"?: string,            // IANA zone, e.g. "Europe/Brussels" (default: TRMNL account zone)
  "locale"?: string,              // "en", "fr", "es", "de", "nl", "en-US", … (default: account language)
  "tracks"?: Track[],
  "rules"?: Rule[],               // applied to every calendar, before the calendar's own rules
  "calendars": (string | Calendar)[]
}
```

(Legacy configs may use `"people"` in place of `"tracks"`; still accepted,
for anyone who set this up before tracks were called tracks.)

## Track

```
{ "name": "Alex", "hideIfEmpty"?: boolean }
```

- Each track is one line on the map. Order matters: the first track is the
  fallback for any event no rule assigns, and lines on the same side get
  their dash pattern in order (solid, dashed, dotted, dash-dot).
- A track is otherwise just a name. Which side of the map it runs on, what
  colour it is and which dash pattern it gets are all decided from the day
  itself: sides are balanced once every calendar is fetched, whoever has the
  most events today going first and each track landing on whichever side is
  currently lighter, then each side's lines take solid, dashed, dotted,
  dash-dot in order. On 1-bit panels every line is black and only the
  pattern tells them apart; on 2/4-bit panels the shade follows the panel's
  own theme.
- `hideIfEmpty`: `false` keeps this track's line on the board on a day it
  has nothing on it. By default a track with no events, stations or all-day
  entries today gets no line, so a day when most of the family is idle does
  not spend the board's depth on empty rails. Turn it off for anyone whose
  line should always be there, so the board reads the same shape every day.

Tracks that appear in rules but not in `tracks` are added automatically.

### `side` and `color`: read, not offered

Older configurations set `"side": "left" | "right"` (also spelled `"work"` /
`"family"`) and `"color"` (a hue name, `black`, or `gray-10` … `gray-75`) on
a track. **Both are still read and still honoured**, so nothing you already
have breaks, and the configuration editor writes back whatever it imported.
They are no longer offered anywhere, though, and there is no reason to add
one to a new configuration: the automatic choice is made against the day's
real event counts and the device's own theme, which is more than a fixed
value in a config file can know.

## Calendar

```
{
  "url": "https://…/calendar.ics",       // or webcal://
  "name"?: "Work",
  "rules"?: Rule[],
  "headers"?: { "Authorization": "…" },  // sent with the feed request
  "includeDescription"?: boolean,        // let rules also match DESCRIPTION (off by default)
  "hideIfEmpty"?: boolean                // false keeps this calendar's line on a day it has nothing (default true)
}
```

A bare string in `calendars` is shorthand for `{ "url": … }`.

**`name` is not a caption: it can become a line.** An event that no rule
routes falls back to the calendar's `name`, then to the first entry in
`tracks`, then to the feed's own `X-WR-CALNAME`. Whichever wins is drawn as
a *line* on the map. So a calendar called `"Deliveries"` that leaks a single
unrouted event puts a "Deliveries" line on a board that was meant to have
one line per person, and nothing in the JSON says so.

Name a calendar after the person whose line it is (`"name": "Alex"` beside a
rule routing everything to Alex), or leave `name` off entirely when its
rules route every event somewhere. Count the lines a configuration produces
before saving it: one per entry in `tracks`, plus one for every named
calendar that can still leak an unrouted event.

`hideIfEmpty: false` is the same switch as the one on a track, put where the
line is actually declared for the common setup of one calendar per person.
A calendar kept this way also keeps its line when the feed is *unreachable*,
not only when it is empty, so an hour of downtime does not quietly remove
somebody from the board. That needs a `name`: an unnamed calendar's line is
named after the feed, and there is nothing to name it until the feed
answers.

## Rule

```
{
  "match": Matcher,
  "track"?: string | string[],    // put the event on this line; several = a shared event (capsule)
  "rename"?: boolean,             // replace the matched text with the track's name (default true, false for "any")
  "rewrite"?: string,             // replace the matched text (or the whole title with rewriteFull)
  "rewriteFull"?: boolean,
  "hide"?: boolean,
  "station"?: boolean             // its own track kinks to "station level" for its span, instead of branching into a lane
}
```

(Legacy rules may use `"person"` in place of `"track"`; still accepted.)

A `station` event needs both a start and end time (it only applies to a
timed event, never an all-day one). Use it for a status/location block that
spans real meetings without being one itself: a synced-in "Desk booking",
an "In the office" block, anything you don't want competing for lane space
with the actual meetings inside it:

```json
{
  "match": { "type": "word", "value": "Desk booking" },
  "station": true
}
```

The event's own track draws a shallow 45° kink out to a raised "station
level" for exactly that event's [start, end] span, with a small ring at
each end and a caption riding the line: no lane, no label run, no branch.
Real meetings during that span still fork off the line normally, they just
aren't crowded out by a long status block hogging the innermost lane.

Rules run in order, global ones first; for each effect the last matching
rule wins, so a calendar's own rule overrides a global one.

## Matcher

```
{ "type": "word",     "value": "L2" }        // whole word, case-insensitive
{ "type": "contains", "value": "staff" }
{ "type": "exact",    "value": "Standup" }
{ "type": "regex",    "value": "^Piano" }    // double every backslash in JSON
{ "type": "status",   "value": "tentative" } // confirmed | tentative | cancelled
{ "type": "weekday",  "value": ["MO", "WE"] }
{ "type": "any" }
{ "type": "and" | "or", "matchers": [Matcher, …] }
{ "type": "not", "matcher": Matcher }
```

Combine `and`/`or`/`not` to express "one of these, but not that one" without
ever touching a regex. For example, hide every class code except two of your own:

```json
{
  "match": {
    "type": "and",
    "matchers": [
      { "type": "or", "matchers": [
        { "type": "word", "value": "L1" }, { "type": "word", "value": "L3" }
      ] },
      { "type": "not", "matcher": { "type": "word", "value": "L2" } }
    ]
  },
  "hide": true
}
```

A regex negative lookahead can express the same thing more compactly, but
needs every backslash doubled in JSON (`\\b`), an easy way to end up with a
rule that silently matches nothing if something along the way (a paste, a
rich-text field) re-escapes it again. Prefer `not` unless you need a real
regex feature `and`/`or`/`not` can't express.

## Example

[demo-config.json](demo-config.json) is a complete working example with a
work calendar, per-track calendars, a school calendar split by class code,
and a shared family calendar.

The [configuration editor](https://excusemi.github.io/trmnl-metro-calendar-plugin/tools/config-editor.html)
carries three more, in
the **Start** section's preset dropdown, for when you have no ICS links yet:

- **Family of 4**: one calendar per person plus a shared household feed.
  Dinner and the school run are `track` lists, so they are drawn once as an
  interchange rather than once per person; the school feed's menu postings
  are hidden, and the quiet toddler's line is kept with `hideIfEmpty`.
- **Work vs Personal Split**: two lines for one person. The office day is a
  `station` the work line runs through instead of a label lane of its own,
  and a top-level rule hides cancelled holds in every calendar.
- **Solo Freelancer Track**: one work feed fanned out into a line per
  client on the title prefix, which a `rewrite` then strips, so the board
  reads "Sprint review" and not "Acme: Sprint review".

Each loads into the editor exactly as an import does, with placeholder
`calendar.example.com` links to swap for your own, and none of them sets
`side` or `color`.
