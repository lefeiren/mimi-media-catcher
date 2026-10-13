/* 咪咪抓视频 - 弹窗逻辑 */
function sanitize(name) {
  return MimiCore.sanitizeFilename(name);
}
async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}
async function fetchItems() {
  const tab = await activeTab();
  try { return await chrome.tabs.sendMessage(tab.id, { type: 'get_items' }); }
  catch (e) { return null; }
}

let batchItems = [];
let batchSiteName = '';
let currentSite = '';
let batchEnabled = false;
const EXT_VER = chrome.runtime.getManifest().version;

// 版本自检：页面脚本版本对不上说明标签页跑的是旧代码，提示刷新
function updateVerFoot(res) {
  const el = document.getElementById('ver-foot');
  if (!el) return;
  const pv = res && res.ver;
  el.classList.remove('stale');
  if (pv && pv !== EXT_VER) {
    el.classList.add('stale');
    el.textContent = '扩展 v' + EXT_VER + ' · 页面脚本 v' + pv + ' → 请刷新页面后再试';
  } else {
    el.textContent = '扩展 v' + EXT_VER + (pv ? ' · 页面脚本 v' + pv : '');
  }
}

// 封面图 URL 模糊匹配（与 inject.js 的 thumbMatch 一致）
function thumbMatch(a, b) {
  if (!a || !b) return false;
  const norm = u => String(u).split('?')[0].split('#')[0].replace(/![^/]*$/i, '');
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  const seg = u => u.split('/').filter(Boolean).slice(-2).join('/');
  const sa = seg(na), sb = seg(nb);
  if (sa && sa === sb) return true;
  const core = s => s.split('/').filter(Boolean).pop() || '';
  const ca = core(na), cb = core(nb);
  return ca.length > 8 && cb.length > 8 && (ca === cb || na.indexOf(cb) >= 0 || nb.indexOf(ca) >= 0);
}

// ---------- 标签页切换 ----------
const tabPage = document.getElementById('tab-page');
const tabBatch = document.getElementById('tab-batch');
const panePage = document.getElementById('pane-page');
const paneBatch = document.getElementById('pane-batch');
function canBatchPage(res) {
  if (!res || res.site === 'x') return false;
  if (res.site === 'douyin') return MimiCore.isDouyinProfileUrl(res.pageUrl);
  if (res.site === 'tiktok') return MimiCore.isTikTokProfileUrl(res.pageUrl);
  if (res.site === 'xhs') return MimiCore.isXhsProfileUrl(res.pageUrl);
  return false;
}
function updateBatchAvailability(res) {
  batchEnabled = canBatchPage(res);
  tabBatch.style.display = batchEnabled ? '' : 'none';
  if (!batchEnabled && !paneBatch.classList.contains('hidden')) tabPage.click();
}
tabPage.onclick = () => { tabPage.classList.add('active'); tabBatch.classList.remove('active'); panePage.classList.remove('hidden'); paneBatch.classList.add('hidden'); };
tabBatch.onclick = () => {
  if (!batchEnabled) return;
  tabBatch.classList.add('active'); tabPage.classList.remove('active');
  paneBatch.classList.remove('hidden'); panePage.classList.add('hidden');
  loadBatchPage(); pollBatch();
};

// 缩略图（失败自动隐藏）
function thumbImg(it) {
  if (!it || !it.thumb || !/^https?:/.test(it.thumb)) return null;
  const img = document.createElement('img');
  img.className = 'thumb';
  img.src = it.thumb;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.onerror = () => img.remove();
  return img;
}
// 带缩略图的卡片主体
function cardBody(it, titleText) {
  const wrap = document.createElement('div');
  const th = thumbImg(it);
  const right = document.createElement('div');
  right.className = 'thumb-wrap';
  const t = document.createElement('div');
  t.className = 'title';
  t.textContent = titleText;
  right.appendChild(t);
  if (th) { wrap.className = 'with-thumb'; wrap.appendChild(th); wrap.appendChild(right); }
  else wrap.appendChild(right);
  return { wrap, right };
}

function imageDownloadItems(it, siteName, siteCode) {
  return (it.images || []).map((image, index) => ({
    url: image.url,
    filename: sanitize(siteName) + '_' + sanitize(it.title) + '_image_' + String(index + 1).padStart(2, '0') + MimiCore.mediaExtension(image.url, 'image'),
    site: siteCode,
    kind: 'image'
  }));
}

async function downloadAllImages(it, siteName, btn) {
  const items = imageDownloadItems(it, siteName, currentSite);
  if (!items.length) return;
  btn.disabled = true;
  btn.textContent = '准备下载 ' + items.length + ' 张图片…';
  const result = await chrome.runtime.sendMessage({ type: 'download_many', items });
  btn.textContent = result && result.ok ? '全部图片已加入下载 ✓' : (result && result.error || '批量下载失败');
  setTimeout(() => { btn.disabled = false; btn.textContent = '🖼 下载全部图片 (' + items.length + ')'; }, 1600);
}

// ---------- 本页下载：只取当前页面的主作品 ----------
function videoButtons(it, siteName) {
  const btns = document.createElement('div');
  btns.className = 'btns';
  (it.videos || []).forEach(v => {
    const b = document.createElement('button');
    b.className = 'dl';
    b.textContent = '🎬 下载视频 ' + (v.label || '') + ' 🔊';
    b.title = '含音频';
    b.onclick = () => download(v.url, sanitize(siteName) + '_' + sanitize(it.title) + '_' + sanitize(v.label || '') + '.mp4', b);
    btns.appendChild(b);
  });
  if ((it.images || []).length > 1) {
    const b = document.createElement('button');
    b.className = 'dl cover';
    b.textContent = '🖼 下载全部图片 (' + it.images.length + ')';
    b.onclick = () => downloadAllImages(it, siteName, b);
    btns.appendChild(b);
  }
  (it.images || []).forEach((image, index) => {
    const b = document.createElement('button');
    b.className = 'dl cover';
    b.textContent = '下载图片 ' + (index + 1) + ' / ' + it.images.length;
    b.onclick = () => download(
      image.url,
      sanitize(siteName) + '_' + sanitize(it.title) + '_image_' + String(index + 1).padStart(2, '0') + MimiCore.mediaExtension(image.url, 'image'),
      b
    );
    btns.appendChild(b);
  });
  (it.audios || []).forEach(a => {
    const b = document.createElement('button');
    b.className = 'dl audio';
    b.textContent = '下载' + (a.label || '音频');
    b.onclick = () => download(a.url, sanitize(siteName) + '_' + sanitize(it.title) + '_audio' + MimiCore.mediaExtension(a.url, 'audio'), b);
    btns.appendChild(b);
  });
  // 封面图下载（学 datatool）
  if (it.thumb && /^https?:/.test(it.thumb) && !(it.images || []).length) {
    const b = document.createElement('button');
    b.className = 'dl cover';
    b.textContent = '🖼 下载封面';
    b.onclick = () => download(it.thumb, sanitize(siteName) + '_' + sanitize(it.title) + '_cover' + MimiCore.mediaExtension(it.thumb, 'image'), b);
    btns.appendChild(b);
  }
  return btns;
}

// 沉浸式信息流：当前作品必须精确识别，猜错比不显示更有害
function isShortVideoFeed(url, site) {
  if (!['douyin', 'tiktok', 'xhs'].includes(site)) return false;
  try {
    const fallback = site === 'tiktok' ? 'https://www.tiktok.com/' : site === 'xhs' ? 'https://www.xiaohongshu.com/explore' : 'https://www.douyin.com/';
    const parsed = new URL(url || fallback);
    if (site === 'tiktok') {
      return parsed.pathname === '/' || /^\/(?:foryou|following|friend|friends|explore)(?:\/|$)/.test(parsed.pathname);
    }
    if (site === 'xhs') {
      return parsed.pathname === '/' || /^\/(?:explore|search_result)\/?$/.test(parsed.pathname);
    }
    return parsed.pathname === '/' || /[?&]recommend=1/.test(parsed.href) || /^\/(?:recommend|follow|friend|friends|jingxuan)(?:\/|$)/.test(parsed.pathname);
  } catch (_) { return true; }
}

async function loadPage(retryCount) {
  retryCount = retryCount || 0;
  const list = document.getElementById('list');
  const siteLabel = document.getElementById('site-label');
  if (!retryCount) list.innerHTML = '<div class="empty">正在抓取当前页面…</div>';
  const res = await fetchItems();
  currentSite = res && res.site || currentSite;
  updateBatchAvailability(res);
  updateVerFoot(res);
  if (!res || !res.items || !res.items.length) {
    // 空数据先等一等再判：可能是页面脚本还没产出第一批数据（此时连 site 都还没识别出来，
    // 正好是之前"博主主页批量能识别、本页不行"的根因——重试条件卡在了 site===douyin 上），
    // 也可能是接口在路上。统一等 1.5s 重试，最多 3 次，各站点通用。
    if (retryCount < 3) {
      list.innerHTML = '<div class="empty">正在抓取当前页面…</div>';
      setTimeout(() => loadPage(retryCount + 1), 1500);
      return;
    }
    siteLabel.textContent = res && res.siteName ? res.siteName : '';
    list.innerHTML = '<div class="empty">没抓到可下载的视频或图片。<br>试试点「重新抓取」，或确认当前作品已加载出来。</div>';
    return;
  }
  // 主作品选择优先级：作品 ID 精确匹配 > 当前媒体匹配 > detail 标记 > 第一项
  // （沉浸式信息流用 DOM 读到的 aweme_id 精确命中，学 doucun/dllocal）
  const mediaItems = res.items.filter(item => (item.videos && item.videos.length) || (item.images && item.images.length));
  let it = null;
  const aid = res.activeItemId;
  if (aid) it = mediaItems.find(i => i.id === aid) || null;
  if (aid && !it && retryCount < 3) {
    // 认出了当前作品的 ID，但数据还没到：等 1.5s 让在途接口返回后重试，最多 3 次。
    // 注意：这里不能发 rescan（会清空 items 重抓，可能把网络已抓到的数据洗掉），只等。
    // 绝不拿错误的作品顶上。
    list.innerHTML = '<div class="empty">正在识别当前作品…</div>';
    setTimeout(() => loadPage(retryCount + 1), 1500);
    return;
  }
  const poster = res.playingPoster;
  if (!it && poster) it = mediaItems.find(i => i.thumb && thumbMatch(poster, i.thumb)) || null;
  if (!it) it = mediaItems.find(i => i.source === 'detail') || null;
  // 信息流页面不许用"第一项"兜底——那大概率是别的作品；其他页面保留旧行为
  if (!it && !isShortVideoFeed(res.pageUrl, res.site)) it = mediaItems[0] || null;
  if (!it) {
    siteLabel.textContent = res.siteName || '';
    list.innerHTML = '<div class="empty">还没识别到当前作品。<br>等内容加载出来后点「重新抓取」试试。</div>';
    return;
  }
  siteLabel.textContent = res.siteName || '';
  list.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  const { wrap, right } = cardBody(it, it.title || '未命名作品');
  right.appendChild(videoButtons(it, res.siteName || ''));
  card.appendChild(wrap);
  list.appendChild(card);
}

async function download(url, filename, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '下载中…'; }
  const kind = /_audio\.(?:m4a|mp3)$/i.test(filename) ? 'audio' : /_(?:cover|image_\d+)\./i.test(filename) ? 'image' : 'video';
  const r = await chrome.runtime.sendMessage({ type: 'download', site: currentSite, url, filename, kind });
  if (btn) {
    btn.textContent = r && r.ok ? '已开始下载' : '下载失败';
    setTimeout(() => { btn.disabled = false; loadPage(); }, 1500);
  }
}

document.getElementById('btn-rescan').onclick = async () => {
  const tab = await activeTab();
  try { await chrome.tabs.sendMessage(tab.id, { type: 'rescan' }); } catch (e) {}
  setTimeout(() => { loadPage(); }, 1200);
};

// ---------- 设置：悬浮按钮开关 ----------
const floatToggle = document.getElementById('float-toggle');
if (floatToggle) {
  chrome.storage.local.get({ mimi_float: true }, (r) => { floatToggle.checked = !!r.mimi_float; });
  floatToggle.onchange = () => chrome.storage.local.set({ mimi_float: floatToggle.checked });
}

// ---------- 批量下载：当前页面的多条作品 ----------
function refreshSelUI() {
  const checks = [...document.querySelectorAll('.item-check')];
  const n = checks.filter(c => c.checked).length;
  const btn = document.getElementById('btn-dl-selected');
  const selAll = document.getElementById('sel-all');
  btn.disabled = n === 0;
  btn.textContent = n ? '下载选中 (' + n + ')' : '下载选中';
  selAll.checked = checks.length > 0 && n === checks.length;
  document.getElementById('batch-count').textContent = checks.length ? '共 ' + checks.length + ' 条' : '';
}

// 详情页 URL 判定：详情页的批量列表只显示主作品，不显示相关推荐
// 抖音弹窗（?modal_id=）也算详情页
function isDetailUrl(url, site) {
  url = url || '';
  if (site === 'douyin') return /\/(?:video|note)\/\d+/.test(url) || /[?&]modal_id=\d+/.test(url);
  if (site === 'tiktok') return /\/(?:video|photo)\/\d+/.test(url);
  if (site === 'xhs') return /\/(explore|discovery\/item)\//.test(url);
  if (site === 'youtube') return /[?&]v=[\w-]+/.test(url) || /youtu\.be\//.test(url);
  if (site === 'x') return /\/status\/\d+/.test(url);
  return false;
}

async function loadBatchPage() {
  const list = document.getElementById('batch-page-list');
  const res = await fetchItems();
  currentSite = res && res.site || currentSite;
  updateBatchAvailability(res);
  if (!canBatchPage(res)) {
    batchItems = [];
    list.innerHTML = '<div class="empty">当前页面只提供本页单条下载。<br>批量下载仅在抖音、TikTok 或小红书的真正创作者主页开放。</div>';
    refreshSelUI();
    return;
  }
  updateVerFoot(res);
  const st = res && res.stats;
  const statsEl = document.getElementById('batch-stats');
  if (statsEl) statsEl.textContent = st ? ('已拦截接口 ' + (st.api || 0) + ' · 当前页作品 ' + (st.videos || 0) + ' · 总缓存 ' + (st.cached || 0)) : '';
  // 精简诊断：当前路由 + 最近命中的数据接口
  const diagEl = document.getElementById('diag-box');
  if (diagEl) {
    let t = '当前路由: ' + ((res && res.route) || '未知') + ' · 解析异常 ' + ((st && st.errors) || 0);
    if (st && st.lastUrls && st.lastUrls.length) t += '\n最近接口:\n' + st.lastUrls.join('\n');
    diagEl.textContent = t;
    diagEl.style.display = 'block';
  }
  if (!res || !res.items || !res.items.length) {
    batchItems = [];
    list.innerHTML = '<div class="empty">还没识别到作品。<br>在当前博主主页上下滚动让内容加载出来，再点「重新抓取」。</div>';
    refreshSelUI();
    return;
  }
  let items = res.items;
  // 单作品详情页：只显示主作品（相关推荐不算当前页面内容）
  if (isDetailUrl(res.pageUrl, res.site)) {
    const d = items.find(i => i.source === 'detail');
    items = d ? [d] : items.slice(0, 1);
  }
  batchItems = items;
  batchSiteName = res.siteName || '';
  list.innerHTML = '';
  batchItems.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'head';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'item-check';
    cb.dataset.idx = idx;
    cb.onchange = refreshSelUI;
    head.appendChild(cb);
    const { wrap, right } = cardBody(it, (idx + 1) + '. ' + (it.title || '未命名作品'));
    head.appendChild(wrap);
    card.appendChild(head);
    const btns = document.createElement('div');
    btns.className = 'btns';
    const v = (it.videos || [])[0];
    if (v) {
      const b = document.createElement('button');
      b.className = 'dl';
      b.textContent = '单独下载 ' + (v.label || '');
      b.onclick = () => download(v.url, sanitize(batchSiteName) + '_' + sanitize(it.title) + '.mp4', b);
      btns.appendChild(b);
    }
    if ((it.images || []).length) {
      const b = document.createElement('button');
      b.className = 'dl cover';
      b.textContent = '下载全部图片 (' + it.images.length + ')';
      b.onclick = () => downloadAllImages(it, batchSiteName, b);
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
        if (result && result.ok) pollPageProgress();
        else setTimeout(() => { b.disabled = false; b.textContent = '解析并下载作品'; }, 1600);
      };
      btns.appendChild(b);
    }
    right.appendChild(btns);
    list.appendChild(card);
  });
  refreshSelUI();
}

// ---------- 一键复制诊断信息 ----------
document.getElementById('btn-diag-copy').onclick = async () => {
  const res = await fetchItems();
  const L = [];
  L.push('咪咪抓视频诊断 ' + new Date().toLocaleString('zh-CN'));
  L.push('扩展 v' + EXT_VER + ' / 页面脚本 v' + (res && res.ver || '?'));
  L.push('页面: ' + (res && res.pageUrl || '?'));
  L.push('站点: ' + (res && res.siteName || '?'));
  const st = (res && res.stats) || {};
  L.push('路由: ' + (res && res.route || '?'));
  L.push('已拦截接口 ' + (st.api || 0) + ' / 当前页作品 ' + (st.videos || 0) + ' / 总缓存 ' + (st.cached || 0) + ' / 异常 ' + (st.errors || 0));
  if (st.lastUrls && st.lastUrls.length) L.push('最近接口:\n' + st.lastUrls.join('\n'));
  const items = (res && res.items) || [];
  L.push('items(' + items.length + '):');
  items.slice(0, 15).forEach((it, i) => L.push('  ' + (i + 1) + '. [' + (it.source || '?') + '] id=' + (it.id || '-') + ' ' + (it.title || '').slice(0, 40)));
  const txt = L.join('\n');
  try { await navigator.clipboard.writeText(txt); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  const b = document.getElementById('btn-diag-copy');
  b.textContent = '已复制 ✓';
  setTimeout(() => { b.textContent = '复制诊断信息'; }, 1500);
};

document.getElementById('sel-all').onchange = (e) => {
  document.querySelectorAll('.item-check').forEach(c => { c.checked = e.target.checked; });
  refreshSelUI();
};

document.getElementById('btn-dl-selected').onclick = async () => {
  const sel = [...document.querySelectorAll('.item-check')]
    .filter(c => c.checked)
    .map(c => batchItems[+c.dataset.idx])
    .filter(it => it && ((it.videos && it.videos.length) || (it.images && it.images.length) || it.pageUrl));
  if (!sel.length) return;
  const btn = document.getElementById('btn-dl-selected');
  btn.disabled = true;
  btn.textContent = '开始批量下载…';
  if (currentSite === 'xhs') {
    const urls = sel.map(item => item.pageUrl).filter(Boolean);
    const result = await chrome.runtime.sendMessage({ type: 'batch', urls });
    if (result && result.ok) pollPageProgress();
    else { btn.disabled = false; btn.textContent = result && result.error ? result.error : '批量任务启动失败'; }
    return;
  }
  const items = sel.flatMap(it => {
    const downloads = [];
    if (it.videos && it.videos[0]) downloads.push({
      url: it.videos[0].url,
      filename: sanitize(batchSiteName) + '_' + sanitize(it.title) + '.mp4',
      site: currentSite,
      kind: 'video'
    });
    downloads.push(...imageDownloadItems(it, batchSiteName, currentSite));
    return downloads;
  });
  const result = await chrome.runtime.sendMessage({ type: 'download_many', items });
  if (result && result.ok) pollPageProgress();
  else { btn.disabled = false; btn.textContent = result && result.error ? result.error : '批量任务启动失败'; }
};

let pagePollTimer = null;
async function pollPageProgress() {
  const el = document.getElementById('page-progress');
  const btn = document.getElementById('btn-dl-selected');
  if (pagePollTimer) clearInterval(pagePollTimer);
  const tick = async () => {
    const { mimi_batch } = await chrome.storage.local.get('mimi_batch');
    if (!mimi_batch || !mimi_batch.total) { el.textContent = ''; return; }
    el.textContent = '批量下载进度：' + mimi_batch.done + ' / ' + mimi_batch.total + (mimi_batch.running ? '（进行中…）' : '（完成）');
    if (!mimi_batch.running) {
      clearInterval(pagePollTimer);
      pagePollTimer = null;
      refreshSelUI();
    }
  };
  await tick();
  if (pagePollTimer) clearInterval(pagePollTimer);
  pagePollTimer = setInterval(tick, 1500);
}

// ---------- 批量下载：粘贴链接 ----------
document.getElementById('btn-clear').onclick = () => { document.getElementById('urls').value = ''; };
document.getElementById('btn-batch').onclick = async () => {
  const raw = document.getElementById('urls').value.split('\n').map(s => s.trim()).filter(s => {
    const targetSite = MimiCore.siteFromUrl(s);
    return /^https?:\/\//.test(s) && targetSite && targetSite !== 'x';
  });
  if (!raw.length) { alert('请先粘贴视频或图文作品链接，每行一个'); return; }
  const btn = document.getElementById('btn-batch');
  btn.disabled = true; btn.textContent = '批量下载中…';
  const result = await chrome.runtime.sendMessage({ type: 'batch', urls: raw });
  if (result && result.ok) pollBatch();
  else { btn.disabled = false; btn.textContent = result && result.error ? result.error : '批量任务启动失败'; }
};
let pollTimer = null;
async function pollBatch() {
  const progress = document.getElementById('progress');
  const blist = document.getElementById('batch-list');
  const btn = document.getElementById('btn-batch');
  if (pollTimer) clearInterval(pollTimer);
  const tick = async () => {
    const { mimi_batch } = await chrome.storage.local.get('mimi_batch');
    if (!mimi_batch) { progress.textContent = ''; return; }
    progress.textContent = '进度：' + mimi_batch.done + ' / ' + mimi_batch.total + (mimi_batch.running ? '（进行中…）' : '（完成）');
    blist.innerHTML = '';
    (mimi_batch.results || []).forEach(r => {
      const d = document.createElement('div');
      d.className = 'item-status';
      const ok = r.status === '成功';
      const s1 = document.createElement('span');
      s1.className = ok ? 'ok' : 'fail';
      s1.textContent = (ok ? '✓ ' : '✗ ') + r.status;
      const br = document.createElement('br');
      const s2 = document.createElement('span');
      s2.textContent = r.url;
      d.appendChild(s1); d.appendChild(br); d.appendChild(s2);
      blist.appendChild(d);
    });
    if (!mimi_batch.running) { btn.disabled = false; btn.textContent = '开始批量下载'; clearInterval(pollTimer); pollTimer = null; }
  };
  await tick();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(tick, 1500);
}

loadPage();
