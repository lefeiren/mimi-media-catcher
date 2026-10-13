const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../shared/core.js');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const bridgeSource = fs.readFileSync(path.join(root, 'content/bridge.js'), 'utf8');

test('manifest and shared runtime versions stay aligned', () => {
  assert.equal(manifest.version, Core.VERSION);
});

test('every declared script exists', () => {
  const files = [manifest.background.service_worker];
  for (const entry of manifest.content_scripts) files.push(...entry.js);
  for (const file of files) assert.equal(fs.existsSync(path.join(root, file)), true, file);
});

test('both MAIN capture and isolated bridge start before page requests settle', () => {
  assert.deepEqual(manifest.content_scripts.map(entry => entry.run_at), ['document_start', 'document_start']);
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  assert.equal(manifest.content_scripts[1].world, 'ISOLATED');
  assert.notEqual(manifest.content_scripts[0].js[0], manifest.content_scripts[1].js[0]);
});

test('manifest has no broad all-sites access or third-party X resolver', () => {
  const hosts = manifest.host_permissions || [];
  assert.equal(hosts.includes('<all_urls>'), false);
  assert.equal(hosts.some(host => /fxtwitter/i.test(host)), false);
});

test('Xiaohongshu detail media prefers the current route over residual feed links', () => {
  assert.match(bridgeSource, /element\.closest\('#noteContainer,\.note-detail-mask'\)/);
  assert.match(bridgeSource, /if \(current\) return current\[1\];/);
});

test('Xiaohongshu floating control and menu are both left aligned', () => {
  assert.match(bridgeSource, /site === 'xhs' \? \{ left: '10px' \} : \{ right: '10px' \}/);
  assert.match(bridgeSource, /site === 'xhs' \? \{ left: '0' \} : \{ right: '0' \}/);
});
