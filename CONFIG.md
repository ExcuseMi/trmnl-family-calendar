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
{ "name": "Alex", "color"?: string, "side"?: "work" | "family" }
```

- Each track is one line on the map. Order matters: the first track is the
  fallback for any event no rule assigns, and lines on the same side get
  their dash pattern in order (solid, dashed, dotted, dash-dot).
- `color`: a hue name (`blue`, `green`, `orange`, `purple`, `red`, `cyan`,
  `pink`, `lime`, `violet`, `yellow`), `black`, or `gray-10` … `gray-75`
  (10 darkest). On 1-bit panels every line is black and only the pattern
  differs; on grayscale panels a hue renders as a mid gray. Default: the
  first line on its side is black, the others cycle hues.
- `side`: `"left"` (top in horizontal layouts, left in vertical) or
  `"right"` (the other side) pins that track there. Without it, sides are
  balanced automatically once every calendar is fetched: whoever has the
  most events today goes first, each track landing on whichever side is
  currently lighter, so the split follows the actual day, not a fixed rule.

- `hideIfEmpty`: `false` keeps this track's line on the board on a day it
  has nothing on it. By default a track with no events, stations or all-day
  entries today gets no line, so a day when most of the family is idle does
  not spend the board's depth on empty rails. Turn it off for anyone whose
  line should always be there, so the board reads the same shape every day.

Tracks that appear in rules but not in `tracks` are added automatically.

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

A bare string in `calendars` is shorthand for `{ "url": … }`. Events from a
calendar with no matching rule go to the first track; a calendar with no
track at all becomes its own line, named after the calendar.

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
