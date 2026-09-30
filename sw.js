/* ==========================================================================
 * 考研小助手 —— Service Worker
 * 作用：
 *   1) 缓存 index.html / manifest.json / 图标，实现离线打开；
 *   2) 配合 manifest.json 让安卓 Chrome 认可「可安装的 PWA」；
 *   3) 提供 showNotification，让提醒在页面打开时更稳定地弹出。
 *
 * 更新策略（很重要，否则改了代码手机上还是旧的）：
 *   - 页面导航（HTML）：网络优先 → 失败时用缓存。这样一联网就能拿到新版。
 *   - 静态资源（图标等）：缓存优先 → 没有再走网络并写入缓存。
 *   - 每次改动前端文件，把下面的 VERSION 加 1，旧缓存会在 activate 时清掉。
 * ========================================================================== */

var VERSION = 'v1.0.0';
var CACHE = 'kaoyan-' + VERSION;

/* 需要预缓存的资源（相对路径，适配 GitHub Pages 子目录 / Vercel 根目录） */
var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/* ---------- 安装：预缓存 ---------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* 逐个 add，单个资源 404 不至于让整个安装失败 */
      return Promise.all(
        PRECACHE.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
        })
      );
    }).then(function () {
      return self.skipWaiting();   // 新 SW 立即接管，用户无需手动刷新两次
    })
  );
});

/* ---------- 激活：清理旧版本缓存 ---------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE && k.indexOf('kaoyan-') === 0) return caches.delete(k);
          return null;
        })
      );
    }).then(function () {
      return self.clients.claim();  // 立刻控制已打开的页面
    })
  );
});

/* ---------- 拦截请求 ---------- */
self.addEventListener('fetch', function (event) {
  var req = event.request;

  /* 只处理同源 GET；POST/跨域交给浏览器默认行为 */
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  /* 1) 页面导航：网络优先，离线时回退到缓存的 index.html */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./') || new Response(
            '<!DOCTYPE html><meta charset="utf-8"><title>离线</title>' +
            '<body style="font-family:sans-serif;padding:24px">' +
            '<h2>离线，且还没有缓存</h2>' +
            '<p>请先联网打开一次本页面，之后就能离线使用了。</p></body>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        });
      })
    );
    return;
  }

  /* 2) 其他同源静态资源：缓存优先 */
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        /* 只缓存成功的同源响应 */
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        /* 真离线且没缓存：图标等返回空响应，页面仍可运行 */
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});

/* ---------- 允许页面主动触发 SW 更新 ---------- */
self.addEventListener('message', function (event) {
  var d = event.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});
