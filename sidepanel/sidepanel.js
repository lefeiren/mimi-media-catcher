/* 咪咪抓视频 - 侧边栏批量视图 */
function sanitize(name) {
  return MimiCore.sanitizeFilename(name);
}
let spItems = [];
let spSite = '';
let spSiteCode = '';
let spTabId = null;
let spPageUrl = '';
const SP_EXT_VER = chrome.runtime.getManifest().version;

function imageDownloadItems(item) {
  return (item.images || []).map((image, index) => ({
    url: image.url,
    filename: sanitize(spSite) + '_' + sanitize(item.title) + '_image_' + String(index + 1).padStart(2, '0') + MimiCore.mediaExtension(image.url, 'image'),
    site: spSiteCode,
    kind: 'image'
  }));
}

function updateSpVer(res) {
  const el = document.getElementById('sp-ver');
  if (!el) return;
  const pv = res && res.ver;
  if (pv && pv !== SP_EXT_VER) {
    el.style.color = '#c33';
    el.style.fontWeight = '600';
    el.textContent = '扩展 v' + SP_EXT_VER + ' · 页面脚本 v' + pv + ' → 请刷新页面后再试';
  } else {
    el.textContent = '扩展 v' + SP_EXT_VER + (pv ? ' · 页面脚本 v' + pv : '');
  }
}

function refreshUI() {
  const checks = [...document.querySelectorAll('.sp-check')];
  const n = checks.filter(c => c.checked).length;
  const btn = document.getElementById('sp-dl');
  const selAll = document.getElementById('sp-sel-all');
  btn.disabled = n === 0;
  btn.textContent = n ? '下载选中 (' + n + ')' : '下载选中';
  selAll.checked = checks.length > 0 && n === checks.length;
  document.getElementById('sp-count').textContent = checks.length ? '共 ' + checks.length + ' 条' : '';
}

function isDetailUrlSp(url, site) {
  url = url || '';
  if (site === 'douyin') return /\/(?:video|note)\/\d+/.test(url) || /[?&]modal_id=\d+/.test(url);
  if (site === 'tiktok') return /\/(?:video|photo)\/\d+/.test(url);
  if (site === 'xhs') return /\/(explore|discovery\/item)\//.test(url);
  if (site === 'youtube') return /[?&]v=[\w-]+/.test(url) || /youtu\.be\//.test(url);
  if (site === 'x') return /\/status\/\d+/.test(url);
  return false;
}

function render(items, siteName, siteCode) {
  spSite = siteName || '';
  spSiteCode = siteCode || spSiteCode;
  if (spSiteCode === 'x') {
    spItems = [];
    document.getElementById('sp-site').textContent = 'X · 单条下载';
    document.getElementById('sp-list').innerHTML = '<div class="empty">X 不提供批量下载，请使用视频右上角的下载图标。</div>';
    refreshUI();
    return;
  }
  if (spSiteCode === 'douyin' && !MimiCore.isDouyinProfileUrl(spPageUrl)) {
    spItems = [];
    document.getElementById('sp-site').textContent = '抖音 · 本页单条下载';
    document.getElementById('sp-list').innerHTML = '<div class="empty">批量下载仅在博主主页或「我的」主页开放。</div>';
    refreshUI();
    return;
  }
  if (spSiteCode === 'tiktok' && !MimiCore.isTikTokProfileUrl(spPageUrl)) {
    spItems = [];
    document.getElementById('sp-site').textContent = 'TikTok · 本页单条下载';
    document.getElementById('sp-list').innerHTML = '<div class="empty">批量下载仅在真正的创作者主页开放。</div>';
    refreshUI();
    return;
  }
  if (spSiteCode === 'xhs' && !MimiCore.isXhsProfileUrl(spPageUrl)) {
    spItems = [];
    document.getElementById('sp-site').textContent = '小红书 · 本页单条下载';
    document.getElementById('sp-list').innerHTML = '<div class="empty">批量下载仅在真正的博主主页开放。</div>';
    refreshUI();
    return;
  }
  // 单作品详情页：只显示主作品
  if (isDetailUrlSp(spPageUrl, spSiteCode)) {
    const d = (items || []).find(i => i.source === 'detail');
    items = d ? [d] : (items || []).slice(0, 1);
  }
  spItems = items || [];
  const list = document.getElementById('sp-list');
  document.getElementById('sp-site').textContent = (siteName || '') + (items.length ? ' · 已识别 ' + items.length + ' 条' : '');
  if (!items.length) {
    list.innerHTML = '<div class="empty">还没识别到作品。<br>滚动页面加载后点「重新抓取」。博主主页需要登录态。</div>';
    refreshUI();
    return;
  }
  list.innerHTML = '';
  items.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'head';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'sp-check';
    cb.dataset.idx = idx;
    cb.onchange = refreshUI;
    head.appendChild(cb);
    const wrap = document.createElement('div');
    const right = document.createElement('div');
    right.className = 'thumb-wrap';
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = (idx + 1) + '. ' + (it.title || '未命名作品');
    right.appendChild(t);
    if (it.thumb && /^https?:/.test(it.thumb)) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = it.thumb;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => img.remove();
      wrap.className = 'with-thumb';
      wrap.appendChild(img);
    }
    wrap.appendChild(right);
    wrap.style.flex = '1';
    head.appendChild(wrap);
    card.appendChild(head);
    const btns = document.createElement('div');
    btns.className = 'btns';
    const v = (it.videos || [])[0];
    if (v) {
      const b = document.createElement('button');
      b.className = 'dl';
      b.textContent = '单独下载 ' + (v.label || '');
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = '下载中…';
        const r = await chrome.runtime.sendMessage({
          type: 'download',
          site: spSiteCode,
          url: v.url,
          filename: sanitize(spSite) + '_' + sanitize(it.title) + '.mp4'
        });
        b.textContent = r && r.ok ? '已开始下载' : '下载失败';
        setTimeout(() => { b.disabled = false; b.textContent = '单独下载 ' + (v.label || ''); }, 1500);
      };
      btns.appendChild(b);
    }
    if ((it.images || []).length) {
      const b = document.createElement('button');
      b.className = 'dl cover';
      b.textContent = '下载全部图片 (' + it.images.length + ')';
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = '加入下载队列…';
        const result = await chrome.runtime.sendMessage({ type: 'download_many', items: imageDownloadItems(it) });
        b.textContent = result && result.ok ? '全部图片已加入下载 ✓' : (result && result.error || '批量下载失败');
        setTimeout(() => { b.disabled = false; b.textContent = '下载全部图片 (' + it.images.length + ')'; }, 1600);
      };
      btns.appendChild(b);
    }
    if (!(it.videos || []).length && !(it.images || []).length && it.pageUrl) {
      const b = document.createElement('button');
      b.className = 'dl';
      b.textContent = '解析并下载作品';
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = '正在后台解析…';
        const result = await chrome.runtime.sendMessage({ type: 'batch', urls: [it.pageUrl] });
        b.textContent = result && result.ok ? '已加入下载队列 ✓' : (result && result.error || '解析失败');
        if (result && result.ok) pollProgress();
        else setTimeout(() => { b.disabled = false; b.textContent = '解析并下载作品'; }, 1600);
      };
      btns.appendChild(b);
    }
    card.appendChild(btns);
    list.appendChild(card);
  });
  refreshUI();
}

document.getElementById('sp-sel-all').onchange = (e) => {
  document.querySelectorAll('.sp-check').forEach(c => { c.checked = e.target.checked; });
  refreshUI();
};

document.getElementById('sp-dl').onclick = async () => {
  const sel = [...document.querySelectorAll('.sp-check')]
    .filter(c => c.checked)
    .map(c => spItems[+c.dataset.idx])
    .filter(it => it && ((it.videos && it.videos.length) || (it.images && it.images.length) || it.pageUrl));
  if (!sel.length) return;
  const btn = document.getElementById('sp-dl');
  btn.disabled = true;
  btn.textContent = '开始批量下载…';
  if (spSiteCode === 'xhs') {
    const urls = sel.map(item => item.pageUrl).filter(Boolean);
    const result = await chrome.runtime.sendMessage({ type: 'batch', urls });
    if (result && result.ok) pollProgress();
    else { btn.disabled = false; btn.textContent = result && result.error ? result.error : '批量任务启动失败'; }
    return;
  }
  const items = sel.flatMap(it => {
    const downloads = [];
    if (it.videos && it.videos[0]) downloads.push({
      url: it.videos[0].url,
      filename: sanitize(spSite) + '_' + sanitize(it.title) + '.mp4',
      site: spSiteCode,
      kind: 'video'
    });
    downloads.push(...imageDownloadItems(it));
    return downloads;
  });
  const result = await chrome.runtime.sendMessage({ type: 'download_many', items });
  if (result && result.ok) pollProgress();
  else { btn.disabled = false; btn.textContent = result && result.error ? result.error : '批量任务启动失败'; }
};

let pollTimer = null;
async function pollProgress() {
  const el = document.getElementById('sp-progress');
  const btn = document.getElementById('sp-dl');
  if (pollTimer) clearInterval(pollTimer);
  const tick = async () => {
    const { mimi_batch } = await chrome.storage.local.get('mimi_batch');
    if (!mimi_batch || !mimi_batch.total) { el.textContent = ''; return; }
    el.textContent = '批量下载进度：' + mimi_batch.done + ' / ' + mimi_batch.total + (mimi_batch.running ? '（进行中…）' : '（完成）');
    if (!mimi_batch.running) { clearInterval(pollTimer); pollTimer = null; refreshUI(); }
  };
  await tick();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(tick, 1500);
}

async function reload() {
  if (spTabId == null) return;
  const res = await chrome.tabs.sendMessage(spTabId, { type: 'get_items' }).catch(() => null);
  updateSpVer(res);
  spPageUrl = (res && res.pageUrl) || '';
  if (res) render(res.items || [], res.siteName || '', res.site || '');
}
document.getElementById('sp-rescan').onclick = async () => {
  if (spTabId == null) return;
  try { await chrome.tabs.sendMessage(spTabId, { type: 'rescan' }); } catch (e) {}
  setTimeout(reload, 1500);
};

// 页面有新作品时自动追加
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'mimi_items' && msg.items && sender.tab && sender.tab.id === spTabId) {
    spPageUrl = msg.pageUrl || spPageUrl;
    updateSpVer(msg);
    render(msg.items, msg.siteName || '', msg.site || '');
  }
});

(async function init() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) spTabId = tabs[0].id;
  await reload();
})();
