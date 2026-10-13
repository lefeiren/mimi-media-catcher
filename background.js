/* 咪咪抓视频 - 后台下载与批量任务 */
importScripts('shared/core.js');

const Core = self.MimiCore;
const JOB_KEY = 'mimi_batch';

function normalizedFilename(filename, kind) {
  const fallbackExt = kind === 'audio' ? '.mp3' : kind === 'image' ? '.jpg' : '.mp4';
  const match = String(filename || '').match(/\.(mp4|m4a|mp3|jpg|jpeg|png|webp|avif)$/i);
  const ext = match ? '.' + match[1].toLowerCase() : fallbackExt;
  const stem = match ? String(filename).slice(0, -match[0].length) : String(filename || 'video');
  return Core.sanitizeFilename(stem) + ext;
}

function senderIsTrusted(sender, site, allowContent) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const extensionRoot = chrome.runtime.getURL('');
  if (sender.url && sender.url.startsWith(extensionRoot)) return true;
  if (!allowContent || !sender.tab || !sender.tab.url) return false;
  return Core.siteFromUrl(sender.tab.url) === site;
}

function doDownload(url, filename, site, kind) {
  return new Promise(resolve => {
    if (!site || !Core.isAllowedMediaUrl(url, site)) {
      resolve({ ok: false, error: '下载地址不在允许的媒体域名中' });
      return;
    }
    chrome.downloads.download({
      url,
      filename: normalizedFilename(filename, kind),
      conflictAction: 'uniquify',
      saveAs: false
    }, id => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve({ ok: true, id });
    });
  });
}

function selectExactItem(message, site, targetId) {
  if (!message || message.site !== site || !Array.isArray(message.items)) return null;
  const hasMedia = item => item && ((item.videos && item.videos.length) || (item.images && item.images.length));
  if (targetId) {
    const exact = message.items.find(item => String(item.id || '') === targetId || String(item.tweetId || '') === targetId);
    if (hasMedia(exact)) return exact;
    return null;
  }
  const detail = message.items.find(item => item.source === 'detail' && hasMedia(item));
  return detail || (message.items.length === 1 && hasMedia(message.items[0]) ? message.items[0] : null);
}

function waitForExactItem(tabId, site, targetId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('等待精确作品识别超时'));
    }, timeoutMs);
    function onMessage(message, sender) {
      if (!sender.tab || sender.tab.id !== tabId || message.type !== 'mimi_items') return;
      const item = selectExactItem(message, site, targetId);
      if (!item) return;
      cleanup();
      resolve({ message, item });
    }
    function cleanup() {
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
    }
    chrome.runtime.onMessage.addListener(onMessage);
  });
}

async function startJob(total, mode) {
  const stored = await chrome.storage.local.get(JOB_KEY);
  const old = stored[JOB_KEY];
  if (old && old.running && Date.now() - Number(old.updatedAt || 0) < 120000) return null;
  const job = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    mode,
    total,
    done: 0,
    running: true,
    updatedAt: Date.now(),
    results: []
  };
  await chrome.storage.local.set({ [JOB_KEY]: job });
  return job;
}

async function saveJob(job) {
  job.updatedAt = Date.now();
  await chrome.storage.local.set({ [JOB_KEY]: job });
}

async function runLinkBatch(job, urls) {
  for (let index = 0; index < urls.length; index++) {
    const pageUrl = String(urls[index] || '').trim();
    const site = Core.siteFromUrl(pageUrl);
    let tabId = null;
    let status = '失败';
    let filename = '';
    try {
      if (!site || site === 'x') throw new Error(site === 'x' ? 'X 不提供批量下载' : '不支持的页面地址');
      const targetId = Core.extractContentId(pageUrl, site);
      const tab = await chrome.tabs.create({ url: pageUrl, active: false });
      tabId = tab.id;
      const found = await waitForExactItem(tabId, site, targetId, 25000);
      const item = found.item;
      const stem = Core.sanitizeFilename((item.author ? item.author + '_' : '') + item.title);
      const video = item.videos && item.videos[0];
      if (video) {
        filename = Core.sanitizeFilename(stem + '_' + (video.label || '高清')) + '.mp4';
        const result = await doDownload(video.url, filename, site, 'video');
        status = result.ok ? '成功' : '失败: ' + result.error;
      } else {
        const images = (item.images || []).slice(0, 50);
        if (!images.length) throw new Error('作品中没有可下载媒体');
        let succeeded = 0;
        let lastError = '';
        for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
          const image = images[imageIndex];
          const imageName = Core.sanitizeFilename(stem + '_image_' + String(imageIndex + 1).padStart(2, '0')) + Core.mediaExtension(image.url, 'image');
          const result = await doDownload(image.url, imageName, site, 'image');
          if (result.ok) succeeded++;
          else lastError = result.error || '未知错误';
        }
        filename = images.length + ' 张图片';
        status = succeeded === images.length ? '成功' : '失败: 已开始 ' + succeeded + ' / ' + images.length + (lastError ? '，' + lastError : '');
      }
    } catch (error) {
      status = '失败: ' + String(error && error.message || error);
    } finally {
      if (tabId != null) {
        try { await chrome.tabs.remove(tabId); } catch (_) {}
      }
    }
    job.results.push({ url: pageUrl, status, filename });
    job.done = index + 1;
    job.running = job.done < job.total;
    await saveJob(job);
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  job.running = false;
  job.done = job.total;
  await saveJob(job);
}

async function runDownloadBatch(job, items) {
  for (let index = 0; index < items.length; index++) {
    const item = items[index] || {};
    const result = await doDownload(item.url, item.filename, item.site, item.kind || 'video');
    job.results.push({ url: item.url || '', status: result.ok ? '成功' : '失败: ' + result.error, filename: normalizedFilename(item.filename, item.kind) });
    job.done = index + 1;
    job.running = job.done < job.total;
    await saveJob(job);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  job.running = false;
  job.done = job.total;
  await saveJob(job);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== 'object') {
      sendResponse({ ok: false, error: '无效消息' });
      return;
    }
    if (message.type === 'download') {
      if (!senderIsTrusted(sender, message.site, true)) {
        sendResponse({ ok: false, error: '消息来源不可信' });
        return;
      }
      sendResponse(await doDownload(message.url, message.filename, message.site, message.kind));
      return;
    }
    if (message.type === 'batch') {
      if (!senderIsTrusted(sender, '', false)) {
        sendResponse({ ok: false, error: '仅扩展界面可启动批量任务' });
        return;
      }
      const urls = (Array.isArray(message.urls) ? message.urls : []).map(String).filter(url => {
        const targetSite = Core.siteFromUrl(url);
        return targetSite && targetSite !== 'x';
      }).slice(0, 200);
      if (!urls.length) { sendResponse({ ok: false, error: '没有可用的批量链接' }); return; }
      const job = await startJob(urls.length, 'links');
      if (!job) { sendResponse({ ok: false, error: '已有批量任务正在运行' }); return; }
      runLinkBatch(job, urls).catch(async error => {
        job.running = false;
        job.error = String(error && error.message || error);
        await saveJob(job);
      });
      sendResponse({ ok: true, jobId: job.id });
      return;
    }
    if (message.type === 'download_many') {
      if (!senderIsTrusted(sender, '', false)) {
        sendResponse({ ok: false, error: '仅扩展界面可启动批量任务' });
        return;
      }
      const items = (Array.isArray(message.items) ? message.items : []).filter(item => item && item.site !== 'x' && Core.isAllowedMediaUrl(item.url, item.site)).slice(0, 200);
      if (!items.length) { sendResponse({ ok: false, error: '没有可下载的项目' }); return; }
      const job = await startJob(items.length, 'items');
      if (!job) { sendResponse({ ok: false, error: '已有批量任务正在运行' }); return; }
      runDownloadBatch(job, items).catch(async error => {
        job.running = false;
        job.error = String(error && error.message || error);
        await saveJob(job);
      });
      sendResponse({ ok: true, jobId: job.id });
      return;
    }
    if (message.type === 'open_sidepanel') {
      if (!senderIsTrusted(sender, Core.siteFromUrl(sender.tab && sender.tab.url), true) || !sender.tab) {
        sendResponse({ ok: false, error: '消息来源不可信' });
        return;
      }
      try {
        await chrome.sidePanel.open({ tabId: sender.tab.id });
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: String(error && error.message || error) });
      }
      return;
    }
    sendResponse({});
  })().catch(error => sendResponse({ ok: false, error: String(error && error.message || error) }));
  return true;
});
