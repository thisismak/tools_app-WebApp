const PRECACHE = 'precache-v4';
const PRECACHE_URLS = [
  '/',
  '/css/style.css',
  '/images/icon-192x192.png',
  '/images/icon-512x512.png',
  '/offline.html',
  '/js/taskmanager.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/main.css',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.45/moment-timezone-with-data.min.js'
];

self.addEventListener('install', event => {
  console.log('Service Worker 安裝中');
  event.waitUntil(
    caches.open(PRECACHE)
      .then(cache => {
        console.log('預快取資源:', PRECACHE_URLS);
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('預快取失敗:', err))
  );
});

self.addEventListener('activate', event => {
  console.log('Service Worker 啟動中');
  const currentCaches = [PRECACHE];
  event.waitUntil(
    caches.keys()
      .then(cacheNames => cacheNames.filter(cacheName => !currentCaches.includes(cacheName)))
      .then(cachesToDelete => Promise.all(
        cachesToDelete.map(cacheToDelete => {
          console.log('刪除舊快取:', cacheToDelete);
          return caches.delete(cacheToDelete);
        })
      ))
      .then(() => self.clients.claim())
      .catch(err => console.error('啟動清理失敗:', err))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) {
    console.log('跳過非 HTTP 請求:', url.href);
    return;
  }
  if (url.pathname.startsWith('/uploads/')) {
    console.log('動態檔案請求，使用 network-only:', url.pathname);
    event.respondWith(fetch(event.request));
    return;
  }
  if (PRECACHE_URLS.includes(url.pathname) || PRECACHE_URLS.includes(url.href)) {
    console.log('從快取提供靜態資源:', url.href);
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          console.log('從網絡獲取靜態資源:', url.href);
          return fetch(event.request);
        })
        .catch(err => {
          console.error('靜態資源快取失敗:', url.href, err);
          return caches.match('/offline.html')
            .then(offlineResponse => {
              if (offlineResponse) {
                console.log('提供離線頁面:', url.href);
                return offlineResponse;
              }
              throw new Error('無離線頁面可用');
            });
        })
    );
  } else {
    console.log('動態請求，使用 network-only:', url.pathname);
    event.respondWith(fetch(event.request));
  }
});

self.addEventListener('push', event => {
  console.log('收到推送通知:', event.data?.text() || '無數據');
  const data = event.data ? JSON.parse(event.data.text()) : { title: '通知', body: '您有新通知！', url: '/' };
  const options = {
    body: data.body,
    icon: data.icon || '/images/icon-192x192.png',
    badge: '/images/icon-192x192.png',
    data: { url: data.url }
  };
  event.waitUntil(
    self.registration.showNotification(data.title || '通知', options)
      .catch(err => console.error('顯示通知失敗:', err))
  );
});

self.addEventListener('notificationclick', event => {
  console.log('通知被點擊:', event.notification.title);
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        const url = event.notification.data.url || '/';
        console.log('導航到 URL:', url);
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
      .catch(err => console.error('處理通知點擊失敗:', err))
  );
});