(function (root, factory) {
  const api = Object.freeze(factory());
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MimiCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  const VERSION = '0.5.5';
  const PAGE_HOSTS = {
    douyin: ['douyin.com'],
    x: ['x.com', 'twitter.com'],
    tiktok: ['tiktok.com'],
    xhs: ['xiaohongshu.com'],
    youtube: ['youtube.com', 'youtu.be']
  };
  const MEDIA_HOSTS = {
    douyin: [
      'douyinvod.com', 'douyinpic.com', 'douyincdn.com', 'douyinstatic.com',
      'byteimg.com', 'bytecdn.cn', 'bytedance.com', 'snssdk.com',
      'iesdouyin.com', 'amemv.com'
    ],
    x: ['video.twimg.com', 'pbs.twimg.com'],
    tiktok: [
      'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokcdn-in.com',
      'tiktokv.com', 'muscdn.com', 'byteoversea.com', 'bytefcdn-oversea.com',
      'ibyteimg.com', 'ibytedtos.com'
    ],
    xhs: ['xhscdn.com', 'xhscdn.net'],
    youtube: ['googlevideo.com', 'ytimg.com', 'youtube.com']
  };

  function hostMatches(host, suffix) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    suffix = String(suffix || '').toLowerCase();
    return host === suffix || host.endsWith('.' + suffix);
  }

  function siteFromHost(host) {
    for (const [site, hosts] of Object.entries(PAGE_HOSTS)) {
      if (hosts.some(suffix => hostMatches(host, suffix))) return site;
    }
    return null;
  }

  function siteFromUrl(raw) {
    try { return siteFromHost(new URL(raw).hostname); }
    catch (_) { return null; }
  }

  function isDouyinProfileUrl(raw) {
    try {
      const url = new URL(raw);
      return siteFromHost(url.hostname) === 'douyin' &&
        !url.searchParams.get('modal_id') &&
        /^\/user\/[^/?#]+\/?$/.test(url.pathname);
    } catch (_) { return false; }
  }

  function isTikTokProfileUrl(raw) {
    try {
      const url = new URL(raw);
      return siteFromHost(url.hostname) === 'tiktok' && /^\/@[^/?#]+\/?$/.test(url.pathname);
    } catch (_) { return false; }
  }

  function isXhsProfileUrl(raw) {
    try {
      const url = new URL(raw);
      return siteFromHost(url.hostname) === 'xhs' && /^\/user\/profile\/[^/?#]+\/?$/.test(url.pathname);
    } catch (_) { return false; }
  }

  function isAllowedMediaUrl(raw, site) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:') return false;
      if (site === 'tiktok' && hostMatches(url.hostname, 'tiktok.com')) {
        const firstLabel = url.hostname.toLowerCase().split('.')[0];
        if (/^v\d+(?:-|$)/.test(firstLabel)) return true;
        return url.hostname.toLowerCase() === 'www.tiktok.com' && /^\/aweme\/v1\/play\/?$/.test(url.pathname);
      }
      return (MEDIA_HOSTS[site] || []).some(suffix => hostMatches(url.hostname, suffix));
    } catch (_) { return false; }
  }

  function sanitizeFilename(name) {
    return (name || 'video')
      .replace(/[\\/:*?"<>|#\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 80) || 'video';
  }

  function mediaExtension(raw, kind) {
    const fallback = kind === 'audio' ? '.mp3' : kind === 'image' ? '.jpg' : '.mp4';
    const allowed = kind === 'audio' ? /\.(mp3|m4a)$/i : kind === 'image' ? /\.(jpg|jpeg|png|webp|avif)$/i : /\.mp4$/i;
    try {
      const pathname = new URL(String(raw || '')).pathname;
      const match = pathname.match(allowed);
      if (match) return match[0].toLowerCase();
      if (kind === 'image') {
        const format = pathname.match(/(?:^|[!_])(jpg|jpeg|png|webp|avif)(?:[!_]|$)/i);
        if (format) return '.' + format[1].toLowerCase();
      }
      return fallback;
    } catch (_) { return fallback; }
  }

  function cleanMediaUrl(raw) {
    if (!raw) return '';
    return String(raw).replace('/playwm/', '/play/');
  }

  function resolutionFromUrl(raw) {
    const m = String(raw || '').match(/(?:^|\/)(\d{2,5})x(\d{2,5})(?:\/|$)/);
    return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 0, height: 0 };
  }

  function pickThreeQualities(input) {
    const byKey = new Map();
    for (const raw of Array.isArray(input) ? input : []) {
      if (!raw || !/^https:\/\//i.test(String(raw.url || ''))) continue;
      const parsed = resolutionFromUrl(raw.url);
      const q = {
        url: cleanMediaUrl(raw.url),
        width: Number(raw.width) || parsed.width || 0,
        height: Number(raw.height) || parsed.height || 0,
        bitrate: Number(raw.bitrate || raw.bitRate) || 0,
        codec: String(raw.codec || ''),
        label: String(raw.label || '')
      };
      const key = q.width && q.height
        ? q.width + 'x' + q.height
        : q.bitrate ? 'b:' + Math.round(q.bitrate / 1000) : 'u:' + q.url;
      const old = byKey.get(key);
      if (!old || (/h264|avc/i.test(q.codec) && !/h264|avc/i.test(old.codec)) || q.bitrate > old.bitrate) {
        byKey.set(key, q);
      }
    }
    const sorted = [...byKey.values()].sort((a, b) => {
      const ap = a.width * a.height;
      const bp = b.width * b.height;
      return bp - ap || b.bitrate - a.bitrate;
    });
    let chosen = sorted;
    if (sorted.length > 3) chosen = [sorted[0], sorted[Math.floor((sorted.length - 1) / 2)], sorted[sorted.length - 1]];
    const tiers = chosen.length === 1 ? ['原画'] : chosen.length === 2 ? ['高清', '流畅'] : ['高清', '标清', '流畅'];
    return chosen.map((q, i) => {
      // “p” 表示画面的短边像素：竖屏 1080×1920 也应显示为 1080p，而不是 1920p。
      const edge = q.width && q.height ? Math.min(q.width, q.height) : (q.height || q.width);
      const detail = edge ? edge + 'p' : q.bitrate ? Math.round(q.bitrate / 1000) + 'kbps' : '';
      return Object.assign({}, q, {
        tier: tiers[i],
        label: detail ? detail + ' · ' + tiers[i] : (q.label || tiers[i])
      });
    });
  }

  function extractContentId(raw, site) {
    const value = String(raw || '');
    let m = null;
    if (site === 'douyin') {
      m = value.match(/[?&]modal_id=(\d+)/) || value.match(/\/(?:video|note)\/(\d+)/);
    } else if (site === 'x') {
      m = value.match(/\/status\/(\d+)/);
    } else if (site === 'tiktok') {
      m = value.match(/\/(?:video|photo)\/(\d+)/);
    } else if (site === 'youtube') {
      m = value.match(/[?&]v=([\w-]+)/) || value.match(/youtu\.be\/([\w-]+)/);
    } else if (site === 'xhs') {
      m = value.match(/\/(?:explore|discovery\/item)\/([\w-]+)/);
    }
    return m ? m[1] : '';
  }

  return {
    VERSION,
    PAGE_HOSTS,
    MEDIA_HOSTS,
    hostMatches,
    siteFromHost,
    siteFromUrl,
    isDouyinProfileUrl,
    isTikTokProfileUrl,
    isXhsProfileUrl,
    isAllowedMediaUrl,
    sanitizeFilename,
    mediaExtension,
    cleanMediaUrl,
    resolutionFromUrl,
    pickThreeQualities,
    extractContentId
  };
});
