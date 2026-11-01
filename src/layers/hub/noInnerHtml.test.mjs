import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Boundary check: the hub layer family never turns data into markup. Hub data
 * is untrusted, so none of the files that handle it may use an HTML-injecting
 * API. The scan covers the layer family, its application wiring, the source
 * and the server proxy, and fails if any file contains one of these.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BANNED = [
  /\binnerHTML\b/,
  /\bouterHTML\b/,
  /\binsertAdjacentHTML\b/,
  /\binsertAdjacentElement\b/,
  /\bdocument\s*\.\s*write(ln)?\b/,
  /\bDOMParser\b/,
  /\bcreateContextualFragment\b/,
  /\bsrcdoc\b/,
  /\bsetHTMLUnsafe\b/,
  /\bdangerouslySetInnerHTML\b/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
];

export function bannedUses(text) {
  return BANNED.filter((pattern) => pattern.test(text)).map(String);
}

function hubFiles() {
  const dir = path.join(ROOT, 'src/layers/hub');
  const own = readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(dir, name));
  return [...own, path.join(ROOT, 'src/app/layers/hubStations.js'), path.join(ROOT, 'server/providers/hub.js')];
}

test('the scan covers the whole hub family', () => {
  const names = hubFiles().map((f) => path.relative(ROOT, f));
  for (const expected of [
    'src/layers/hub/index.js',
    'src/layers/hub/model.js',
    'src/layers/hub/records.js',
    'src/layers/hub/source.js',
    'src/app/layers/hubStations.js',
    'server/providers/hub.js',
  ])
    assert.ok(names.includes(expected), expected);
});

test('the scanner flags every banned API (so a clean result means something)', () => {
  for (const sample of [
    'el.innerHTML = x',
    'el.outerHTML = x',
    'el.insertAdjacentHTML("beforeend", x)',
    'document.write(x)',
    'new DOMParser()',
    'range.createContextualFragment(x)',
    'iframe.srcdoc = x',
    'el.setHTMLUnsafe(x)',
    'eval(x)',
    'new Function(x)',
  ])
    assert.ok(bannedUses(sample).length > 0, sample);
  assert.deepEqual(bannedUses('el.textContent = x'), []);
});

test('no hub file uses an HTML-injecting API', () => {
  for (const file of hubFiles()) {
    assert.deepEqual(bannedUses(readFileSync(file, 'utf8')), [], path.relative(ROOT, file));
  }
});
