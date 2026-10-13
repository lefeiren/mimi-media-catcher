const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'shared/core.js'), 'utf8');
const injectSource = fs.readFileSync(path.join(root, 'content/inject.js'), 'utf8');

function runDouyinPage(pageUrl, data) {
  const embedded = JSON.stringify(data);
  const messages = [];
  const page = new URL(pageUrl);
  const document = {
    documentElement: {},
    readyState: 'complete',
    getElementById(id) { return id === 'RENDER_DATA' ? { textContent: embedded } : null; },
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

test('parses every image from a Douyin photo post without requiring video data', () => {
  const id = '7512345678901234567';
  const payload = runDouyinPage('https://www.douyin.com/note/' + id, {
    aweme_detail: {
      aweme_id: id,
      desc: '抖音图文测试',
      author: { nickname: '创作者', sec_uid: 'creator-sec-id' },
      image_post_info: {
        images: [1, 2, 3].map(index => ({
          image_width: 1080,
          image_height: 1440,
          display_image: { url_list: ['https://p3.douyinpic.com/aweme/' + id + '/' + index + '.jpeg'] }
        }))
      },
      music: { play_url: { url_list: ['https://sf6-cdn-tos.douyinstatic.com/obj/ies-music/' + id + '.mp3'] } }
    }
  });
  assert.equal(payload.site, 'douyin');
  assert.equal(payload.route, 'video');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].videos.length, 0);
  assert.equal(payload.items[0].images.length, 3);
  assert.match(payload.items[0].images[1].url, /\/2\.jpeg$/);
  assert.equal(payload.items[0].audios.length, 1);
});
