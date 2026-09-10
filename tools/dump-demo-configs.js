#!/usr/bin/env node
'use strict';

// Writes demo/<show>/config.json from the demo boards embedded in
// plugin/src/transform.js. The embedded copy is the one the plugin runs;
// these files are the copyable worked examples the settings page links to,
// and test/transform/cases/demo-config.js fails if they drift apart.
//
//   node tools/dump-demo-configs.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SETS = require(path.join(ROOT, 'plugin/src/transform.js')).DEMO_SETS;

for (const name of Object.keys(SETS)) {
  const file = path.join(ROOT, 'demo', name, 'config.json');
  fs.writeFileSync(file, JSON.stringify(SETS[name], null, 2) + '\n');
  console.log('wrote ' + path.relative(ROOT, file));
}
