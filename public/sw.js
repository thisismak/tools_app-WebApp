const CACHE_NAME = 'tools-app-cache-v1';
const urlsToCache = [
  '/',
  '/css/style.css', // 確認這與 public/css/style.css 一致
  '/dashboard',
  '/taskmanager',
  '/dictation',
  '/login',
  '/register',
  '/images/icon-192x192.png', // 添加圖標
  '/images/icon-512x512.png', // 添加圖標
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.34/moment-timezone-with-data.min.js'
];

// 安裝 Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('開啟快取:', CACHE_NAME);
        return cache.addAll(urlsToCache).catch(err => {
          console.error('快取資源失敗:', err);
          throw err;
        });
      })
  );
});

// 處理資源請求
self.addEventListener('fetch', event => {
  console.log('攔截請求:', event.request.url); // 添加日誌
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          console.log('從快取返回:', event.request.url); // 添加日誌
          return response;
        }
        console.log('從網絡獲取:', event.request.url); // 添加日誌
        return fetch(event.request).then(networkResponse => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          return networkResponse;
        }).catch(err => {
          console.error('網絡請求失敗:', err);
          throw err;
        });
      })
  );
});

// 更新 Service Worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            console.log('刪除舊快取:', cacheName); // 添加日誌
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});