'use strict';

// WHAT THIS BOARD COSTS, AS A NUMBER.
//
// Every argument in `issues.md` about layout is currently two screenshots
// and a judgement. A17 says a bundle is drawn on top of the lines, A15 says
// half the paper beside every line goes unused, A16 says the lines travel
// further than they need to -- and none of them can be settled, or even
// compared with each other, because nothing can say "this board is better
// than that one". A19 asks for the thing that can.
//
// This is the RENDERED score, and it is the truth: it reads the report the
// harness already extracts from a drawn board, so it measures the ink and
// not the intention. A model score -- an estimate from the solver's own
// numbers, cheap enough for a search to evaluate thousands of times inside
// the panel's own render -- is the other half, and it is not built yet. The
// order matters: a model that has never been checked against a render is a
// thing you optimise a board into being worse against.
//
// FEASIBILITY IS NOT A TERM. "Every label legible, everything visible" is a
// question a board answers yes or no, because as a weighted cost an
// optimiser will buy fewer crossings with a hidden label, which is the one
// trade nobody wants. So the faults are counted separately and a board that
// has any is INFEASIBLE however cheap its terms are.
//
// WEIGHTS ARE NOT CALIBRATED YET, and they are the next thing to do rather
// than the thing to argue about now: the terms are what had to be got
// right. See A19 for what should calibrate them.
//
// AND A TOTAL COMPARES TWO ARRANGEMENTS OF ONE BOARD, not two boards.
// `travel` and `cramp` are pixels, and a pixel on an X panel is not a pixel
// on an OG one -- the same day scores 179 on one and 84 on the other with
// nothing better about either. That is not a defect to normalise away: the
// question a score exists to answer is "is this arrangement of this board
// better than that one", which is always asked within one panel.

const TOL = 2;          // px of overlap that is a graze rather than a fault
const PIERCE_TOL = 4;   // px of rail inside a label that is a graze

function isLabel(l) { return /\bmetro-label\b/.test(l.cls); }
function isName(l) { return /\bmetro-terminus\b/.test(l.cls); }
function boxes(rep) { return (rep.labels || []).filter((l) => isLabel(l) || isName(l)); }

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (w > TOL && h > TOL) ? w * h : 0;
}

// WHOSE EACH BOX IS. The report does not say -- a label is text and a
// rectangle -- so it is matched the way cases/geometry.js matches it, from
// the fixture that produced the board: a line's name is its own, and a
// caption belongs to the event whose title it carries and to every line on
// that event.
function ownersOf(f) {
  const byName = {}, byTitle = {};
  for (const t of f.metro.legend) byName[t.name] = [t.key];
  for (const e of f.metro.events || []) {
    byTitle[e.title] = [e.owner].concat(e.co_owners || []);
  }
  return function (box) {
    if (byName[box.text]) return byName[box.text];
    for (const title of Object.keys(byTitle)) {
      if (box.text.indexOf(title) >= 0) return byTitle[title];
    }
    return [];
  };
}

// Somebody else's rail through the words. The same question cases/geometry
// asks, kept here so the score does not depend on a case having run.
function pierces(rep, ownerOf, deepest) {
  const out = [];
  for (const box of boxes(rep)) {
    const mine = ownerOf(box);
    for (const p of (rep.paths || [])) {
      if (p.role !== 'track' && p.role !== 'branch' && p.role !== 'fork') continue;
      // a line's name is set ON its line by design and a caption sits
      // against its own rail: only somebody else's ink is a fault
      if (mine.indexOf(p.owner) >= 0) continue;
      const d = deepest(p.pts, box);
      if (d > PIERCE_TOL) out.push('"' + box.text + '" by ' + p.owner);
    }
  }
  return out;
}

// WHERE EACH LINE RUNS, and the gaps between them. The gap between two
// neighbours is not empty space: it is where the inner one's captions live,
// so a gap is scored against what it actually has to hold.
function lanes(rep) {
  const horiz = rep.debug.horizontal;
  const ci = horiz ? 'y' : 'x', ch = horiz ? 'h' : 'w';
  const at = [];
  for (const p of (rep.paths || [])) {
    if (p.role !== 'track' || !p.owner) continue;
    const cs = p.pts.map((q) => (horiz ? q[1] : q[0]));
    if (!cs.length) continue;
    // where the line STARTS the day, which is where its own name is and
    // what the reader takes as its row
    at.push({ owner: p.owner, c: cs[0] });
  }
  const seen = {};
  const rows = at.filter((r) => (seen[r.owner] ? false : (seen[r.owner] = true)))
    .sort((a, b) => a.c - b.c);
  const edge = horiz ? rep.canvas.h : rep.canvas.w;
  const gaps = [];
  for (let i = 0; i <= rows.length; i++) {
    const lo = i === 0 ? 0 : rows[i - 1].c;
    const hi = i === rows.length ? edge : rows[i].c;
    if (hi - lo <= 0) continue;
    gaps.push({ lo, hi, size: hi - lo, need: 0 });
  }
  // what each gap is carrying: the extent the labels inside it occupy
  for (const box of boxes(rep)) {
    const c0 = box[ci], c1 = box[ci] + box[ch];
    const mid = (c0 + c1) / 2;
    const g = gaps.find((x) => mid >= x.lo && mid < x.hi);
    if (!g) continue;
    g.lo2 = g.lo2 == null ? c0 : Math.min(g.lo2, c0);
    g.hi2 = g.hi2 == null ? c1 : Math.max(g.hi2, c1);
  }
  for (const g of gaps) g.need = (g.hi2 == null) ? 0 : (g.hi2 - g.lo2);
  return { rows, gaps };
}

// WHAT A CROSSING IS, and it is not "two drawn lines that meet".
//
// Counted geometrically, a convergence scores two crossings for every line
// between its members, because everybody dives in and comes back out again;
// a board with one shared event and four lines reads five crossings and
// nothing is wrong with it. The fault is an ORDERING one: a line sits
// between two people who are in the same place and is not one of them, so
// their rails have to be read across it. That is what these two count, and
// they are the same ones cases/crossings.js asserts on.
// The lines a shared event must cross, read off the board that was
// actually drawn. Distance is measured from the spine OUTWARD on each
// side, so the two sides are mirror images: signed by side they lie on
// one axis, and "between" means what it says.
function forcedCrossings(f, rep) {
  const side = {};
  for (const t of f.metro.legend) side[t.key] = t.side === 'right' ? 1 : -1;
  const at = {};
  for (const b of rep.debug.bands) at[b[0]] = (side[b[0]] || 1) * b[3];
  const keys = Object.keys(at);
  const out = [];
  for (const it of f.metro.events) {
    if (it.type !== 'event' || !it.co_owners || !it.co_owners.length) continue;
    const mine = [it.owner].concat(it.co_owners).filter((k) => at[k] != null);
    if (mine.length < 2) continue;
    const ds = mine.map((k) => at[k]);
    const lo = Math.min.apply(null, ds), hi = Math.max.apply(null, ds);
    const crossed = keys.filter((k) => mine.indexOf(k) < 0 && at[k] > lo && at[k] < hi);
    if (crossed.length) out.push(it.title + ' crosses ' + crossed.join(', '));
  }
  return out;
}

// The same count, but reading where each line is AT THE MINUTE of each
// event rather than where it started the day.
function forcedCrossingsWeaveAware(f, rep) {
  const side = {};
  for (const t of f.metro.legend) side[t.key] = t.side === 'right' ? 1 : -1;
  const start = {};
  for (const b of rep.debug.bands) start[b[0]] = (side[b[0]] || 1) * b[3];
  const moved = {};
  for (const w of rep.debug.weave || []) moved[w.key] = w;
  const at = (key, a) => {
    const w = moved[key];
    return w ? (a >= w.atA ? w.to : w.from) : start[key];
  };
  const keys = Object.keys(start);
  const out = [];
  for (const it of f.metro.events) {
    if (it.type !== 'event' || !it.co_owners || !it.co_owners.length) continue;
    const mine = [it.owner].concat(it.co_owners).filter((k) => start[k] != null);
    if (mine.length < 2) continue;
    // the axis position of the event, to ask where everybody is then
    const row = (rep.debug.events || []).find((e) => e[0] === it.title);
    const a = row ? row[5] : null;
    if (a == null) continue;
    const ds = mine.map((k) => at(k, a));
    const lo = Math.min.apply(null, ds), hi = Math.max.apply(null, ds);
    const crossed = keys.filter((k) => mine.indexOf(k) < 0 && at(k, a) > lo && at(k, a) < hi);
    if (crossed.length) out.push(it.title + ' crosses ' + crossed.join(', '));
  }
  return out;
}

// (the geometric count that was here first is gone: see the note above)
function crossings(rep) {
  const horiz = rep.debug.horizontal;
  const ai = horiz ? 0 : 1, ci = horiz ? 1 : 0;
  const byOwner = {};
  for (const p of (rep.paths || [])) {
    if (p.role !== 'track' || !p.owner) continue;
    (byOwner[p.owner] = byOwner[p.owner] || []).push(p);
  }
  const keys = Object.keys(byOwner);
  const cAt = (paths, a) => {
    let best = null;
    for (const p of paths) {
      for (const q of p.pts) {
        const d = Math.abs(q[ai] - a);
        if (best == null || d < best.d) best = { d, c: q[ci] };
      }
    }
    return best && best.d < 6 ? best.c : null;
  };
  const lo = 0, hi = horiz ? rep.canvas.w : rep.canvas.h;
  let n = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      let sign = 0;
      for (let a = lo; a <= hi; a += 4) {
        const ca = cAt(byOwner[keys[i]], a), cb = cAt(byOwner[keys[j]], a);
        if (ca == null || cb == null) continue;
        const d = ca - cb;
        if (Math.abs(d) < 1) continue;
        const s = d > 0 ? 1 : -1;
        if (sign && s !== sign) n++;
        sign = s;
      }
    }
  }
  return n;
}

// HOW FAR EVERYBODY HAS TO GO. A16's term, and the one nothing measured:
// two orders can cross the same number of times and make the same amount of
// ink to reach the middle, while one of them has every line climbing twice
// as far to get to the same events.
function travel(rep) {
  const horiz = rep.debug.horizontal;
  const ci = horiz ? 1 : 0;
  let sum = 0;
  for (const p of (rep.paths || [])) {
    if (p.role !== 'track' || !p.owner) continue;
    for (let i = 1; i < p.pts.length; i++) sum += Math.abs(p.pts[i][ci] - p.pts[i - 1][ci]);
  }
  return Math.round(sum);
}

// WHAT THE BOARD GAVE UP TO FIT, which is where the cramping went.
//
// "Score each gap against what it has to hold" is the obvious term and it
// reads zero on nearly every board, because a rendered board has already
// degraded until its labels fit: it steps the text down a tier, then drops
// the time rows, then sheds a name. Measured on the pair A19 names -- the
// same day with the alert banner up and without -- cramp FALLS as the room
// falls, because the squeezed board gave something up instead.
//
// So the rendered score counts what was surrendered. Cramp stays, because
// it is the right term for a MODEL score, where a candidate has not
// degraded yet and A17's `need` is exactly this number; here it is the
// exception rather than the measure.
//
// The tiers are the list in shared.liquid's `CLASSES`, largest first.
const TIERS = ['title title--xlarge', 'title title--large', 'title title--base',
               'title title--small', 'label label--small'];
function give(rep) {
  const tier = Math.max(0, TIERS.indexOf(String(rep.debug.titleClass)));
  const caps = (rep.labels || []).filter((l) => isLabel(l));
  // a caption whose time row was given up to make it fit
  const timeless = caps.filter((l) => !/\d{1,2}[:.]\d{2}/.test(l.text)).length;
  return { tier, timeless };
}

function scoreBoard(rep, f, deepest) {
  const ls = boxes(rep);
  let overlap = 0;
  for (let i = 0; i < ls.length; i++) {
    for (let j = i + 1; j < ls.length; j++) if (overlapArea(ls[i], ls[j]) > 0) overlap++;
  }
  const ev = rep.debug.events || [];
  const dropped = ev.filter((e) => e[2] === 'DROP').length;
  const shed = ev.filter((e) => e[16] === 'shed' || e[16] === 'gone').length;
  const pierced = pierces(rep, ownersOf(f), deepest);
  const { gaps } = lanes(rep);
  // A gap has to hold what is in it. Short of that is cramping, and it is
  // the fault A17 is about; over it is room to spare, which is only good if
  // it is SPREAD rather than banked in one place (A15, A14's waste).
  let cramp = 0, spare = [];
  for (const g of gaps) {
    const short = g.need - g.size;
    if (short > 0) cramp += short;
    else spare.push(g.size - g.need);
  }
  const mean = spare.length ? spare.reduce((a, b) => a + b, 0) / spare.length : 0;
  const spread = spare.length
    ? Math.round(Math.sqrt(spare.reduce((a, b) => a + (b - mean) * (b - mean), 0) / spare.length))
    : 0;
  const faults = { dropped, shed, overlap, pierce: pierced.length };
  const g = give(rep);
  const terms = { crossings: forcedCrossingsWeaveAware(f, rep).length,
                  tier: g.tier, timeless: g.timeless,
                  cramp: Math.round(cramp), spread, travel: travel(rep) };
  return {
    feasible: !dropped && !shed && !overlap && !pierced.length,
    faults,
    terms,
    // NOT CALIBRATED. The terms are the work; the weights are the next
    // question, and A19 says which board pair should answer it.
    // STILL NOT CALIBRATED, and now for a stated reason: the pair A19
    // names to calibrate against does not reproduce. See the entry.
    total: Math.round(terms.crossings * 40 + terms.tier * 20 + terms.timeless * 6
                      + terms.cramp * 2 + terms.spread + terms.travel / 40),
  };
}

module.exports = { scoreBoard, lanes, travel, forcedCrossings, forcedCrossingsWeaveAware };
