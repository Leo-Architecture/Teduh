'use strict';
// Reads KEY=value lines from a .env file into process.env.
// A setting that is already in the environment wins, and an empty value counts as "not set",
// so a blank slot in .env simply switches that feature off.

const fs = require('fs');

function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
  text.split(/\r?\n/).forEach(function (line) {
    if (/^\s*#/.test(line)) return;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) return;
    let value = m[2];
    if (/^"[^"]*"$|^'[^']*'$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (value !== '' && process.env[m[1]] === undefined) process.env[m[1]] = value;
  });
}

module.exports = { loadEnv };
