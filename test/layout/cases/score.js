'use strict';

// THE SCORE IS A MEASUREMENT, SO IT HAS TO BE ONE.
//
// `score.js` turns a rendered board into a number so that the arguments in
// issues.md can stop being two screenshots and a judgement (A19). What this
// case pins is the part a search will lean on: that every board can be
// scored, that the same board scores the same twice, and that feasibility
// means what it says. The WEIGHTS are deliberately not asserted -- they are
// not calibrated yet, and a case that froze them would make calibrating
// them a test failure.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, assert, assertEqual, deepestIntrusion } = h;
  const { scoreBoard } = require('../score');
  const byName = (n) => VIEWPORTS.find((v) => v.name === n);

  test('every board can be scored, and scores the same twice', () => {
    const bad = [];
    for (const f of fixtures) {
      for (const vname of ['x-landscape', 'og-landscape']) {
        let rep;
        try { rep = layout(f, byName(vname)); } catch (e) { continue; }
        const a = scoreBoard(rep, f, deepestIntrusion);
        const b = scoreBoard(rep, f, deepestIntrusion);
        const where = f.name + '/' + vname;
        for (const k of Object.keys(a.terms)) {
          if (!Number.isFinite(a.terms[k])) bad.push(where + ': ' + k + ' is ' + a.terms[k]);
          if (a.terms[k] < 0) bad.push(where + ': ' + k + ' is negative');
        }
        if (!Number.isFinite(a.total)) bad.push(where + ': total is ' + a.total);
        if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(where + ': scored differently twice');
      }
    }
    assert(bad.length === 0, bad.length + ' board(s) the score cannot state: ' + bad.slice(0, 4).join('; '));
  });

  // FEASIBILITY IS A QUESTION, NOT A TERM. A board with a name nobody can
  // read is not a cheap board, whatever its terms say -- as a weighted cost
  // an optimiser buys fewer crossings with a hidden label, which is the one
  // trade nobody wants. So the two must never disagree.
  test('a board with a fault is never feasible, whatever it costs', () => {
    const bad = [];
    for (const f of fixtures) {
      for (const vname of ['x-landscape', 'og-landscape']) {
        let rep;
        try { rep = layout(f, byName(vname)); } catch (e) { continue; }
        const s = scoreBoard(rep, f, deepestIntrusion);
        const faults = Object.keys(s.faults).reduce((n, k) => n + s.faults[k], 0);
        if (s.feasible !== (faults === 0)) {
          bad.push(f.name + '/' + vname + ': feasible=' + s.feasible + ' with ' + faults + ' fault(s)');
        }
      }
    }
    assert(bad.length === 0, bad.join('; '));
  });

  // ...and the faults it counts are the ones the rest of this suite asserts
  // on, rather than a second opinion about the same board. crew-day on the
  // roomy panel carries a known pierce (E24), so the score has to see it;
  // a board nothing is marked against has to come out clean.
  test('the score sees the same faults the cases do', () => {
    const crew = scoreBoard(layout(fixtures.find((f) => f.name === 'crew-day'), byName('x-landscape')),
      fixtures.find((f) => f.name === 'crew-day'), deepestIntrusion);
    assert(crew.faults.pierce > 0,
      'crew-day carries a known rail through a caption and the score should say so');
    assert(!crew.feasible, 'and a board with a rail through a name is not feasible');
    const quiet = fixtures.find((f) => f.name === 'quiet-day');
    const q = scoreBoard(layout(quiet, byName('x-landscape')), quiet, deepestIntrusion);
    assertEqual([q.faults.dropped, q.faults.overlap, q.faults.pierce], [0, 0, 0],
      'a quiet day has nothing wrong with it: ' + JSON.stringify(q.faults));
    assert(q.feasible, 'so it is feasible');
  });
};
