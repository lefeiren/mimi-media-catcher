const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../shared/core.js');

test('recognizes supported page hosts without accepting lookalikes', () => {
  assert.equal(Core.siteFromHost('www.douyin.com'), 'douyin');
  assert.equal(Core.siteFromHost('x.com'), 'x');
  assert.equal(Core.siteFromHost('www.tiktok.com'), 'tiktok');
  assert.equal(Core.siteFromHost('www.xiaohongshu.com'), 'xhs');
  assert.equal(Core.siteFromHost('douyin.com.evil.test'), null);
});

test('only treats a real TikTok creator profile as batch-capable', () => {
  assert.equal(Core.isTikTokProfileUrl('https://www.tiktok.com/@creator'), true);
  assert.equal(Core.isTikTokProfileUrl('https://www.tiktok.com/@creator?lang=en'), true);
  assert.equal(Core.isTikTokProfileUrl('https://www.tiktok.com/@creator/video/7412345678901234567'), false);
  assert.equal(Core.isTikTokProfileUrl('https://www.tiktok.com/foryou'), false);
});

test('only treats a real Douyin profile page as batch-capable', () => {
  assert.equal(Core.isDouyinProfileUrl('https://www.douyin.com/user/MS4abc'), true);
  assert.equal(Core.isDouyinProfileUrl('https://www.douyin.com/user/self'), true);
  assert.equal(Core.isDouyinProfileUrl('https://www.douyin.com/user/MS4abc?modal_id=123456789'), false);
  assert.equal(Core.isDouyinProfileUrl('https://www.douyin.com/follow'), false);
});

test('only treats a real Xiaohongshu creator profile as batch-capable', () => {
  assert.equal(Core.isXhsProfileUrl('https://www.xiaohongshu.com/user/profile/creator-id'), true);
  assert.equal(Core.isXhsProfileUrl('https://www.xiaohongshu.com/user/profile/creator-id?xsec_token=token'), true);
  assert.equal(Core.isXhsProfileUrl('https://www.xiaohongshu.com/explore/68e8abcdef1234567890abcd'), false);
  assert.equal(Core.isXhsProfileUrl('https://www.xiaohongshu.com/explore'), false);
});

test('allows only HTTPS media URLs from the selected platform CDN', () => {
  assert.equal(Core.isAllowedMediaUrl('https://video.twimg.com/ext_tw_video/a.mp4', 'x'), true);
  assert.equal(Core.isAllowedMediaUrl('https://v3-web.douyinvod.com/a.mp4', 'douyin'), true);
  assert.equal(Core.isAllowedMediaUrl('https://v16-webapp-prime.tiktok.com/video/tos/a/video.mp4', 'tiktok'), true);
  assert.equal(Core.isAllowedMediaUrl('https://p16-common-sign.tiktokcdn.com/cover.webp', 'tiktok'), true);
  assert.equal(Core.isAllowedMediaUrl('https://www.tiktok.com/aweme/v1/play/?video_id=123', 'tiktok'), true);
  assert.equal(Core.isAllowedMediaUrl('https://www.tiktok.com/@creator', 'tiktok'), false);
  assert.equal(Core.isAllowedMediaUrl('https://sns-video-bd.xhscdn.com/stream/note.mp4', 'xhs'), true);
  assert.equal(Core.isAllowedMediaUrl('https://sns-webpic-qc.xhscdn.com/note/image.webp', 'xhs'), true);
  assert.equal(Core.isAllowedMediaUrl('https://www.xiaohongshu.com/explore/note', 'xhs'), false);
  assert.equal(Core.isAllowedMediaUrl('https://evil.tiktok.com/payload.mp4', 'tiktok'), false);
  assert.equal(Core.isAllowedMediaUrl('http://video.twimg.com/a.mp4', 'x'), false);
  assert.equal(Core.isAllowedMediaUrl('https://evil.test/payload.mp4', 'x'), false);
});

test('selects high, middle and low distinct resolutions', () => {
  const picked = Core.pickThreeQualities([
    { url: 'https://video.twimg.com/vid/avc1/1920x1080/a.mp4', bitrate: 5000000 },
    { url: 'https://video.twimg.com/vid/avc1/1280x720/a.mp4', bitrate: 2500000 },
    { url: 'https://video.twimg.com/vid/avc1/854x480/a.mp4', bitrate: 1000000 },
    { url: 'https://video.twimg.com/vid/avc1/640x360/a.mp4', bitrate: 500000 }
  ]);
  assert.deepEqual(picked.map(x => x.height), [1080, 720, 360]);
  assert.deepEqual(picked.map(x => x.tier), ['高清', '标清', '流畅']);
});

test('labels portrait video by its short edge', () => {
  const [quality] = Core.pickThreeQualities([
    { url: 'https://v3-web.douyinvod.com/video.mp4', width: 1080, height: 1920 }
  ]);
  assert.equal(quality.label, '1080p · 原画');
});

test('deduplicates equivalent resolutions and prefers H264', () => {
  const picked = Core.pickThreeQualities([
    { url: 'https://v3-web.douyinvod.com/hevc.mp4', width: 1920, height: 1080, codec: 'h265', bitrate: 5000000 },
    { url: 'https://v3-web.douyinvod.com/avc.mp4', width: 1920, height: 1080, codec: 'h264', bitrate: 4000000 }
  ]);
  assert.equal(picked.length, 1);
  assert.match(picked[0].url, /avc\.mp4$/);
});

test('extracts work IDs used by exact batch matching', () => {
  assert.equal(Core.extractContentId('https://www.douyin.com/?modal_id=1234567890123456789', 'douyin'), '1234567890123456789');
  assert.equal(Core.extractContentId('https://www.douyin.com/note/1234567890123456789', 'douyin'), '1234567890123456789');
  assert.equal(Core.extractContentId('https://x.com/user/status/1999999999999999999', 'x'), '1999999999999999999');
  assert.equal(Core.extractContentId('https://www.tiktok.com/@creator/video/7412345678901234567', 'tiktok'), '7412345678901234567');
  assert.equal(Core.extractContentId('https://www.tiktok.com/@creator/photo/7478990063938833682', 'tiktok'), '7478990063938833682');
  assert.equal(Core.extractContentId('https://www.xiaohongshu.com/explore/68e8abcdef1234567890abcd?xsec_token=token', 'xhs'), '68e8abcdef1234567890abcd');
});

test('sanitizes filenames and control characters', () => {
  assert.equal(Core.sanitizeFilename('../bad\nname:video'), '_bad_name_video');
});

test('keeps the media file extension when it is known', () => {
  assert.equal(Core.mediaExtension('https://cdn.test/music.mp3?token=1', 'audio'), '.mp3');
  assert.equal(Core.mediaExtension('https://cdn.test/cover.webp?token=1', 'image'), '.webp');
  assert.equal(Core.mediaExtension('https://sns-webpic-qc.xhscdn.com/note/file!nd_dft_wlteh_webp_3', 'image'), '.webp');
  assert.equal(Core.mediaExtension('https://cdn.test/no-extension', 'image'), '.jpg');
});
