const CACHE_NAME = 'tools-app-static-v2';
const RUNTIME_CACHE = 'tools-app-runtime-v1';
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  '/css/style.css',
  '/images/icon-192x192.png',
  '/images/icon-512x512.png',
  OFFLINE_URL
];

// 安裝：預快取必要靜態檔案（對單一失敗要容錯）
self.addEventListener('install', event => {
  self.skipWaiting(); // 可視需求保留或移除（自動接手）
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of PRECACHE_URLS) {
      try {
        await cache.add(url);
      } catch (err) {
        // 個別資源失敗不讓整個安裝失敗
        console.warn('預快取失敗（單一）:', url, err);
      }
    }
  })());
});

// 激活：清理舊快取
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(k => {
        if (k !== CACHE_NAME && k !== RUNTIME_CACHE) return caches.delete(k);
      })
    );
    self.clients.claim();
  })());
});

// 工具：簡單 fetch 和 cache helper
async function putInCache(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (err) {
    // 無法快取 opaque 回應在某些情況下會丟錯，允許失敗
    console.warn('快取 put 失敗:', err);
  }
}

// fetch：只攔截 GET
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 對於導覽請求（HTML）採 network-first -> fallback cached offline
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(event.request);
        // 若 network 成功，更新 runtime cache（可選）
        putInCache(RUNTIME_CACHE, event.request, networkResponse);
        return networkResponse;
      } catch (err) {
        // 失敗時回退到緩存的 offline.html 或 cache
        const cached = await caches.match(event.request);
        if (cached) return cached;
        const offline = await caches.match(OFFLINE_URL);
        return offline || new Response('離線中', { status: 503, statusText: 'Service Worker Offline' });
      }
    })());
    return;
  }

  // 對於靜態同源資源採 cache-first
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const resp = await fetch(event.request);
        if (resp && resp.status === 200) putInCache(RUNTIME_CACHE, event.request, resp);
        return resp;
      } catch (err) {
        // 若無快取且網路也失敗，返回 offline fallback for HTML 之外的情況可以 return Response 503
        const offline = await caches.match(OFFLINE_URL);
        return offline || new Response(null, { status: 503 });
      }
    })());
    return;
  }

  // 對於跨域 CDN 採 stale-while-revalidate：回傳 cache（如果有），同時向網路更新
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(event.request);
    const networkFetch = fetch(event.request).then(resp => {
      // 允許 opaque 回應被存入 runtime cache（有時無法讀 body，但存放 ok）
      if (resp && (resp.status === 200 || resp.type === 'opaque')) {
        cache.put(event.request, resp.clone()).catch(() => {});
      }
      return resp;
    }).catch(() => null);

    // 優先 cache，若沒有則等待網路
    return cached || networkFetch || new Response(null, { status: 503 });
  })());
});

// push：防呆處理沒有 payload 的情況
self.addEventListener('push', event => {
  let payload = { title: '通知', body: '您有新通知', url: '/' };
  try {
    if (event.data) {
      const data = event.data.json();
      payload = {
        title: data.title || payload.title,
        body: data.body || payload.body,
        icon: data.icon || '/images/icon-192x192.png',
        url: data.url || payload.url
      };
    }
  } catch (err) {
    console.warn('解析 push payload 失敗', err);
  }
  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.icon,
    data: { url: payload.url }
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// notification click：先 focus 已有 client，否則 open new
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url === url && 'focus' in client) {
        return client.focus();
      }
    }
    if (clients.openWindow) {
      return clients.openWindow(url);
    }
  })());
});