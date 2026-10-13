/* Chrome 会对跨 MAIN/ISOLATED world 的同路径脚本去重，桥接层使用独立文件名。 */
(() => {
  'use strict';
  const PAGE_HOSTS = {
    douyin: ['douyin.com'], x: ['x.com', 'twitter.com'], tiktok: ['tiktok.com'],
    xhs: ['xiaohongshu.com'], youtube: ['youtube.com', 'youtu.be']
  };
  const MEDIA_HOSTS = {
    douyin: ['douyinvod.com', 'douyinpic.com', 'douyincdn.com', 'douyinstatic.com', 'byteimg.com', 'bytecdn.cn', 'bytedance.com', 'snssdk.com', 'iesdouyin.com', 'amemv.com'],
    x: ['video.twimg.com', 'pbs.twimg.com'],
    tiktok: ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokcdn-in.com', 'tiktokv.com', 'muscdn.com', 'byteoversea.com', 'bytefcdn-oversea.com', 'ibyteimg.com', 'ibytedtos.com'],
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
  function isDouyinProfileUrl(raw) {
    try {
      const url = new URL(raw);
      return siteFromHost(url.hostname) === 'douyin' && !url.searchParams.get('modal_id') && /^\/user\/[^/?#]+\/?$/.test(url.pathname);
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
    return (name || 'video').replace(/[\\/:*?"<>|#\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').slice(0, 80) || 'video';
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
  function resolutionFromUrl(raw) {
    const match = String(raw || '').match(/(?:^|\/)(\d{2,5})x(\d{2,5})(?:\/|$)/);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 0, height: 0 };
  }
  function pickThreeQualities(input) {
    const byKey = new Map();
    for (const raw of Array.isArray(input) ? input : []) {
      if (!raw || !/^https:\/\//i.test(String(raw.url || ''))) continue;
      const parsed = resolutionFromUrl(raw.url);
      const quality = {
        url: String(raw.url).replace('/playwm/', '/play/'),
        width: Number(raw.width) || parsed.width || 0,
        height: Number(raw.height) || parsed.height || 0,
        bitrate: Number(raw.bitrate || raw.bitRate) || 0,
        codec: String(raw.codec || ''),
        label: String(raw.label || '')
      };
      const key = quality.width && quality.height ? quality.width + 'x' + quality.height : quality.bitrate ? 'b:' + Math.round(quality.bitrate / 1000) : 'u:' + quality.url;
      const old = byKey.get(key);
      if (!old || (/h264|avc/i.test(quality.codec) && !/h264|avc/i.test(old.codec)) || quality.bitrate > old.bitrate) byKey.set(key, quality);
    }
    const sorted = [...byKey.values()].sort((a, b) => b.width * b.height - a.width * a.height || b.bitrate - a.bitrate);
    const chosen = sorted.length > 3 ? [sorted[0], sorted[Math.floor((sorted.length - 1) / 2)], sorted[sorted.length - 1]] : sorted;
    const tiers = chosen.length === 1 ? ['原画'] : chosen.length === 2 ? ['高清', '流畅'] : ['高清', '标清', '流畅'];
    return chosen.map((quality, index) => {
      const edge = quality.width && quality.height ? Math.min(quality.width, quality.height) : (quality.height || quality.width);
      const detail = edge ? edge + 'p' : quality.bitrate ? Math.round(quality.bitrate / 1000) + 'kbps' : '';
      return Object.assign({}, quality, { tier: tiers[index], label: detail ? detail + ' · ' + tiers[index] : (quality.label || tiers[index]) });
    });
  }
  globalThis.MimiCore = Object.freeze({
    VERSION: '0.5.5', hostMatches, siteFromHost, isDouyinProfileUrl, isTikTokProfileUrl, isXhsProfileUrl, isAllowedMediaUrl,
    sanitizeFilename, mediaExtension, resolutionFromUrl, pickThreeQualities
  });
})();
