# Demo boards

Three example days, each a real configuration driven by real ICS files in
this folder. **Demo Board** in the plugin's settings picks which one the
board shows, and each `config.json` is a worked example you can copy and
point at your own calendars.

They are deliberately different shapes, because the map is:

| Board | Who | What it shows |
| --- | --- | --- |
| [`simpsons/`](simpsons/) | A family of five | One calendar per person, plus a school feed split by class code and a shared family calendar. Bart and Lisa share a School Day corridor; the whole family meets at dinner. |
| [`futurama/`](futurama/) | A work crew of five | **One** team calendar with everything in it, split onto lines by a `Name:` prefix. Fry, Leela and Bender spend the day on the same delivery: one station, three lines in one corridor. |
| [`friends/`](friends/) | Two flatmates | The smallest board worth drawing. Each has a long block in one place, drawn as a siding beside their own line, and one evening they are both at. |

The ICS files are plain `RRULE:FREQ=WEEKLY` entries so the same day renders
whenever you look at it. `config.json` is generated from the copy embedded
in `plugin/src/transform.js`:

```
node tools/dump-demo-configs.js
```

`test/transform/cases/demo-config.js` fails if the two drift apart, if a
config names a file that is not here, or if a board stops resolving to the
people it is supposed to.
