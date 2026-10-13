/* 咪咪抓视频 - MAIN world 数据捕获层 */
(() => {
  'use strict';
  const Core = globalThis.MimiCore;
  if (!Core) return;

  const TAG = '__mimi_dl_v2__';
  const RESCAN = '__mimi_rescan_v2__';
  const host = location.hostname.toLowerCase();
  const site = Core.siteFromHost(host);
  if (!site) return;

  const SITE_NAME = { douyin: '抖音', x: 'X', tiktok: 'TikTok', xhs: '小红书', youtube: 'YouTube' };
  const catalog = new Map();
  const scopeOrder = new Map();
  const stats = { api: 0, videos: 0, lastUrls: [], errors: 0 };
  let currentScope = scopeForPage(location.href);
  const bootScope = currentScope;
  let scopeStartedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
  let lastUrl = location.href;
  let publishTimer = 0;

  function scopeForPage(raw) {
    let url;
    try { url = new URL(raw); } catch (_) { return site + ':unknown'; }
    if (site === 'douyin') {
      const modal = url.searchParams.get('modal_id');
      if (modal) return 'douyin:modal:' + modal;
      let m = url.pathname.match(/\/(?:video|note)\/(\d+)/);
      if (m) return 'douyin:video:' + m[1];
      m = url.pathname.match(/\/user\/([^/?#]+)/);
      if (m) return 'douyin:user:' + m[1];
      if (/^\/follow(?:\/|$)/.test(url.pathname)) return 'douyin:follow';
      if (/^\/(?:friend|friends)(?:\/|$)/.test(url.pathname)) return 'douyin:friend';
      if (/^\/jingxuan(?:\/|$)/.test(url.pathname)) return 'douyin:jingxuan';
      if (url.searchParams.get('recommend') === '1' || /^\/recommend(?:\/|$)/.test(url.pathname)) return 'douyin:recommend';
      if (url.pathname === '/' || !url.pathname) return 'douyin:home';
      return 'douyin:' + url.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
    }
    if (site === 'tiktok') {
      let m = url.pathname.match(/^\/@[^/]+\/(?:video|photo)\/(\d+)/);
      if (m) return 'tiktok:video:' + m[1];
      m = url.pathname.match(/^\/@([^/?#]+)\/?$/);
      if (m) return 'tiktok:user:' + decodeURIComponent(m[1]).toLowerCase();
      if (/^\/following(?:\/|$)/.test(url.pathname)) return 'tiktok:following';
      if (/^\/(?:friends|friend)(?:\/|$)/.test(url.pathname)) return 'tiktok:friends';
      if (/^\/explore(?:\/|$)/.test(url.pathname)) return 'tiktok:explore';
      if (/^\/foryou(?:\/|$)/.test(url.pathname) || url.pathname === '/' || !url.pathname) return 'tiktok:home';
      return 'tiktok:' + url.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
    }
    if (site === 'x') {
      const m = url.pathname.match(/\/status\/(\d+)/);
      if (m) return 'x:status:' + m[1];
      return 'x:' + (url.pathname.split('/').filter(Boolean).slice(0, 2).join('/') || 'home');
    }
    if (site === 'xhs') {
      let m = url.pathname.match(/^\/(?:explore|discovery\/item)\/([\w-]+)/);
      if (m) return 'xhs:detail:' + m[1];
      m = url.pathname.match(/^\/user\/profile\/([^/?#]+)/);
      if (m) return 'xhs:user:' + decodeURIComponent(m[1]);
      if (/^\/search_result(?:\/|$)/.test(url.pathname)) return 'xhs:search';
      if (/^\/(?:explore)?\/?$/.test(url.pathname)) return 'xhs:home';
      return 'xhs:' + (url.pathname.split('/').filter(Boolean).slice(0, 2).join('/') || 'home');
    }
    return site + ':' + url.pathname;
  }

  function detailIdFromScope(scope) {
    const m = String(scope || '').match(/^(?:(?:douyin:(?:modal|video)|tiktok:video|x:status):(\d+)|xhs:detail:([\w-]+))$/);
    return m ? (m[1] || m[2]) : '';
  }

  function safeText(value, fallback) {
    return String(value || fallback || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function urlsFromAddress(addr) {
    if (!addr) return [];
    const list = typeof addr === 'string'
      ? [addr]
      : Array.isArray(addr) ? addr : (addr.url_list || addr.urlList || addr.UrlList || addr.urls || addr.url || addr.src || []);
    return (Array.isArray(list) ? list : [list])
      .map(x => typeof x === 'string' ? x : (x && (x.url || x.src)) || '')
      .filter(x => /^https?:\/\//i.test(x))
      .map(Core.cleanMediaUrl);
  }

  function firstUrl(addr) {
    return urlsFromAddress(addr)[0] || '';
  }

  function firstAllowedUrl(...addresses) {
    for (const address of addresses) {
      const match = urlsFromAddress(address).map(raw => {
        // 小红书当前的 mediaV2 仍会返回 http://*.xhscdn.com 。
        // 页面本身在 HTTPS 下会将这些同域 CDN 地址升级为 HTTPS；
        // 扩展只对已在白名单的小红书 CDN 做相同处理。
        if (site !== 'xhs' || !/^http:\/\//i.test(raw)) return raw;
        try {
          const url = new URL(raw);
          if (!['xhscdn.com', 'xhscdn.net'].some(suffix => Core.hostMatches(url.hostname, suffix))) return raw;
          url.protocol = 'https:';
          return url.href;
        } catch (_) { return raw; }
      }).find(url => Core.isAllowedMediaUrl(url, site));
      if (match) return match;
    }
    return '';
  }

  function itemKey(item) {
    if (item.id) return site + ':id:' + item.id;
    const first = item.videos && item.videos[0] && item.videos[0].url;
    return first ? site + ':url:' + first : '';
  }

  function rememberItem(raw, scope, source) {
    if (!raw) return null;
    const videos = Core.pickThreeQualities(raw.videos || []).filter(v => Core.isAllowedMediaUrl(v.url, site));
    const imageUrls = new Set();
    const images = (raw.images || []).filter(image => {
      if (!image || !Core.isAllowedMediaUrl(image.url, site) || imageUrls.has(image.url)) return false;
      imageUrls.add(image.url);
      return true;
    }).slice(0, 50).map((image, index) => ({
      url: image.url,
      width: Number(image.width) || 0,
      height: Number(image.height) || 0,
      label: safeText(image.label, '图片 ' + (index + 1))
    }));
    let pageUrl = '';
    try {
      const candidate = new URL(raw.pageUrl || '', location.origin);
      if (site === 'xhs' && Core.siteFromUrl(candidate.href) === 'xhs' && Core.extractContentId(candidate.href, 'xhs') === String(raw.id || '')) {
        pageUrl = candidate.href;
      }
    } catch (_) {}
    const deferredProfileItem = site === 'xhs' && /^xhs:user:/.test(scope) && !!pageUrl;
    if (!videos.length && !images.length && !deferredProfileItem) return null;
    const audios = (raw.audios || []).filter(a => a && Core.isAllowedMediaUrl(a.url, site)).slice(0, 3);
    const xhsProfile = deferredProfileItem && scope.match(/^xhs:user:([^:]+)$/);
    const normalized = {
      id: String(raw.id || ''),
      tweetId: String(raw.tweetId || ''),
      ownerId: String(raw.ownerId || (xhsProfile && decodeURIComponent(xhsProfile[1])) || ''),
      mediaIndex: Number(raw.mediaIndex) || 0,
      title: safeText(raw.title, SITE_NAME[site] + '视频'),
      author: safeText(raw.author, ''),
      thumb: Core.isAllowedMediaUrl(raw.thumb, site) ? raw.thumb : (images[0] && images[0].url || ''),
      videos,
      images,
      audios,
      pageUrl,
      source: source || raw.source || 'feed'
    };
    const key = itemKey(normalized);
    if (!key) return null;
    const old = catalog.get(key);
    if (old) {
      normalized.title = old.title.length > normalized.title.length ? old.title : normalized.title;
      normalized.author = normalized.author || old.author;
      normalized.ownerId = normalized.ownerId || old.ownerId;
      normalized.thumb = normalized.thumb || old.thumb;
      const hasStructuredXhsVideo = site === 'xhs' && normalized.source === 'detail' &&
        normalized.videos.some(video => video.width || video.height || video.bitrate);
      const previousVideos = hasStructuredXhsVideo
        ? old.videos.filter(video => video.width || video.height || video.bitrate)
        : old.videos;
      // 详情状态异步到达后，用真实清晰度替换早期 resource timing 兜底，
      // 否则菜单会残留一个没有分辨率的“当前视频”。
      normalized.videos = Core.pickThreeQualities(previousVideos.concat(normalized.videos));
      const mergedImages = (old.images || []).concat(normalized.images);
      normalized.images = mergedImages.filter((image, index) => mergedImages.findIndex(candidate => candidate.url === image.url) === index).slice(0, 50);
      normalized.audios = normalized.audios.length ? normalized.audios : old.audios;
      normalized.pageUrl = normalized.pageUrl || old.pageUrl || '';
      normalized.source = old.source === 'detail' || normalized.source === 'detail' ? 'detail' : 'feed';
      normalized.scopes = old.scopes;
    } else {
      normalized.scopes = new Set();
    }
    normalized.scopes.add(scope);
    catalog.set(key, normalized);
    let order = scopeOrder.get(scope);
    if (!order) { order = []; scopeOrder.set(scope, order); }
    if (!order.includes(key)) {
      if (normalized.source === 'detail') order.unshift(key);
      else order.push(key);
    }
    while (catalog.size > 600) {
      const oldest = catalog.keys().next().value;
      catalog.delete(oldest);
      for (const ids of scopeOrder.values()) {
        const ix = ids.indexOf(oldest);
        if (ix >= 0) ids.splice(ix, 1);
      }
    }
    queuePublish();
    return normalized;
  }

  function rememberMany(items, scope, source) {
    for (const item of items || []) rememberItem(item, scope, source);
  }

  function publicItem(item, forceDetail) {
    return {
      id: item.id,
      tweetId: item.tweetId,
      ownerId: item.ownerId,
      mediaIndex: item.mediaIndex,
      title: item.title,
      author: item.author,
      thumb: item.thumb,
      videos: item.videos,
      images: item.images,
      audios: item.audios,
      pageUrl: item.pageUrl,
      source: forceDetail ? 'detail' : item.source
    };
  }

  function currentItems() {
    const detailId = detailIdFromScope(currentScope);
    if (detailId) {
      const exact = [...catalog.values()].filter(item => item.id === detailId || item.tweetId === detailId);
      if (exact.length) return exact.map(item => publicItem(item, true)).slice(0, 10);
    }
    const order = scopeOrder.get(currentScope) || [];
    let items = order.map(key => catalog.get(key)).filter(Boolean);
    const douyinProfile = currentScope.match(/^douyin:user:([^:]+)$/);
    if (douyinProfile && douyinProfile[1] !== 'self') {
      const profileId = decodeURIComponent(douyinProfile[1]);
      items = items.filter(item => item.ownerId === profileId);
    }
    const tiktokProfile = currentScope.match(/^tiktok:user:([^:]+)$/);
    if (tiktokProfile) {
      const profileId = decodeURIComponent(tiktokProfile[1]).replace(/^@/, '').toLowerCase();
      items = items.filter(item => String(item.ownerId || '').replace(/^@/, '').toLowerCase() === profileId);
    }
    const xhsProfile = currentScope.match(/^xhs:user:([^:]+)$/);
    if (xhsProfile) {
      const profileId = decodeURIComponent(xhsProfile[1]);
      items = items.filter(item => String(item.ownerId || '') === profileId);
    }
    return items.map(item => publicItem(item, false)).slice(0, 200);
  }

  function routeKind() {
    return currentScope.split(':')[1] || 'other';
  }

  function queuePublish() {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(publish, 80);
  }

  function publish() {
    const items = currentItems();
    stats.videos = items.length;
    const payload = {
      [TAG]: true,
      site,
      siteName: SITE_NAME[site],
      pageUrl: location.href,
      route: routeKind(),
      items,
      ver: Core.VERSION,
      stats: { api: stats.api, videos: stats.videos, cached: catalog.size, errors: stats.errors, lastUrls: stats.lastUrls.slice() }
    };
    try { window.postMessage(payload, location.origin); } catch (_) {}
  }

  function noteUrl(raw) {
    try {
      const url = new URL(raw, location.origin);
      const text = url.hostname + url.pathname.slice(0, 100);
      if (stats.lastUrls[stats.lastUrls.length - 1] !== text) stats.lastUrls.push(text);
      if (stats.lastUrls.length > 10) stats.lastUrls.shift();
    } catch (_) {}
  }

  /* ---------------- 抖音 ---------------- */
  function douyinQualities(video) {
    const out = [];
    function addAddress(addr, meta) {
      if (!addr) return;
      const width = Number(addr.width || (meta && meta.width) || video.width) || 0;
      const height = Number(addr.height || (meta && meta.height) || video.height) || 0;
      const bitrate = Number((meta && (meta.bit_rate || meta.bitRate)) || addr.data_size || 0);
      const codec = String((meta && (meta.gear_name || meta.gearName || meta.format)) || addr.format || '');
      for (const url of urlsFromAddress(addr).slice(0, 1)) out.push({ url, width, height, bitrate, codec });
    }
    addAddress(video.play_addr_h264 || video.playAddrH264, { format: 'h264' });
    addAddress(video.play_addr || video.playAddr, { format: 'h264' });
    for (const br of video.bit_rate || video.bitRate || []) {
      if (br && !br.is_h265 && !/h265|hevc/i.test(String(br.gear_name || br.format || ''))) {
        addAddress(br.play_addr || br.playAddr, Object.assign({ format: 'h264' }, br));
      }
    }
    for (const br of video.bit_rate || video.bitRate || []) addAddress(br && (br.play_addr || br.playAddr), br);
    if (!out.length) addAddress(video.download_addr || video.downloadAddr, { format: 'fallback' });
    return Core.pickThreeQualities(out);
  }

  function douyinImages(raw) {
    const post = raw.image_post_info || raw.imagePostInfo || {};
    const entries = []
      .concat(raw.images || [])
      .concat(raw.image_list || raw.imageList || [])
      .concat(post.images || post.image_list || post.imageList || []);
    return entries.map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null;
      const address = entry.display_image || entry.displayImage || entry.origin_image || entry.originImage ||
        entry.image_url || entry.imageUrl || entry.imageURL || entry.download_url_list || entry.downloadUrlList || entry;
      const url = firstAllowedUrl(address, entry.url_list, entry.urlList);
      if (!url) return null;
      return {
        url,
        width: Number(entry.width || entry.image_width || entry.imageWidth || address.width || address.imageWidth) || 0,
        height: Number(entry.height || entry.image_height || entry.imageHeight || address.height || address.imageHeight) || 0,
        label: '图片 ' + (index + 1)
      };
    }).filter(Boolean);
  }

  function douyinItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.aweme_id || raw.awemeId || raw.id || '');
    if (!/^\d{8,}$/.test(id)) return null;
    const images = douyinImages(raw);
    const videos = !images.length && raw.video ? douyinQualities(raw.video) : [];
    if (!videos.length && !images.length) return null;
    const cover = raw.video
      ? firstAllowedUrl(raw.video.cover, raw.video.origin_cover || raw.video.originCover, raw.video.dynamic_cover || raw.video.dynamicCover)
      : (images[0] && images[0].url || '');
    const music = raw.music || {};
    const audio = firstAllowedUrl(music.play_url || music.playUrl);
    return {
      id,
      title: raw.desc || raw.preview_title || (images.length ? '抖音图文' : '抖音视频'),
      author: raw.author && (raw.author.nickname || raw.author.unique_id || raw.author.uniqueId),
      ownerId: raw.author && String(raw.author.sec_uid || raw.author.secUid || raw.author.uid || ''),
      thumb: cover,
      videos,
      images,
      audios: audio ? [{ url: audio, label: '音频' }] : []
    };
  }

  function collectDouyin(root) {
    const out = [];
    const ids = new Set();
    const seen = new Set();
    let nodes = 0;
    (function walk(value, depth) {
      if (!value || typeof value !== 'object' || depth > 16 || nodes++ > 12000 || seen.has(value)) return;
      seen.add(value);
      if (!Array.isArray(value)) {
        const item = douyinItem(value);
        if (item && !ids.has(item.id)) { ids.add(item.id); out.push(item); }
      }
      if (Array.isArray(value)) {
        for (const child of value) walk(child, depth + 1);
      } else {
        for (const key of Object.keys(value)) {
          if (/^(?:log_pb|extra|status_code|status_msg)$/i.test(key)) continue;
          walk(value[key], depth + 1);
        }
      }
    })(root, 0);
    return out;
  }

  function trustedDouyinApi(raw) {
    try {
      const url = new URL(raw, location.origin);
      const trustedHost = ['douyin.com', 'iesdouyin.com', 'snssdk.com', 'amemv.com'].some(s => Core.hostMatches(url.hostname, s));
      return trustedHost && /aweme|feed|post|follow|friend|familiar|recommend|user|search|module|detail/i.test(url.pathname);
    } catch (_) { return false; }
  }

  /* ---------------- X ---------------- */
  function xVideoItems(tweet) {
    const legacy = tweet && (tweet.legacy || tweet);
    const tweetId = String((tweet && (tweet.rest_id || tweet.id_str)) || legacy.id_str || '');
    if (!/^\d+$/.test(tweetId)) return [];
    const entities = legacy.extended_entities || legacy.extendedEntities || {};
    const media = entities.media || [];
    const title = legacy.full_text || legacy.text || 'X 视频';
    const author = tweet.core && tweet.core.user_results && tweet.core.user_results.result;
    const authorName = author && author.legacy && (author.legacy.name || author.legacy.screen_name);
    const out = [];
    media.forEach((entry, index) => {
      const info = entry && (entry.video_info || entry.videoInfo);
      if (!info || !Array.isArray(info.variants)) return;
      const candidates = info.variants
        .filter(v => v && /video\/mp4/i.test(v.content_type || v.contentType || '') && v.url)
        .map(v => {
          const res = Core.resolutionFromUrl(v.url);
          return { url: v.url, width: res.width, height: res.height, bitrate: Number(v.bitrate) || 0, codec: 'h264' };
        });
      const videos = Core.pickThreeQualities(candidates);
      if (!videos.length) return;
      out.push({
        id: tweetId + ':' + String(entry.id_str || entry.media_key || index),
        tweetId,
        mediaIndex: index,
        title,
        author: authorName || '',
        thumb: entry.media_url_https || entry.mediaUrlHttps || '',
        videos,
        audios: []
      });
    });
    return out;
  }

  function collectX(root) {
    const out = [];
    const keys = new Set();
    const seen = new Set();
    let nodes = 0;
    (function walk(value, depth) {
      if (!value || typeof value !== 'object' || depth > 18 || nodes++ > 16000 || seen.has(value)) return;
      seen.add(value);
      if (!Array.isArray(value) && (value.rest_id || value.id_str) && (value.legacy || value.extended_entities)) {
        for (const item of xVideoItems(value)) {
          if (!keys.has(item.id)) { keys.add(item.id); out.push(item); }
        }
      }
      if (Array.isArray(value)) for (const child of value) walk(child, depth + 1);
      else for (const key of Object.keys(value)) walk(value[key], depth + 1);
    })(root, 0);
    return out;
  }

  function trustedXApi(raw) {
    try {
      const url = new URL(raw, location.origin);
      return ['x.com', 'twitter.com', 'api.x.com'].some(s => Core.hostMatches(url.hostname, s)) &&
        /graphql|Tweet|Timeline|UserTweets|SearchTimeline/i.test(url.pathname);
    } catch (_) { return false; }
  }

  /* ---------------- TikTok ---------------- */
  function tiktokQualities(video) {
    const out = [];
    function addAddress(addr, meta) {
      if (!addr) return;
      const width = Number(addr.Width || addr.width || (meta && (meta.Width || meta.width)) || video.width) || 0;
      const height = Number(addr.Height || addr.height || (meta && (meta.Height || meta.height)) || video.height) || 0;
      const bitrate = Number((meta && (meta.Bitrate || meta.bitrate || meta.bit_rate || meta.bitRate)) || addr.DataSize || addr.data_size || 0);
      const codec = String((meta && (meta.CodecType || meta.codecType || meta.codec_type || meta.GearName || meta.gearName || meta.gear_name || meta.Format || meta.format)) || addr.Format || addr.format || '');
      for (const url of urlsFromAddress(addr).slice(0, 1)) out.push({ url, width, height, bitrate, codec });
    }
    const bitrateInfo = video.bitrateInfo || video.bit_rate || video.bitRate || [];
    for (const info of bitrateInfo) {
      if (!info) continue;
      const codec = String(info.CodecType || info.codecType || info.codec_type || info.GearName || info.gearName || info.gear_name || '');
      if (!info.is_h265 && !/h265|hevc/i.test(codec)) {
        addAddress(info.PlayAddr || info.play_addr || info.playAddr, Object.assign({ codecType: 'h264' }, info));
      }
    }
    for (const info of bitrateInfo) addAddress(info && (info.PlayAddr || info.play_addr || info.playAddr), info);
    addAddress(video.PlayAddrStruct || video.playAddrStruct || video.play_addr || video.playAddr, { codecType: video.codecType || video.codec_type || video.encodedType || 'h264' });
    if (!out.length) addAddress(video.downloadAddr || video.download_addr, { codecType: 'fallback' });
    return Core.pickThreeQualities(out);
  }

  function tiktokImages(raw) {
    const post = raw.imagePost || raw.image_post_info || raw.imagePostInfo || {};
    const entries = post.images || post.image_list || post.imageList || raw.images || [];
    return (Array.isArray(entries) ? entries : []).map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null;
      const address = entry.imageURL || entry.imageUrl || entry.image_url || entry.displayImage || entry.display_image ||
        entry.ownerWatermarkImage || entry.owner_watermark_image || entry;
      const url = firstAllowedUrl(address, entry.urlList, entry.url_list);
      if (!url) return null;
      return {
        url,
        width: Number(entry.imageWidth || entry.image_width || entry.width || address.imageWidth || address.width) || 0,
        height: Number(entry.imageHeight || entry.image_height || entry.height || address.imageHeight || address.height) || 0,
        label: '图片 ' + (index + 1)
      };
    }).filter(Boolean);
  }

  function tiktokItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.aweme_id || raw.awemeId || '');
    if (!/^\d{8,}$/.test(id)) return null;
    const images = tiktokImages(raw);
    const videos = !images.length && raw.video ? tiktokQualities(raw.video) : [];
    if (!videos.length && !images.length) return null;
    const author = raw.author || {};
    const ownerId = typeof author === 'string'
      ? author
      : String(author.uniqueId || author.unique_id || author.secUid || author.sec_uid || author.id || '');
    const authorName = typeof author === 'string'
      ? author
      : (author.nickname || author.uniqueId || author.unique_id || '');
    const imagePost = raw.imagePost || raw.image_post_info || raw.imagePostInfo || {};
    const cover = raw.video
      ? firstAllowedUrl(raw.video.cover, raw.video.originCover || raw.video.origin_cover, raw.video.dynamicCover || raw.video.dynamic_cover)
      : firstAllowedUrl(imagePost.cover && (imagePost.cover.imageURL || imagePost.cover.image_url || imagePost.cover), images[0] && images[0].url);
    const music = raw.music || {};
    const audio = firstAllowedUrl(music.playUrl || music.play_url || music.playAddr || music.play_addr);
    return {
      id,
      title: imagePost.title || raw.desc || raw.title || (images.length ? 'TikTok 图文' : 'TikTok 视频'),
      author: authorName,
      ownerId,
      thumb: cover,
      videos,
      images,
      audios: audio ? [{ url: audio, label: '音频' }] : []
    };
  }

  function collectTikTok(root) {
    const out = [];
    const ids = new Set();
    const seen = new Set();
    let nodes = 0;
    (function walk(value, depth) {
      if (!value || typeof value !== 'object' || depth > 16 || nodes++ > 14000 || seen.has(value)) return;
      seen.add(value);
      if (!Array.isArray(value)) {
        const item = tiktokItem(value);
        if (item && !ids.has(item.id)) { ids.add(item.id); out.push(item); }
      }
      if (Array.isArray(value)) {
        for (const child of value) walk(child, depth + 1);
      } else {
        for (const key of Object.keys(value)) {
          if (/^(?:extra|statusCode|status_code|statusMsg|status_msg)$/i.test(key)) continue;
          walk(value[key], depth + 1);
        }
      }
    })(root, 0);
    return out;
  }

  function trustedTikTokApi(raw) {
    try {
      const url = new URL(raw, location.origin);
      const trustedHost = ['tiktok.com', 'tiktokv.com'].some(s => Core.hostMatches(url.hostname, s));
      return trustedHost && /aweme|item|post|feed|following|friend|foryou|recommend|search|detail/i.test(url.pathname);
    } catch (_) { return false; }
  }

  /* ---------------- 小红书 ---------------- */

  function xhsImageUrl(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const infoList = Array.isArray(entry.infoList || entry.info_list) ? (entry.infoList || entry.info_list).slice() : [];
    infoList.sort((a, b) => {
      const score = info => /DFT|DEFAULT|ORIGIN/i.test(String(info && (info.imageScene || info.image_scene) || '')) ? 1 : 0;
      return score(b) - score(a);
    });
    return firstAllowedUrl(
      entry.urlDefault, entry.url_default, entry.url, entry.urlPre, entry.url_pre,
      entry.urlList, entry.url_list,
      ...infoList.map(info => info && (info.url || info.urlDefault || info.url_default))
    );
  }

  function xhsImages(raw) {
    const entries = raw && (raw.imageList || raw.image_list || raw.images) || [];
    return (Array.isArray(entries) ? entries : []).map((entry, index) => {
      const url = xhsImageUrl(entry);
      if (!url) return null;
      const info = Array.isArray(entry.infoList || entry.info_list) ? (entry.infoList || entry.info_list)[0] || {} : {};
      return {
        url,
        width: Number(entry.width || entry.imageWidth || entry.image_width || info.width) || 0,
        height: Number(entry.height || entry.imageHeight || entry.image_height || info.height) || 0,
        label: '图片 ' + (index + 1)
      };
    }).filter(Boolean);
  }

  function xhsQualities(video) {
    if (!video || typeof video !== 'object') return [];
    const out = [];
    function add(entry, codec) {
      if (!entry || typeof entry !== 'object') return;
      const url = firstAllowedUrl(
        entry.masterUrl, entry.master_url, entry.url, entry.playUrl, entry.play_url,
        entry.backupUrls, entry.backup_urls, entry.urlList, entry.url_list
      );
      if (!url) return;
      out.push({
        url,
        width: Number(entry.width || entry.videoWidth || entry.video_width) || 0,
        height: Number(entry.height || entry.videoHeight || entry.video_height) || 0,
        bitrate: Number(entry.videoBitrate || entry.video_bitrate || entry.bitrate || entry.bit_rate) || 0,
        codec: String(entry.codec || entry.codecType || entry.codec_type || entry.format || codec || '')
      });
    }
    const mediaSources = [video.media, video];
    // 当前小红书会把详情视频流放在 mediaV2 JSON 字符串中，
    // 而不是旧的 video.media.stream。两种结构都要解析。
    const mediaV2 = video.mediaV2 || video.media_v2;
    if (mediaV2) {
      try {
        mediaSources.unshift(typeof mediaV2 === 'string' ? JSON.parse(mediaV2) : mediaV2);
      } catch (_) {}
    }
    for (const source of mediaSources) {
      if (!source || typeof source !== 'object') continue;
      const stream = source.stream || (source.media && source.media.stream) || {};
      for (const [codec, entries] of Object.entries(stream)) {
        if (Array.isArray(entries)) entries.forEach(entry => add(entry, codec));
      }
    }
    add(video, video.codec || '');
    return Core.pickThreeQualities(out);
  }

  function xhsItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const wrapper = raw;
    const nested = raw.noteCard || raw.note_card;
    if (nested && typeof nested === 'object') {
      raw = Object.assign({}, nested, {
        // homefeed/user_posted 的真实结构是 { id, noteCard: {...} }；
        // noteCard 本身通常没有 noteId。之前丢了外层 id，所以零作品。
        noteId: nested.noteId || nested.note_id || wrapper.noteId || wrapper.note_id || wrapper.id || '',
        xsecToken: nested.xsecToken || nested.xsec_token || wrapper.xsecToken || wrapper.xsec_token || '',
        trackId: nested.trackId || nested.track_id || wrapper.trackId || wrapper.track_id || ''
      });
    }
    const id = String(raw.noteId || raw.note_id || raw.id || '');
    if (!/^[\w-]{8,100}$/.test(id)) return null;
    const videos = xhsQualities(raw.video);
    const type = String(raw.type || raw.noteType || raw.note_type || '').toLowerCase();
    const isVideo = /video/.test(type) || (videos.length > 0 && !/(?:normal|image)/.test(type));
    const imageCandidates = xhsImages(raw);
    const images = isVideo ? [] : imageCandidates;
    const user = raw.user || raw.author || {};
    const cover = firstAllowedUrl(
      raw.cover, raw.coverUrl, raw.cover_url,
      raw.video && (raw.video.cover || raw.video.coverUrl || raw.video.cover_url),
      xhsImageUrl(raw.cover),
      imageCandidates[0] && imageCandidates[0].url
    );
    const xsecToken = String(raw.xsecToken || raw.xsec_token || '');
    const pageUrl = new URL('/explore/' + encodeURIComponent(id), location.origin);
    if (xsecToken) {
      pageUrl.searchParams.set('xsec_token', xsecToken);
      pageUrl.searchParams.set('xsec_source', 'pc_user');
    }
    return {
      id,
      title: raw.title || raw.displayTitle || raw.display_title || raw.desc || (isVideo ? '小红书视频' : '小红书图文'),
      author: user.nickname || user.nickName || user.nick_name || user.name || '',
      ownerId: String(user.userId || user.user_id || user.id || raw.userId || raw.user_id || ''),
      thumb: cover,
      videos,
      images,
      audios: [],
      pageUrl: pageUrl.href
    };
  }

  function collectXhs(root) {
    const out = [];
    const byId = new Map();
    const seen = new Set();
    let nodes = 0;
    (function walk(value, depth) {
      if (!value || typeof value !== 'object' || depth > 18 || nodes++ > 16000 || seen.has(value)) return;
      seen.add(value);
      if (!Array.isArray(value)) {
        const item = xhsItem(value);
        if (item) {
          const old = byId.get(item.id);
          if (!old) {
            byId.set(item.id, item);
            out.push(item);
          } else {
            old.title = String(old.title || '').length >= String(item.title || '').length ? old.title : item.title;
            old.author = old.author || item.author;
            old.ownerId = old.ownerId || item.ownerId;
            old.thumb = old.thumb || item.thumb;
            old.videos = Core.pickThreeQualities((old.videos || []).concat(item.videos || []));
            const mergedImages = (old.images || []).concat(item.images || []);
            old.images = mergedImages.filter((image, index) => mergedImages.findIndex(candidate => candidate.url === image.url) === index).slice(0, 50);
            if (!old.pageUrl.includes('xsec_token=') && item.pageUrl.includes('xsec_token=')) old.pageUrl = item.pageUrl;
          }
        }
      }
      if (Array.isArray(value)) {
        for (const child of value) walk(child, depth + 1);
      } else {
        let keys = [];
        try { keys = Object.keys(value); } catch (_) { return; }
        for (const key of keys) {
          if (/^(?:interactInfo|interact_info|shareInfo|share_info|tagList|tag_list)$/i.test(key)) continue;
          try { walk(value[key], depth + 1); } catch (_) {}
        }
      }
    })(root, 0);
    return out;
  }

  function trustedXhsApi(raw) {
    try {
      const url = new URL(raw, location.origin);
      if (!Core.hostMatches(url.hostname, 'xiaohongshu.com')) return false;
      return /\/api\/sns\/web\//i.test(url.pathname) &&
        /(?:feed|note|posted|user|search|follow|recommend|explore)/i.test(url.pathname);
    } catch (_) { return false; }
  }

  function trustedDataApi(raw) {
    if (site === 'douyin') return trustedDouyinApi(raw);
    if (site === 'x') return trustedXApi(raw);
    if (site === 'tiktok') return trustedTikTokApi(raw);
    if (site === 'xhs') return trustedXhsApi(raw);
    return false;
  }

  function scanXhsStateData() {
    if (site !== 'xhs') return;
    try {
      const source = detailIdFromScope(currentScope) ? 'detail' : 'feed';
      const roots = [];
      const seen = new Set();
      const add = value => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        roots.push(value);
      };
      for (const state of [window.__INITIAL_STATE__, window.__INITIAL_SSR_STATE__]) {
        if (!state || typeof state !== 'object') continue;
        const before = roots.length;
        const detailId = detailIdFromScope(currentScope);
        if (detailId) {
          try {
            // 真实页面的 state 非常大，从根节点深度遍历会在到达 note 前命中节点上限。
            // 详情页直接按路由 ID 取 noteDetailMap，也不会误拿推荐列表的作品。
            add(state.note && state.note.noteDetailMap && state.note.noteDetailMap[detailId]);
          } catch (_) {}
        }
        // 各 store 分开解析，每个 store 独立使用节点上限，避免大型 global/feed 挤掉 note/user。
        for (const key of ['note', 'feed', 'user', 'search']) {
          try { add(state[key]); } catch (_) {}
        }
        // 保留对旧版/服务端直出数据的兼容，但真实大型状态有分 store 时不再重复扫根节点。
        if (roots.length === before) add(state);
      }
      for (const root of roots) rememberMany(collectXhs(root), currentScope, source);
    } catch (_) { stats.errors++; }
  }

  // 小红书现在大量使用 CSR。接口可能在扩展挂钩前就已完成，详情页的
  // <video> 又只暴露 blob: 地址；Vue 组件状态反而是页面当前作品最稳定的数据源。
  function scanXhsVueData() {
    if (site !== 'xhs' || !document.documentElement) return;
    try {
      const detailId = detailIdFromScope(currentScope);
      const selector = detailId
        ? '#noteContainer,.note-detail-mask,[data-note-id]'
        : '.note-item[data-note-id],[data-note-id],#exploreFeeds,#userPostedFeeds';
      const elements = Array.from(document.querySelectorAll(selector)).slice(0, detailId ? 40 : 140);
      const components = new Set();
      const roots = [];
      const rootSet = new Set();
      const addRoot = value => {
        if (!value || (typeof value !== 'object' && typeof value !== 'function') || rootSet.has(value)) return;
        rootSet.add(value);
        roots.push(value);
      };
      const addComponentChain = start => {
        let component = start;
        for (let depth = 0; component && depth < 14 && components.size < 240; depth++) {
          if (components.has(component)) break;
          components.add(component);
          try {
            addRoot(component.props || component.$props);
            addRoot(component.setupState);
            addRoot(component.data || component.$data);
            // ctx 里常放当前笔记的 computed/ref；只遍历受限组件链，不进入 appContext。
            addRoot(component.ctx);
          } catch (_) {}
          component = component.parent || component.$parent || null;
        }
      };
      for (const element of elements) {
        try {
          addComponentChain(element.__vueParentComponent);
          addComponentChain(element.__vnode && element.__vnode.component);
          addComponentChain(element.__vue__);
        } catch (_) {}
      }
      if (!roots.length) return;
      let found = collectXhs(roots);
      if (detailId) found = found.filter(item => item.id === detailId);
      if (!found.length) return;
      const source = detailId ? 'detail' : 'feed';
      rememberMany(found, currentScope, source);
    } catch (_) { stats.errors++; }
  }

  function scanXhsDetailImages() {
    if (site !== 'xhs' || !document.documentElement) return;
    const detailId = detailIdFromScope(currentScope);
    if (!detailId) return;
    try {
      // 视频笔记的封面不能冒充图文原图。
      if (document.querySelector && document.querySelector('#noteContainer video,.note-detail-mask video')) return;
      const seen = new Set();
      const images = [];
      const nodes = document.querySelectorAll('#noteContainer img,.note-detail-mask img');
      for (const image of nodes) {
        const url = image.currentSrc || image.src || '';
        const width = Number(image.naturalWidth || image.width) || 0;
        const height = Number(image.naturalHeight || image.height) || 0;
        if (!Core.isAllowedMediaUrl(url, 'xhs') || seen.has(url)) continue;
        if (Math.max(width, height) < 500 || Math.min(width, height) < 240) continue;
        const hint = String((image.className || '') + ' ' + (image.alt || '')).toLowerCase();
        if (/avatar|icon|logo|emoji|qrcode|qr-code/.test(hint)) continue;
        seen.add(url);
        images.push({ url, width, height, label: '图片 ' + (images.length + 1) });
      }
      if (images.length) {
        rememberItem({
          id: detailId,
          title: document.title || '小红书图文',
          thumb: images[0].url,
          images,
          videos: [],
          audios: [],
          pageUrl: location.href
        }, currentScope, 'detail');
      }
    } catch (_) { stats.errors++; }
  }

  function scanXhsPerformanceMedia() {
    if (site !== 'xhs' || typeof performance === 'undefined' || !performance.getEntriesByType) return;
    const detailId = detailIdFromScope(currentScope);
    if (!detailId) return;
    try {
      // 状态数据已给出分辨率/码率时，不再混入无画质信息的播放线路。
      const structured = catalog.get(site + ':id:' + detailId);
      if (structured && (structured.videos || []).some(video => video.width || video.height || video.bitrate)) return;
      const entries = performance.getEntriesByType('resource').slice(-500);
      const candidates = [];
      for (const entry of entries) {
        if (Number(entry.startTime) + 1500 < scopeStartedAt) continue;
        const url = String(entry.name || '');
        if (!Core.isAllowedMediaUrl(url, 'xhs')) continue;
        let parsed;
        try { parsed = new URL(url); } catch (_) { continue; }
        if (!/video/i.test(parsed.hostname) && !/(?:video|stream|\.mp4(?:$|[?!]))/i.test(parsed.pathname + parsed.search)) continue;
        const resolution = Core.resolutionFromUrl(url);
        candidates.push({ url, width: resolution.width, height: resolution.height, bitrate: 0, label: '当前视频' });
      }
      if (!candidates.length) return;
      const resolved = candidates.filter(video => video.width || video.height);
      // 无法从 URL 判断分辨率时只保留最新线路，不伪造三档画质。
      const videos = resolved.length ? resolved : [candidates[candidates.length - 1]];
      rememberItem({
        id: detailId,
        title: document.title || '小红书视频',
        videos,
        images: [],
        audios: [],
        pageUrl: location.href
      }, currentScope, 'detail');
    } catch (_) { stats.errors++; }
  }

  function scanXhsPageData() {
    scanXhsStateData();
    scanXhsVueData();
    scanXhsDetailImages();
    scanXhsPerformanceMedia();
  }

  /* ---------------- 其他原有站点 ---------------- */

  function extractYouTube() {
    try {
      const pr = window.ytInitialPlayerResponse;
      if (!pr || !pr.streamingData) return;
      const vd = pr.videoDetails || {};
      const formats = (pr.streamingData.formats || []).filter(f => f.url).map(f => ({ url: f.url, width: f.width, height: f.height, bitrate: f.bitrate }));
      const audios = (pr.streamingData.adaptiveFormats || []).filter(f => f.url && /^audio\//.test(f.mimeType || '')).slice(0, 3).map(f => ({ url: f.url, label: '音频 ' + Math.round((f.bitrate || 0) / 1000) + 'kbps' }));
      const thumbs = vd.thumbnail && vd.thumbnail.thumbnails || [];
      rememberItem({ id: vd.videoId || '', title: vd.title || document.title, thumb: thumbs.length ? thumbs[thumbs.length - 1].url : '', videos: formats, audios }, currentScope, 'detail');
    } catch (_) { stats.errors++; }
  }

  function handleJson(json, requestUrl, scope) {
    try {
      let found = [];
      if (site === 'douyin') {
        if (!trustedDouyinApi(requestUrl)) return;
        found = collectDouyin(json);
      } else if (site === 'x') {
        if (!trustedXApi(requestUrl)) return;
        found = collectX(json);
      } else if (site === 'tiktok') {
        if (!trustedTikTokApi(requestUrl)) return;
        found = collectTikTok(json);
      }
      else if (site === 'xhs') {
        if (!trustedXhsApi(requestUrl)) return;
        found = collectXhs(json);
        // 博主主页列表常只给缩略图/预览流；批量时保留笔记链接再逐条解析，不把预览媒体冒充原文件。
        if (/(?:user_posted|user\/notes|note_list)/i.test(requestUrl)) {
          found = found.map(item => Object.assign({}, item, { videos: [], images: [] }));
        }
      }
      if (scope !== currentScope) {
        const currentDetailId = detailIdFromScope(currentScope);
        const profilePosts = (
          site === 'douyin' && /^douyin:user:/.test(currentScope) && /(?:aweme\/post|user\/post)/i.test(requestUrl)
        ) || (
          site === 'tiktok' && /^tiktok:user:/.test(currentScope) && /(?:api\/post|item_list|user\/post)/i.test(requestUrl)
        ) || (
          site === 'xhs' && /^xhs:user:/.test(currentScope) && /(?:user_posted|user\/notes|note_list)/i.test(requestUrl)
        );
        if (currentDetailId) {
          found = found.filter(item => item.id === currentDetailId || item.tweetId === currentDetailId || String(item.id).startsWith(currentDetailId + ':'));
        } else if (!profilePosts) {
          return;
        }
        if (!found.length) return;
        scope = currentScope;
      }
      if (!found.length) return;
      stats.api++;
      noteUrl(requestUrl);
      const detailId = detailIdFromScope(scope);
      for (const item of found) {
        const isDetail = !!detailId && (item.id === detailId || item.tweetId === detailId || String(item.id).startsWith(detailId + ':'));
        rememberItem(item, scope, isDetail ? 'detail' : 'feed');
      }
    } catch (_) { stats.errors++; }
  }

  /* 必须在 document_start 同步执行，先于站点首屏请求。 */
  function hookNetwork() {
    if (window.__mimi_v2_hooked) return;
    window.__mimi_v2_hooked = true;
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function (...args) {
        let requestUrl = '';
        try {
          const first = args[0];
          requestUrl = first instanceof URL ? first.href : typeof first === 'string' ? first : (first && first.url) || '';
        } catch (_) {}
        const requestScope = currentScope;
        const result = originalFetch.apply(this, args);
        result.then(response => {
          try {
            const type = response.headers.get('content-type') || '';
            // 小红书部分 JSON 接口会返回 text/plain 或不带 Content-Type。
            // 只对已白名单的站点数据接口尝试 JSON，不读取其他响应。
            if (!/json/i.test(type) && !trustedDataApi(requestUrl)) return;
            response.clone().json().then(json => handleJson(json, requestUrl, requestScope)).catch(() => {});
          } catch (_) {}
        }).catch(() => {});
        return result;
      };
    }
    try {
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__mimi_v2_url = String(url || '');
        this.__mimi_v2_scope = currentScope;
        return originalOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        this.addEventListener('load', function () {
          try {
            const type = this.getResponseHeader('Content-Type') || '';
            if (!/json/i.test(type) && !trustedDataApi(this.__mimi_v2_url)) return;
            let json = null;
            if (this.responseType === 'json') json = this.response;
            else if (!this.responseType || this.responseType === 'text') json = JSON.parse(this.responseText);
            if (json) handleJson(json, this.__mimi_v2_url, this.__mimi_v2_scope);
          } catch (_) {}
        });
        return originalSend.apply(this, arguments);
      };
    } catch (_) { stats.errors++; }
  }

  function extractIdFromElement(element) {
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
      const link = node.querySelector && node.querySelector(site === 'xhs'
        ? 'a[href*="/explore/"],a[href*="/discovery/item/"]'
        : 'a[href*="/video/"],a[href*="/photo/"],a[href*="/note/"]');
      const match = link && (site === 'xhs'
        ? (link.getAttribute('href') || '').match(/\/(?:explore|discovery\/item)\/([\w-]+)/)
        : (link.getAttribute('href') || '').match(/\/(?:video|photo|note)\/(\d+)/));
      if (match) return match[1];
    }
    return '';
  }

  function scanDomVideos() {
    if (!document.documentElement || !['douyin', 'tiktok', 'xhs'].includes(site)) return;
    try {
      document.querySelectorAll('video').forEach(video => {
        const src = video.currentSrc || video.src || '';
        const id = ['douyin', 'tiktok', 'xhs'].includes(site) ? (extractIdFromElement(video) || detailIdFromScope(currentScope)) : '';
        if (id) {
          const old = [...catalog.values()].find(item => item.id === id);
          if (old) rememberItem(old, currentScope, !video.paused ? 'detail' : old.source);
        }
        if (!/^https:\/\//i.test(src) || !Core.isAllowedMediaUrl(src, site)) return;
        // 短视频信息流里无 ID 的预创建 video 不属于当前作品，纳入缓存会造成批量重复或下错视频。
        if (['douyin', 'tiktok', 'xhs'].includes(site) && !id) return;
        rememberItem({
          id: id || 'dom-' + simpleHash(src),
          title: document.title,
          thumb: Core.isAllowedMediaUrl(video.poster, site) ? video.poster : '',
          videos: [{ url: src, label: !video.paused ? '当前播放' : '页面视频' }],
          audios: []
        }, currentScope, !video.paused ? 'detail' : 'feed');
      });
    } catch (_) { stats.errors++; }
  }

  function simpleHash(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
  }

  function jsonFromScript(id) {
    const script = document.getElementById(id);
    if (!script || !script.textContent) return null;
    try {
      let text = script.textContent.trim();
      if (text.startsWith('%7B')) text = decodeURIComponent(text);
      return JSON.parse(text);
    } catch (_) { return null; }
  }

  function scanInitialData() {
    try {
      if (site === 'douyin') {
        const source = detailIdFromScope(currentScope) ? 'detail' : 'feed';
        rememberMany(collectDouyin(window._ROUTER_DATA), currentScope, source);
        rememberMany(collectDouyin(window.__INITIAL_STATE__), currentScope, source);
        for (const id of ['RENDER_DATA', '__NEXT_DATA__']) rememberMany(collectDouyin(jsonFromScript(id)), currentScope, source);
        scanDomVideos();
      } else if (site === 'x') publish();
      else if (site === 'tiktok') {
        const source = detailIdFromScope(currentScope) ? 'detail' : 'feed';
        rememberMany(collectTikTok(window.__UNIVERSAL_DATA_FOR_REHYDRATION__), currentScope, source);
        rememberMany(collectTikTok(window.SIGI_STATE), currentScope, source);
        for (const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE', '__NEXT_DATA__']) {
          rememberMany(collectTikTok(jsonFromScript(id)), currentScope, source);
        }
        scanDomVideos();
      } else if (site === 'xhs') {
        scanXhsPageData();
        scanDomVideos();
      } else if (site === 'youtube') extractYouTube();
      queuePublish();
    } catch (_) { stats.errors++; }
  }

  function rescanCurrentPage() {
    if (site === 'douyin' || site === 'tiktok' || site === 'xhs') {
      if (site === 'tiktok' && currentScope === bootScope && !currentItems().length) scanInitialData();
      if (site === 'xhs' && currentScope === bootScope && !currentItems().length) scanInitialData();
      if (site === 'xhs') scanXhsPageData();
      scanDomVideos();
      queuePublish();
      return;
    }
    scanInitialData();
  }

  function onNavigation() {
    const now = location.href;
    if (now === lastUrl) return;
    lastUrl = now;
    const nextScope = scopeForPage(now);
    if (nextScope !== currentScope) {
      currentScope = nextScope;
      scopeStartedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    }
    publish();
    setTimeout(rescanCurrentPage, 150);
    setTimeout(rescanCurrentPage, 800);
  }

  hookNetwork();

  try {
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    history.pushState = function () { const value = originalPush.apply(this, arguments); onNavigation(); return value; };
    history.replaceState = function () { const value = originalReplace.apply(this, arguments); onNavigation(); return value; };
    addEventListener('popstate', onNavigation);
  } catch (_) { stats.errors++; }

  addEventListener('message', event => {
    if (event.source !== window || !event.data) return;
    if (event.data[RESCAN]) {
      currentScope = scopeForPage(location.href);
      rescanCurrentPage();
      publish();
    }
  });

  document.addEventListener('playing', event => {
    if (event.target && event.target.tagName === 'VIDEO') scanDomVideos();
  }, true);

  const scanBootData = () => { if (currentScope === bootScope) scanInitialData(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanBootData, { once: true });
  else scanBootData();
  setTimeout(scanBootData, 800);
  setTimeout(scanBootData, 2500);
  setInterval(() => {
    onNavigation();
    if ((site === 'douyin' && /^(?:douyin:(?:home|recommend|follow|friend|jingxuan|user))/.test(currentScope)) ||
        (site === 'tiktok' && /^(?:tiktok:(?:home|following|friends|explore|user|video))/.test(currentScope)) ||
        (site === 'xhs' && /^(?:xhs:(?:home|search|user|detail))/.test(currentScope))) {
      if (site === 'xhs') scanXhsPageData();
      scanDomVideos();
    }
  }, 2000);
})();
