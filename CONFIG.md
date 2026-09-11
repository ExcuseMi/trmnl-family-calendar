# Calendar Config reference

The **Calendars** field accepts either plain text (one ICS URL
per line) or a JSON object with this shape. Unknown keys are ignored
silently, so check spelling.

```
{
  "timeZone"?: string,            // IANA zone, e.g. "Europe/Brussels" (default: TRMNL account zone)
  "locale"?: string,              // "en", "fr", "es", "de", "nl", "en-US", … (default: account language)
  "timeFormat"?: "auto" | "12h" | "24h",   // the clock (default: "auto", which follows the locale)
  "temperatureUnit"?: "auto" | "c" | "f",  // (default: "auto", which follows the locale)
  "lines"?: Line[],
  "rules"?: Rule[],               // applied to every calendar, before the calendar's own rules
  "calendars": (string | Calendar)[]
}
```

## Line

```
{ "name": "Alex", "hideIfEmpty"?: boolean }
```

- Each line is one line on the map. Order matters: the first line is the
  fallback for any event no rule assigns, and lines on the same side get
  their dash pattern in order (solid, dashed, dotted, dash-dot).
- A line is otherwise just a name. Which side of the map it runs on, what
  colour it is and which dash pattern it gets are all decided from the day
  itself: sides are balanced once every calendar is fetched, whoever has the
  most events today going first and each line landing on whichever side is
  currently lighter, then each side's lines take solid, dashed, dotted,
  dash-dot in order. On 1-bit panels every line is black and only the
  pattern tells them apart; on 2/4-bit panels the shade follows the panel's
  own theme.
- `hideIfEmpty`: `false` keeps this line's line on the board on a day it
  has nothing on it. By default a line with no events, sidings or all-day
  entries today gets no line, so a day when most of the family is idle does
  not spend the board's depth on empty rails. Turn it off for anyone whose
  line should always be there, so the board reads the same shape every day.

Lines that appear in rules but not in `lines` are added automatically.

### `side` and `color`: read, not offered

Older configurations set `"side": "left" | "right"` (also spelled `"work"` /
`"family"`) and `"color"` (a hue name, `black`, or `gray-10` … `gray-75`) on
a line. **Both are still read and still honoured**, so nothing you already
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
  "includeDescription"?: boolean,        // let rules also match DESCRIPTION (off by default; a rule naming the description turns it on by itself)
  "hideIfEmpty"?: boolean,               // false keeps this calendar's line on a day it has nothing (default true)
  "holiday"?: boolean                    // everything in this feed belongs to the DAY, not to a line (see Public holidays)
}
```

A bare string in `calendars` is shorthand for `{ "url": … }`.

**`name` is not a caption: it can become a line.** An event that no rule
routes falls back to the calendar's `name`, then to the first entry in
`lines`, then to the feed's own `X-WR-CALNAME`. Whichever wins is drawn as
a *line* on the map. So a calendar called `"Deliveries"` that leaks a single
unrouted event puts a "Deliveries" line on a board that was meant to have
one line per person, and nothing in the JSON says so.

Name a calendar after the person whose line it is (`"name": "Alex"` beside a
rule routing everything to Alex), or leave `name` off entirely when its
rules route every event somewhere. Count the lines a configuration produces
before saving it: one per entry in `lines`, plus one for every named
calendar that can still leak an unrouted event.

`hideIfEmpty: false` is the same switch as the one on a line, put where the
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
  "line"?: string | string[],    // put the event on this line; several = a shared event (capsule)
  "rename"?: boolean,             // replace the matched text with the line's name (default true, false for "any")
  "rewrite"?: string,             // replace the matched text (or the whole title with rewriteFull)
  "rewriteFull"?: boolean,
  "hide"?: boolean,
  "allDay"?: boolean,             // draw it at the line's head, not at a time, whatever the ICS says
  "holiday"?: boolean             // a state, not an appointment: the day's if no `line`, that line's head if there is one
}
```

### Long blocks look after themselves

There is nothing to write for a status or location block that spans real
meetings without being one itself: a synced-in "Desk booking", an "In the
office" block, a school day, a shift, a delivery. **Any timed event of four
hours or more is drawn as a siding**, and the layout works that out from the
clock.

The event's own line draws a shallow kink out to siding level for exactly
that event's span and rejoins at the end, with a caption riding the line: no
lane, no label run, no branch. Real meetings during that span still fork off
the line normally, they just aren't crowded out by a long block hogging the
innermost lane. Where two lines are in the same long block (two children at
one school), it is drawn once as a corridor they share.

Earlier versions asked for this with `"siding": true` on a rule, and before
that `"station": true`. Both keys are gone. A config that still carries
either one loads fine: the key is ignored, the same as any other key this
does not recognise.

Rules run in order, global ones first; for each effect the last matching
rule wins, so a calendar's own rule overrides a global one.

### Public holidays

A subscribed holiday feed ("Holidays in Belgium", Apple's equivalent, a
school's term dates) is not a person and has no line. Everything in it is a
property of **the day**: it has no hour, so there is nowhere on a scale of
hours to draw it, and no owner, so there is no head to declare it at.

Say so once, on the calendar:

```json
{ "url": "https://calendar.google.com/…/holidays.ics", "holiday": true }
```

The day's names then read in the header, beside the date: `Today · Fri 25
Dec · Christmas Day`. Nothing is drawn on the map, no line is created, and
on a day with no holiday it takes no room at all.

**Leave the `name` off.** A named calendar's name becomes a line for
anything no rule routes, so a feed called `"Holidays in Belgium"` used to
put a rail on the board named after a country. With `holiday` set it cannot
happen, and there is nothing left for a name to do.

For a feed that carries both kinds, say it per event instead:

```json
{ "match": { "type": "categories", "value": "Public holiday" }, "holiday": true }
```

#### Whose day does it change?

`holiday` does not mean "put it in the header". It means this is a **state**
rather than an appointment. Where it is drawn follows from whether anybody
owns it, and the rule that routes it is what says:

```json
{ "match": { "type": "contains", "value": "Half Term" },
  "holiday": true, "line": ["Bart", "Lisa"] }
```

Christmas Day is nobody's, so it belongs to the day and reads in the header.
Half term is precisely the children's and precisely **not** the parent who
still goes to work, so it reads at their heads, exactly as one person's
leave does, named once with the dashed tie between them. Both arrive through
the same subscription; a school feed can route its term dates to the
children and its INSET days to nobody.

Only a rule's own `line` counts. A feed nobody has routed has not told the
board whose day it changes, so it is the day's: that is what stops a
national calendar landing on whoever happens to be first in `lines`.

#### In a plain list of links

The low-friction path is one link per line and no JSON at all, and a holiday
feed pasted into it became a rail named after a country. Say it with one
word at the end of the line:

```
https://calendar.example.com/work.ics
https://calendar.example.com/family.ics
https://calendar.google.com/calendar/ical/en.be%23holiday%40group.v.calendar.google.com/public/basic.ics holiday
```

A URL cannot contain a bare space, so a space and the word `holiday` after
one is unambiguous. It is the only word the list understands and it only
works at the end: a list with options in it is the JSON config in disguise,
and the JSON config is right there when you need more than this.

Three details worth knowing.

- **A range says which day of it this is.** "Spring Break" running from the
  5th to the 9th reads as `Spring Break · Day 3 of 5` on the Wednesday.
  The board draws one day, and which day of the holiday that is is the only
  thing telling the Monday from the Thursday. A one-day holiday says just
  its name.
- **The day gets one name.** Two feeds that both fire on the same day
  (a national calendar and a school one) are read, deduplicated and then
  cut to the first: the header is a single row that already carries a date
  and a forecast, and two names on it cut each other short. List the feed
  whose names you want first.
- **A holiday is not the same thing as an all-day event.** One person's
  leave IS a state of their line, and it stays where it was: declared at
  that line's head, with both ends of the line drawn as open chevrons.
  `holiday` on its own is for the days nobody owns; `holiday` with a `line`
  puts a state at that line's head, which is the same drawing an all-day
  event gets. A rule that sets both `allDay` and `holiday` is read as a
  holiday, because that is the more specific claim about the same event.
- **It rides with the date.** A panel too small to carry a header has
  already given up saying which day it is, and the holiday goes with it
  rather than being moved somewhere the map has to pay for.

Recurrence: a whole-day entry repeating `FREQ=YEARLY` is evaluated, which
is how most holiday feeds write Christmas Day once and mean every year.
An ordinal weekday rule (`BYDAY=4TH`, the American Thanksgiving) is not:
it moves the date every year, and the anniversary of the start date would
be the wrong answer rather than an approximate one. Feeds that need one of
those write a separate entry per year instead, which works.

## Matcher

```
{ "type": "word",     "value": "L2" }        // whole word, case-insensitive
{ "type": "contains", "value": "staff" }
{ "type": "exact",    "value": "Standup" }
{ "type": "regex",    "value": "^Piano" }    // double every backslash in JSON
{ "type": "status",   "value": "tentative" } // confirmed | tentative | cancelled
{ "type": "weekday",  "value": ["MO", "WE"] }
{ "type": "duration", "min": 240, "max": 600 }   // minutes; either bound alone is fine
{ "type": "time",     "from": "07:00", "to": "09:00" } // when it STARTS
{ "type": "any" }
{ "type": "and" | "or", "matchers": [Matcher, …] }
{ "type": "not", "matcher": Matcher }
```

### `field`: which part of the event the words are looked for in

The four text matchers (`word`, `contains`, `exact`, `regex`) take an
optional `field`:

| `field` | reads |
| --- | --- |
| *(omitted)* | the title, plus the description when the calendar has one |
| `"title"` | the title only |
| `"location"` | LOCATION |
| `"description"` | DESCRIPTION |
| `"categories"` | CATEGORIES, each category as a whole value |
| `"any"` | all of the above |

Omitting it is what a matcher has always meant, so nothing you already
have changes. Name one when the title is not where the answer is:

```json
{ "match": { "type": "contains", "value": "Elementary", "field": "location" },
  "line": "Kids", "rename": false }
```

That routes on the *place*, which is the case a school or an office feed
usually is: every title is a code or a room number, and the only thing
that reliably says whose day it is sits in LOCATION. Set `"rename": false`
with it, or the rule will try to rewrite text that is not in the title.

Two details worth knowing. `exact` anchors to whatever it is handed, so
against `categories` it matches one whole category out of a list rather
than the whole list. And naming `description` or `any` switches
`includeDescription` on for that calendar by itself: a rule that reads the
notes should not also have to remember a separate switch. A `field` the
plugin does not recognise is ignored, and the matcher falls back to the
default.

### `duration` and `time`: the shape of the day, not its words

`duration` is in minutes and takes `min` (inclusive), `max` (inclusive) or
both. It only ever matches an event with both a start and an end.

```json
{ "match": { "type": "duration", "min": 240 }, "hide": true }
```

That is the whole "which of these do I not want to see" question answered
once: anything over four hours is a block the line runs alongside, however
the household spells it this week. It saves listing "In the office", "WFH",
"Desk booking", "School day" and whatever gets invented next.

`time` asks when an event STARTS, as "HH:MM" on its own day. `from` is
inclusive and `to` is exclusive, so `07:00`-`09:00` and `09:00`-`12:00`
tile without both claiming nine o'clock. Either bound alone is fine.

Neither matcher takes a `value` or a `field`, and one with no bounds at all
is dropped rather than treated as "everything", so a half-filled rule does
nothing instead of quietly moving the whole board onto one line.

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
work calendar, per-line calendars, a school calendar split by class code,
and a shared family calendar.

The [configuration editor](https://excusemi.github.io/trmnl-metro-calendar-plugin/tools/config-editor.html)
carries three more, in
the **Start** section, one button each, for when you have no ICS links yet:

- **Family of 4**: one calendar per person plus a shared household feed.
  Dinner and the school run are `line` lists, so they are drawn once as an
  interchange rather than once per person; the school feed's menu postings
  are hidden, and the quiet toddler's line is kept with `hideIfEmpty`.
- **Work vs Personal Split**: two lines for one person, and a top-level rule
  that hides cancelled holds in every calendar. The office day needs no rule
  of its own: it is long enough that the work line runs alongside it instead
  of spending a label lane on it.
- **Solo Freelancer Line**: one work feed fanned out into a line per
  client on the title prefix, which a `rewrite` then strips, so the board
  reads "Sprint review" and not "Acme: Sprint review".

Each loads into the editor exactly as an import does, with placeholder
`calendar.example.com` links to swap for your own, and none of them sets
`side` or `color`.
