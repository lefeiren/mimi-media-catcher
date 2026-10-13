const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'shared/core.js'), 'utf8');
const injectSource = fs.readFileSync(path.join(root, 'content/inject.js'), 'utf8');

function videoNote(id, ownerId) {
  return {
    noteId: id,
    type: 'video',
    title: '小红书视频测试',
    user: { userId: ownerId, nickname: '视频作者' },
    imageList: [{ width: 1080, height: 1440, urlDefault: 'https://sns-webpic-qc.xhscdn.com/' + id + '/cover.webp' }],
    video: {
      media: {
        stream: {
          h264: [
            { width: 1080, height: 1920, videoBitrate: 5000000, masterUrl: 'https://sns-video-bd.xhscdn.com/stream/' + id + '/1080.mp4' },
            { width: 720, height: 1280, videoBitrate: 2500000, masterUrl: 'https://sns-video-bd.xhscdn.com/stream/' + id + '/720.mp4' },
            { width: 480, height: 854, videoBitrate: 900000, backupUrls: ['https://sns-video-bd.xhscdn.com/stream/' + id + '/480.mp4'] }
          ]
        }
      }
    }
  };
}

function currentVideoCard(id, ownerId) {
  return {
    id,
    xsecToken: 'current-api-token',
    noteCard: {
      type: 'video',
      displayTitle: '小红书当前视频结构',
      user: { userId: ownerId, nickname: '当前视频作者' },
      imageList: [{ width: 1080, height: 1440, urlDefault: 'https://sns-webpic-qc.xhscdn.com/' + id + '/cover.webp' }],
      video: {
        mediaV2: JSON.stringify({
          stream: {
            EF4: [
              // 真实 mediaV2 仍会给出 HTTP CDN 地址，扩展必须在白名单内升级为 HTTPS。
              { width: 1080, height: 1920, videoBitrate: 5000000, masterUrl: 'http://sns-video-v28.xhscdn.com/stream/' + id + '/1080.mp4' },
              { width: 720, height: 1280, videoBitrate: 2500000, master_url: 'http://sns-video-v28.xhscdn.com/stream/' + id + '/720.mp4' }
            ],
            h264: [
              { width: 480, height: 854, videoBitrate: 900000, masterUrl: 'https://sns-video-v28.xhscdn.com/stream/' + id + '/480.mp4' }
            ]
          }
        })
      }
    }
  };
}

function imageNote(id, ownerId) {
  return {
    note_id: id,
    type: 'normal',
    display_title: '小红书多图测试',
    user: { user_id: ownerId, nickname: '图文作者' },
    image_list: [1, 2, 3].map(index => ({
      width: 1080,
      height: 1440,
      url_default: 'https://sns-webpic-qc.xhscdn.com/' + id + '/' + index + '.webp'
    }))
  };
}

function runXhsPage(pageUrl, initialState, options = {}) {
  const messages = [];
  const intervalFns = [];
  const page = new URL(pageUrl);
  const document = {
    documentElement: {},
    readyState: 'complete',
    getElementById() { return null; },
    querySelector(selector) {
      if (selector === '#noteContainer video,.note-detail-mask video') return options.hasVideo ? {} : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'video') return [];
      if (selector === '#noteContainer img,.note-detail-mask img') return options.detailImages || [];
      if (selector.includes('[data-note-id]') || selector.includes('#exploreFeeds')) return options.vueElements || [];
      return [];
    },
    addEventListener() {}
  };
  const context = {
    URL,
    document,
    location: page,
    history: { pushState() {}, replaceState() {} },
    __INITIAL_STATE__: initialState,
    performance: options.performanceEntries ? {
      now() { return 0; },
      getEntriesByType(type) { return type === 'resource' ? options.performanceEntries : []; }
    } : undefined,
    addEventListener() {},
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    setInterval(fn) { intervalFns.push(fn); return 1; },
    postMessage(payload) { messages.push(payload); }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(coreSource, context, { filename: 'shared/core.js' });
  vm.runInContext(injectSource, context, { filename: 'content/inject.js' });
  if (options.lateInitialState) {
    context.__INITIAL_STATE__ = options.lateInitialState;
    intervalFns.forEach(fn => fn());
  }
  return messages.filter(message => message && message.__mimi_dl_v2__).at(-1);
}

test('reads the current Xiaohongshu note from Vue component state when network data is already gone', () => {
  const id = '68e8abcdef1234567890abd2';
  const element = {
    __vueParentComponent: {
      props: { currentNote: currentVideoCard(id, 'vue-current-creator') },
      setupState: {},
      data: {},
      ctx: {},
      parent: null
    }
  };
  const payload = runXhsPage('https://www.xiaohongshu.com/explore/' + id, null, { vueElements: [element], hasVideo: true });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, id);
  assert.equal(payload.items[0].ownerId, 'vue-current-creator');
  assert.equal(payload.items[0].videos.length, 3);
});

test('reads noteDetailMap directly even when earlier Xiaohongshu stores exceed the traversal limit', () => {
  const id = '68e8abcdef1234567890abd4';
  const noisyGlobalStore = { entries: Array.from({ length: 17000 }, (_, index) => ({ index })) };
  const note = currentVideoCard(id, 'direct-map-creator').noteCard;
  note.noteId = id;
  const payload = runXhsPage('https://www.xiaohongshu.com/explore/' + id, {
    global: noisyGlobalStore,
    note: { noteDetailMap: { [id]: { note } } }
  }, { hasVideo: true });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, id);
  assert.equal(payload.items[0].ownerId, 'direct-map-creator');
  assert.equal(payload.items[0].videos.length, 3);
});

test('replaces an early Xiaohongshu playback fallback when structured qualities arrive later', () => {
  const id = '68e8abcdef1234567890abd5';
  const note = currentVideoCard(id, 'late-state-creator').noteCard;
  note.noteId = id;
  const payload = runXhsPage('https://www.xiaohongshu.com/explore/' + id, null, {
    hasVideo: true,
    performanceEntries: [
      { startTime: 10, name: 'https://sns-video-v28.xhscdn.com/stream/' + id + '/fallback-a.mp4' },
      { startTime: 20, name: 'https://sns-video-v28.xhscdn.com/stream/' + id + '/fallback-b.mp4' }
    ],
    lateInitialState: { note: { noteDetailMap: { [id]: { note } } } }
  });
  assert.deepEqual(Array.from(payload.items[0].videos, video => video.label), ['1080p · 高清', '720p · 标清', '480p · 流畅']);
  assert.ok(payload.items[0].videos.every(video => video.width && video.height));
});

test('uses large detail-page images as a Xiaohongshu carousel fallback', () => {
  const id = '68e8abcdef1234567890abd3';
  const detailImages = [1, 2, 3].map(index => ({
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/' + id + '/fallback-' + index + '.webp',
    naturalWidth: 1080,
    naturalHeight: 1440,
    className: 'note-slider-img',
    alt: ''
  }));
  const payload = runXhsPage('https://www.xiaohongshu.com/explore/' + id, null, { detailImages });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, id);
  assert.equal(payload.items[0].images.length, 3);
});

test('parses a Xiaohongshu video note with three qualities and keeps the cover separate', () => {
  const id = '68e8abcdef1234567890abcd';
  const payload = runXhsPage('https://www.xiaohongshu.com/explore/' + id, {
    note: { noteDetailMap: { [id]: { note: videoNote(id, 'creator-video') } } }
  });
  assert.equal(payload.site, 'xhs');
  assert.equal(payload.route, 'detail');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].ownerId, 'creator-video');
  assert.deepEqual(Array.from(payload.items[0].videos, video => video.label), ['1080p · 高清', '720p · 标清', '480p · 流畅']);
  assert.equal(payload.items[0].images.length, 0);
  assert.match(payload.items[0].thumb, /cover\.webp$/);
});

test('parses the current Xiaohongshu wrapper id and mediaV2 response shape', () => {
  const id = '68e8abcdef1234567890abca';
  const payload = runXhsPage('https://www.xiaohongshu.com/explore/' + id, {
    feed: { feeds: [currentVideoCard(id, 'current-video-creator')] }
  });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, id);
  assert.equal(payload.items[0].ownerId, 'current-video-creator');
  assert.deepEqual(Array.from(payload.items[0].videos, video => video.label), ['1080p · 高清', '720p · 标清', '480p · 流畅']);
  assert.ok(payload.items[0].videos.every(video => video.url.startsWith('https://')));
  assert.match(payload.items[0].pageUrl, /xsec_token=current-api-token/);
});

test('parses every image in a Xiaohongshu carousel note', () => {
  const id = '68e8abcdef1234567890abce';
  const payload = runXhsPage('https://www.xiaohongshu.com/explore/' + id, {
    note: { noteDetailMap: { [id]: { note: imageNote(id, 'creator-images') } } }
  });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].videos.length, 0);
  assert.equal(payload.items[0].images.length, 3);
  assert.match(payload.items[0].images[2].url, /\/3\.webp$/);
});

test('keeps the outer id for the current Xiaohongshu image-card response', () => {
  const id = '68e8abcdef1234567890abcb';
  const note = imageNote(id, 'current-image-creator');
  delete note.note_id;
  const payload = runXhsPage('https://www.xiaohongshu.com/explore/' + id, {
    feed: { feeds: [{ id, noteCard: note }] }
  });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, id);
  assert.equal(payload.items[0].ownerId, 'current-image-creator');
  assert.equal(payload.items[0].images.length, 3);
});

test('keeps only the current Xiaohongshu creator on a profile page', () => {
  const payload = runXhsPage('https://www.xiaohongshu.com/user/profile/current-creator', {
    notes: [
      imageNote('68e8abcdef1234567890abcf', 'current-creator'),
      imageNote('68e8abcdef1234567890abd0', 'previous-creator')
    ]
  });
  assert.equal(payload.route, 'user');
  assert.deepEqual(Array.from(payload.items, item => item.ownerId), ['current-creator']);
});

test('keeps lightweight Xiaohongshu profile cards for deferred exact-note downloads', () => {
  const id = '68e8abcdef1234567890abd1';
  const payload = runXhsPage('https://www.xiaohongshu.com/user/profile/current-creator', {
    notes: [{
      id,
      xsec_token: 'note-specific-token',
      note_card: {
        type: 'normal',
        display_title: '主页作品卡片',
        cover: { url_default: 'https://sns-webpic-qc.xhscdn.com/' + id + '/cover.webp' }
      }
    }]
  });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].ownerId, 'current-creator');
  assert.equal(payload.items[0].videos.length, 0);
  assert.equal(payload.items[0].images.length, 0);
  assert.match(payload.items[0].thumb, /cover\.webp$/);
  assert.match(payload.items[0].pageUrl, new RegExp('/explore/' + id + '\\?'));
  assert.match(payload.items[0].pageUrl, /xsec_token=note-specific-token/);
});
