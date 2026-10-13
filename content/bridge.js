/* 咪咪抓视频 - 隔离世界桥接与页面浮动下载菜单 */
(() => {
  'use strict';
  const Core = globalThis.MimiCore;
  if (!Core) return;

  const TAG = '__mimi_dl_v2__';
  const RESCAN = '__mimi_rescan_v2__';
  const site = Core.siteFromHost(location.hostname);
  if (!site) return;

  let cached = { site, siteName: '', pageUrl: location.href, route: '', items: [], ver: Core.VERSION, stats: {} };
  let floatOn = true;
  let scanTimer = 0;
  const overlayByMedia = new WeakMap();
  const mediaByOverlay = new WeakMap();

  function safeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const videos = Core.pickThreeQualities(raw.videos || []).filter(v => Core.isAllowedMediaUrl(v.url, site));
    const seenImages = new Set();
    const images = (raw.images || []).filter(image => {
      if (!image || !Core.isAllowedMediaUrl(image.url, site) || seenImages.has(image.url)) return false;
      seenImages.add(image.url);
      return true;
    }).slice(0, 50).map((image, index) => ({
      url: image.url,
      width: Number(image.width) || 0,
      height: Number(image.height) || 0,
      label: String(image.label || ('图片 ' + (index + 1))).slice(0, 40)
    }));
    let pageUrl = '';
    if (site === 'xhs' && raw.pageUrl) {
      try {
        const page = new URL(raw.pageUrl);
        const match = page.pathname.match(/^\/(?:explore|discovery\/item)\/([\w-]+)\/?$/);
        if (Core.siteFromHost(page.hostname) === 'xhs' && match && match[1] === String(raw.id || '')) pageUrl = page.href;
      } catch (_) {}
    }
    if (!videos.length && !images.length && !pageUrl) return null;
    return {
      id: String(raw.id || '').slice(0, 100),
      tweetId: String(raw.tweetId || '').slice(0, 40),
      ownerId: String(raw.ownerId || '').slice(0, 120),
      mediaIndex: Number(raw.mediaIndex) || 0,
      title: String(raw.title || '未命名作品').replace(/\s+/g, ' ').slice(0, 120),
      author: String(raw.author || '').replace(/\s+/g, ' ').slice(0, 80),
      thumb: Core.isAllowedMediaUrl(raw.thumb, site) ? raw.thumb : '',
      videos,
      images,
      audios: (raw.audios || []).filter(a => a && Core.isAllowedMediaUrl(a.url, site)).slice(0, 3).map(a => ({ url: a.url, label: String(a.label || '音频').slice(0, 40) })),
      pageUrl,
      source: raw.source === 'detail' ? 'detail' : 'feed'
    };
  }

  function safePayload(raw) {
    if (!raw || raw.site !== site || !Array.isArray(raw.items)) return null;
    try {
      const page = new URL(raw.pageUrl);
      if (Core.siteFromHost(page.hostname) !== site) return null;
    } catch (_) { return null; }
    return {
      site,
      siteName: String(raw.siteName || '').slice(0, 20),
      pageUrl: String(raw.pageUrl || location.href).slice(0, 1000),
      route: String(raw.route || '').slice(0, 40),
      items: raw.items.slice(0, 250).map(safeItem).filter(Boolean),
      ver: String(raw.ver || '').slice(0, 20),
      stats: raw.stats && typeof raw.stats === 'object' ? raw.stats : {}
    };
  }

  function extractShortVideoId(element) {
    // 小红书用 SPA 弹层打开详情时，<body> 背后仍保留整个推荐列表。
    // 详情媒体必须优先绑定当前路由 ID，否则向上遍历到 body 时会
    // 误拿列表第一条笔记的链接，导致数据已抓到但浮动菜单无法匹配。
    if (site === 'xhs' && element.closest && element.closest('#noteContainer,.note-detail-mask')) {
      const current = location.pathname.match(/\/(?:explore|discovery\/item)\/([\w-]+)/);
      if (current) return current[1];
    }
    let node = element;
    for (let depth = 0; node && depth < 18; depth++, node = node.parentElement) {
      if (!node.getAttribute) continue;
      for (const name of ['data-e2e-vid', 'data-aweme-id', 'data-item-id', 'data-video-id', 'data-note-id']) {
        const value = node.getAttribute(name);
        if (value && (site === 'xhs' ? /^[\w-]{8,100}$/.test(value) : /^\d{8,}$/.test(value))) return value;
      }
      const href = node.getAttribute('href') || '';
      const ownMatch = site === 'xhs'
        ? href.match(/\/(?:explore|discovery\/item)\/([\w-]+)/)
        : href.match(/\/(?:video|photo|note)\/(\d+)/);
      if (ownMatch) return ownMatch[1];
      // 图片只接受自身/祖先的作品标识，避免从大容器里的其他作品链接误配到头像或广告图。
      const link = element.tagName !== 'IMG' && node.querySelector && node.querySelector(site === 'xhs'
        ? 'a[href*="/explore/"],a[href*="/discovery/item/"]'
        : 'a[href*="/video/"],a[href*="/photo/"],a[href*="/note/"]');
      const match = link && (site === 'xhs'
        ? (link.getAttribute('href') || '').match(/\/(?:explore|discovery\/item)\/([\w-]+)/)
        : (link.getAttribute('href') || '').match(/\/(?:video|photo|note)\/(\d+)/));
      if (match) return match[1];
    }
    if (element.tagName === 'IMG') return '';
    if (site === 'douyin') {
      const modal = new URL(location.href).searchParams.get('modal_id');
      if (modal && /^\d+$/.test(modal)) return modal;
    }
    const detail = site === 'xhs'
      ? location.pathname.match(/\/(?:explore|discovery\/item)\/([\w-]+)/)
      : location.pathname.match(/\/(?:video|photo|note)\/(\d+)/);
    return detail ? detail[1] : '';
  }

  function xContext(video) {
    const article = video.closest('article[data-testid="tweet"]');
    if (!article) return null;
    const links = article.querySelectorAll('a[href*="/status/"]');
    const tweetIds = [];
    for (const link of links) {
      const match = (link.getAttribute('href') || '').match(/\/status\/(\d+)/);
      if (match && !tweetIds.includes(match[1])) tweetIds.push(match[1]);
    }
    const videos = [...article.querySelectorAll('video')];
    return { article, tweetIds, videoIndex: Math.max(0, videos.indexOf(video)) };
  }

  function sameMediaImage(a, b) {
    if (!a || !b) return false;
    try {
      const normalize = raw => new URL(raw).pathname.replace(/![^/]*$/i, '').replace(/\.[a-z0-9]+$/i, '');
      const left = normalize(a);
      const right = normalize(b);
      if (left === right) return true;
      const leftFile = left.split('/').filter(Boolean).pop() || '';
      const rightFile = right.split('/').filter(Boolean).pop() || '';
      if (leftFile.length > 12 && leftFile === rightFile) return true;
      const leftTail = left.split('/').filter(Boolean).slice(-2).join('/');
      const rightTail = right.split('/').filter(Boolean).slice(-2).join('/');
      return leftTail.length > 12 && leftTail === rightTail;
    } catch (_) { return false; }
  }

  function textMatchesArticle(item, article) {
    const title = String(item.title || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
    const text = String(article && article.innerText || '').replace(/\s+/g, ' ');
    return title.length >= 8 && text.includes(title);
  }

  function itemForMedia(media) {
    const items = (cached.items || []).filter(item => (item.videos && item.videos.length) || (item.images && item.images.length));
    if (site === 'x') {
      if (media.tagName !== 'VIDEO') return null;
      const context = xContext(media);
      if (!context) return null;
      const posterMatch = items.find(item => sameMediaImage(media.poster, item.thumb));
      if (posterMatch) return posterMatch;
      const matches = items.filter(item => context.tweetIds.includes(item.tweetId)).sort((a, b) => a.mediaIndex - b.mediaIndex);
      if (!matches.length) {
        const textMatch = items.find(item => textMatchesArticle(item, context.article));
        if (textMatch) return textMatch;
      }
      return matches[context.videoIndex] || matches[0] || null;
    }
    if (site === 'douyin' || site === 'tiktok' || site === 'xhs') {
      const mediaUrl = media.currentSrc || media.src || '';
      if (mediaUrl) {
        const direct = items.find(item =>
          (item.videos || []).some(option => sameMediaImage(mediaUrl, option.url)) ||
          (item.images || []).some(option => sameMediaImage(mediaUrl, option.url)) ||
          sameMediaImage(mediaUrl, item.thumb)
        );
        if (direct) return direct;
      }
      const id = extractShortVideoId(media);
      if (id) {
        const exact = items.find(item => item.id === id);
        if (exact) return exact;
      }
      const poster = media.poster || media.currentSrc || media.src || '';
      if (poster) {
        const target = poster.split('?')[0].split('/').pop();
        const match = items.find(item => item.thumb && item.thumb.split('?')[0].endsWith(target));
        if (match) return match;
      }
    }
    return null;
  }

  function activeMedia() {
    const selector = site === 'x' ? 'video' : 'video, img';
    const candidates = [...document.querySelectorAll(selector)]
      .map(media => {
        const item = itemForMedia(media);
        if (!item) return { media, score: 0 };
        const rect = media.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
        const visibleHeight = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
        const playing = media.tagName === 'VIDEO' && !media.paused && !media.ended && media.readyState >= 2 ? 1 : 0;
        return { media, score: playing * 1e12 + visibleWidth * visibleHeight };
      })
      .filter(entry => entry.score > 10000)
      .sort((a, b) => b.score - a.score);
    return candidates[0] && candidates[0].media;
  }

  function activeItemId() {
    const media = activeMedia();
    const item = media && itemForMedia(media);
    return item ? item.id : '';
  }

  function closeMenus(except) {
    document.querySelectorAll('.mimi-dl-v2-menu').forEach(menu => {
      if (menu !== except) menu.remove();
    });
  }

  function download(url, filename, kind) {
    return chrome.runtime.sendMessage({ type: 'download', site, url, filename, kind: kind || 'video' });
  }

  function menuRow(text, handler, accent) {
    const row = document.createElement('button');
    row.type = 'button';
    row.textContent = text;
    Object.assign(row.style, {
      display: 'block', width: '100%', border: '0', borderRadius: '7px', padding: '9px 10px',
      margin: '2px 0', textAlign: 'left', background: 'transparent', color: accent || '#fff',
      cursor: 'pointer', fontSize: '13px', lineHeight: '18px', fontFamily: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif'
    });
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,.12)'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
    row.addEventListener('click', event => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      handler(row);
    });
    return row;
  }

  function imageFilename(item, image, index) {
    const stem = (item.author ? item.author + '_' : '') + item.title + '_image_' + String(index + 1).padStart(2, '0');
    return Core.sanitizeFilename(stem) + Core.mediaExtension(image.url, 'image');
  }

  async function downloadAllImages(item, row) {
    const old = row.textContent;
    let succeeded = 0;
    row.disabled = true;
    for (let index = 0; index < item.images.length; index++) {
      row.textContent = '正在下载 ' + (index + 1) + ' / ' + item.images.length + '…';
      const image = item.images[index];
      const result = await download(image.url, imageFilename(item, image, index), 'image').catch(() => null);
      if (result && result.ok) succeeded++;
    }
    row.textContent = succeeded === item.images.length ? '全部图片已开始下载 ✓' : '已开始 ' + succeeded + ' / ' + item.images.length;
    setTimeout(() => { row.disabled = false; row.textContent = old; }, 1600);
  }

  function showMenu(media, wrap) {
    closeMenus();
    const menu = document.createElement('div');
    menu.className = 'mimi-dl-v2-menu';
    Object.assign(menu.style, {
      position: 'absolute', top: '38px', width: '220px', padding: '7px',
      background: 'rgba(22,22,26,.97)', color: '#fff', borderRadius: '11px', zIndex: '2147483647',
      boxShadow: '0 8px 28px rgba(0,0,0,.45)', boxSizing: 'border-box', maxHeight: '70vh', overflowY: 'auto'
    });
    Object.assign(menu.style, site === 'xhs' ? { left: '0' } : { right: '0' });
    const item = itemForMedia(media);
    if (!item) {
      const waiting = document.createElement('div');
      waiting.textContent = '正在识别这条内容…';
      waiting.style.cssText = 'padding:10px;color:#bbb;font-size:13px;';
      menu.appendChild(waiting);
      try { window.postMessage({ [RESCAN]: true }, location.origin); } catch (_) {}
    } else {
      const title = document.createElement('div');
      title.textContent = item.title || '未命名作品';
      title.style.cssText = 'padding:5px 8px 7px;color:#bbb;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:4px;';
      menu.appendChild(title);
      item.videos.slice(0, 3).forEach(videoOption => {
        const filename = Core.sanitizeFilename((item.author ? item.author + '_' : '') + item.title + '_' + videoOption.label) + '.mp4';
        menu.appendChild(menuRow('🎬 ' + videoOption.label + '  ↓', async row => {
          const old = row.textContent;
          row.textContent = '正在开始下载…';
          const result = await download(videoOption.url, filename, 'video').catch(() => null);
          row.textContent = result && result.ok ? '已开始下载 ✓' : '下载失败';
          setTimeout(() => { row.textContent = old; }, 1400);
        }));
      });
      if (item.images.length > 1) {
        menu.appendChild(menuRow('🖼 一键下载全部图片 (' + item.images.length + ')', row => downloadAllImages(item, row), '#ffd39b'));
      }
      item.images.forEach((image, index) => {
        menu.appendChild(menuRow('🖼 下载图片 ' + (index + 1) + ' / ' + item.images.length + '  ↓', async row => {
          const old = row.textContent;
          row.textContent = '正在开始下载…';
          const result = await download(image.url, imageFilename(item, image, index), 'image').catch(() => null);
          row.textContent = result && result.ok ? '已开始下载 ✓' : '下载失败';
          setTimeout(() => { row.textContent = old; }, 1400);
        }, '#ffd39b'));
      });
      item.audios.slice(0, 1).forEach(audio => {
        const filename = Core.sanitizeFilename((item.author ? item.author + '_' : '') + item.title + '_audio') + Core.mediaExtension(audio.url, 'audio');
        menu.appendChild(menuRow('🔊 下载音频  ↓', row => download(audio.url, filename, 'audio').then(result => {
          row.textContent = result && result.ok ? '已开始下载 ✓' : '下载失败';
        }), '#a9d7ff'));
      });
      if (item.thumb && !item.images.length) {
        const filename = Core.sanitizeFilename((item.author ? item.author + '_' : '') + item.title + '_cover') + Core.mediaExtension(item.thumb, 'image');
        menu.appendChild(menuRow('🖼 下载封面  ↓', row => download(item.thumb, filename, 'image').then(result => {
          row.textContent = result && result.ok ? '已开始下载 ✓' : '下载失败';
        }), '#ffd39b'));
      }
    }
    wrap.appendChild(menu);
  }

  function overlayHost(media) {
    if (site === 'x') return media.closest('[data-testid="videoPlayer"]') || media.parentElement;
    return media.parentElement;
  }

  function addOverlay(media) {
    if (media.tagName === 'IMG' && !itemForMedia(media)) return;
    const existing = overlayByMedia.get(media);
    if (existing && existing.isConnected) return;
    const rect = media.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 90) return;
    const hostElement = overlayHost(media);
    if (!hostElement) return;
    if ([...hostElement.children].some(child => child.classList && child.classList.contains('mimi-dl-v2-wrap'))) return;
    if (getComputedStyle(hostElement).position === 'static') hostElement.style.position = 'relative';
    const wrap = document.createElement('div');
    wrap.className = 'mimi-dl-v2-wrap';
    Object.assign(wrap.style, { position: 'absolute', top: '10px', zIndex: '2147483646' });
    Object.assign(wrap.style, site === 'xhs' ? { left: '10px' } : { right: '10px' });
    const button = document.createElement('button');
    button.type = 'button';
    button.title = '下载视频或图片';
    button.setAttribute('aria-label', '下载视频或图片');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    Object.assign(icon.style, { width: '20px', height: '20px', display: 'block', pointerEvents: 'none' });
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrow.setAttribute('d', 'M12 4v12m-5-5 5 5 5-5');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor');
    arrow.setAttribute('stroke-width', '2.4');
    arrow.setAttribute('stroke-linecap', 'round');
    arrow.setAttribute('stroke-linejoin', 'round');
    icon.appendChild(arrow);
    button.appendChild(icon);
    Object.assign(button.style, {
      width: '36px', height: '36px', border: '1px solid rgba(255,255,255,.35)', borderRadius: '50%',
      background: 'linear-gradient(135deg,#6d5cff,#ff5c8a)', color: '#fff', cursor: 'pointer',
      display: 'grid', placeItems: 'center', boxSizing: 'border-box', padding: '0',
      appearance: 'none', WebkitAppearance: 'none', boxShadow: '0 4px 14px rgba(0,0,0,.35)'
    });
    button.addEventListener('click', event => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      const open = wrap.querySelector('.mimi-dl-v2-menu');
      if (open) open.remove(); else showMenu(media, wrap);
    });
    wrap.appendChild(button);
    hostElement.appendChild(wrap);
    overlayByMedia.set(media, wrap);
    mediaByOverlay.set(wrap, media);
  }

  function scanOverlays() {
    if (!floatOn || !['x', 'douyin', 'tiktok', 'xhs'].includes(site) || !document.documentElement) return;
    document.querySelectorAll(site === 'x' ? 'video' : 'video, img').forEach(addOverlay);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanOverlays, 150);
  }

  function clearOverlays() {
    document.querySelectorAll('.mimi-dl-v2-wrap').forEach(node => node.remove());
  }

  function refreshOpenMenus() {
    document.querySelectorAll('.mimi-dl-v2-wrap').forEach(wrap => {
      const menu = wrap.querySelector('.mimi-dl-v2-menu');
      const media = mediaByOverlay.get(wrap);
      if (!menu || !media || !itemForMedia(media)) return;
      menu.remove();
      showMenu(media, wrap);
    });
  }

  chrome.storage.local.get({ mimi_float: true }, result => {
    floatOn = !!result.mimi_float;
    if (floatOn) scheduleScan();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.mimi_float) return;
    floatOn = !!changes.mimi_float.newValue;
    if (floatOn) scheduleScan(); else clearOverlays();
  });

  addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || !event.data || !event.data[TAG]) return;
    const next = safePayload(event.data);
    if (!next) return;
    cached = next;
    refreshOpenMenus();
    scheduleScan();
    try {
      chrome.runtime.sendMessage({
        type: 'mimi_items', site: next.site, siteName: next.siteName, pageUrl: next.pageUrl,
        route: next.route, items: next.items, ver: next.ver, stats: next.stats
      });
    } catch (_) {}
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'get_items') {
      if (!cached.items.length) {
        try { window.postMessage({ [RESCAN]: true }, location.origin); } catch (_) {}
      }
      const media = activeMedia();
      sendResponse(Object.assign({}, cached, {
        activeItemId: activeItemId(),
        playingPoster: media && Core.isAllowedMediaUrl(media.poster || media.currentSrc || media.src, site)
          ? (media.poster || media.currentSrc || media.src)
          : ''
      }));
      return true;
    }
    if (message.type === 'rescan') {
      try { window.postMessage({ [RESCAN]: true }, location.origin); } catch (_) {}
      scheduleScan();
      sendResponse({ ok: true });
      return true;
    }
  });

  function startObserver() {
    if (!document.documentElement) return;
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('click', event => {
      if (!event.target.closest || !event.target.closest('.mimi-dl-v2-wrap')) closeMenus();
    }, true);
    scheduleScan();
  }

  if (document.documentElement) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
})();
