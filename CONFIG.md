# Calendar Config reference

The **Calendar Config (JSON)** field accepts either plain text (one ICS URL
per line) or a JSON object with this shape. Unknown keys are ignored
silently, so check spelling.

```
{
  "timeZone"?: string,            // IANA zone, e.g. "Europe/Brussels" (default: TRMNL account zone)
  "locale"?: string,              // "en", "fr", "es", "de", "nl", "en-US", … (default: account language)
  "people"?: Person[],
  "rules"?: Rule[],               // applied to every calendar, before the calendar's own rules
  "calendars": (string | Calendar)[]
}
```

## Person

```
{ "name": "Alex", "color"?: string, "side"?: "work" | "family" }
```

- Each person is one line on the map. Order matters: the first person is the
  fallback for any event no rule assigns, and lines on the same side get
  their dash pattern in order (solid, dashed, dotted, dash-dot).
- `color`: a hue name (`blue`, `green`, `orange`, `purple`, `red`, `cyan`,
  `pink`, `lime`, `violet`, `yellow`), `black`, or `gray-10` … `gray-75`
  (10 darkest). On 1-bit panels every line is black and only the pattern
  differs; on grayscale panels a hue renders as a mid gray. Default: the
  first line on its side is black, the others cycle hues.
- `side`: `"left"` (top in horizontal layouts, left in vertical) or
  `"right"` (the other side) pins that person there. Without it, sides are
  balanced automatically once every calendar is fetched: whoever has the
  most events today goes first, each person landing on whichever side is
  currently lighter — so the split follows the actual day, not a fixed rule.

People who appear in rules but not in `people` are added automatically.

## Calendar

```
{
  "url": "https://…/calendar.ics",       // or webcal://
  "name"?: "Work",
  "rules"?: Rule[],
  "headers"?: { "Authorization": "…" },  // sent with the feed request
  "includeDescription"?: boolean         // let rules also match DESCRIPTION (off by default)
}
```

A bare string in `calendars` is shorthand for `{ "url": … }`. Events from a
calendar with no matching rule go to the first person; a calendar with no
person at all becomes its own line, named after the calendar.

## Rule

```
{
  "match": Matcher,
  "person"?: string | string[],   // put the event on this line; several = a shared event (capsule)
  "rename"?: boolean,             // replace the matched text with the person's name (default true, false for "any")
  "rewrite"?: string,             // replace the matched text (or the whole title with rewriteFull)
  "rewriteFull"?: boolean,
  "hide"?: boolean
}
```

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
ever touching a regex — e.g. hide every class code except two of your own:

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
needs every backslash doubled in JSON (`\\b`) — an easy way to end up with a
rule that silently matches nothing if something along the way (a paste, a
rich-text field) re-escapes it again. Prefer `not` unless you need a real
regex feature `and`/`or`/`not` can't express.

## Example

[demo-config.json](demo-config.json) is a complete working example with a
work calendar, per-person calendars, a school calendar split by class code,
and a shared family calendar.
