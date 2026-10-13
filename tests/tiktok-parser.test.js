const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'shared/core.js'), 'utf8');
const injectSource = fs.readFileSync(path.join(root, 'content/inject.js'), 'utf8');

function item(id, ownerId) {
  return {
    id,
    desc: 'TikTok parser fixture',
    author: { uniqueId: ownerId, nickname: ownerId },
    video: {
      width: 1080,
      height: 1920,
      cover: 'https://p16-common-sign.tiktokcdn.com/cover-' + id + '.webp',
      bitrateInfo: [
        { Bitrate: 5000000, CodecType: 'h264', PlayAddr: { Width: 1080, Height: 1920, UrlList: ['https://v16-webapp-prime.tiktok.com/video/' + id + '/1080.mp4'] } },
        { Bitrate: 2500000, CodecType: 'h264', PlayAddr: { Width: 720, Height: 1280, UrlList: ['https://v16-webapp-prime.tiktok.com/video/' + id + '/720.mp4'] } },
        { Bitrate: 900000, CodecType: 'h264', PlayAddr: { Width: 480, Height: 854, UrlList: ['https://v16-webapp-prime.tiktok.com/video/' + id + '/480.mp4'] } }
      ]
    },
    music: { playUrl: 'https://v58.tiktokcdn.com/audio/' + id + '.mp3' }
  };
}

function photoItem(id, ownerId) {
  return {
    id,
    desc: 'TikTok photo fixture',
    author: { uniqueId: ownerId, nickname: ownerId },
    imagePost: {
      title: 'Photo carousel',
      cover: {
        imageWidth: 1080,
        imageHeight: 1440,
        imageURL: { urlList: ['https://p16-sign-sg.tiktokcdn.com/photo/' + id + '/cover.jpeg'] }
      },
      images: [1, 2, 3].map(index => ({
        imageWidth: 1080,
        imageHeight: 1440,
        imageURL: { urlList: ['https://p16-sign-sg.tiktokcdn.com/photo/' + id + '/' + index + '.jpeg'] }
      }))
    },
    music: { playUrl: 'https://v58.tiktokcdn.com/audio/' + id + '.mp3' }
  };
}

function runTikTokPage(pageUrl, items) {
  const embedded = JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: items } } } });
  const messages = [];
  const page = new URL(pageUrl);
  const document = {
    documentElement: {},
    readyState: 'complete',
    getElementById(id) {
      return id === '__UNIVERSAL_DATA_FOR_REHYDRATION__' ? { textContent: embedded } : null;
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const context = {
    URL,
    document,
    location: page,
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    postMessage(payload) { messages.push(payload); }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(coreSource, context, { filename: 'shared/core.js' });
  vm.runInContext(injectSource, context, { filename: 'content/inject.js' });
  return messages.filter(message => message && message.__mimi_dl_v2__).at(-1);
}

test('parses TikTok embedded data with three qualities, cover and audio', () => {
  const payload = runTikTokPage(
    'https://www.tiktok.com/@creator/video/7412345678901234567',
    item('7412345678901234567', 'creator')
  );
  assert.equal(payload.site, 'tiktok');
  assert.equal(payload.route, 'video');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].ownerId, 'creator');
  assert.deepEqual(Array.from(payload.items[0].videos, video => video.label), ['1080p · 高清', '720p · 标清', '480p · 流畅']);
  assert.match(payload.items[0].thumb, /tiktokcdn\.com/);
  assert.equal(payload.items[0].audios.length, 1);
});

test('keeps only the current TikTok creator on a profile page', () => {
  const payload = runTikTokPage('https://www.tiktok.com/@creator', [
    item('7412345678901234567', 'creator'),
    item('7412345678901234568', 'previous-page-owner')
  ]);
  assert.equal(payload.route, 'user');
  assert.deepEqual(Array.from(payload.items, entry => entry.ownerId), ['creator']);
});

test('parses a TikTok photo post and keeps every carousel image', () => {
  const payload = runTikTokPage(
    'https://www.tiktok.com/@creator/photo/7478990063938833682',
    photoItem('7478990063938833682', 'creator')
  );
  assert.equal(payload.route, 'video');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].videos.length, 0);
  assert.equal(payload.items[0].images.length, 3);
  assert.match(payload.items[0].images[2].url, /\/3\.jpeg$/);
  assert.equal(payload.items[0].audios.length, 1);
});
