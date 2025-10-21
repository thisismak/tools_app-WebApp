const CACHE_NAME = 'tools-app-cache-v1';
const urlsToCache = [
  '/',
  '/css/style.css',
  '/dashboard',
  '/taskmanager',
  '/dictation',
  '/login',
  '/register',
  '/images/icon-192x192.png',
  '/images/icon-512x512.png',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.34/moment-timezone-with-data.min.js'
];

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

self.addEventListener('fetch', event => {
  console.log('攔截請求:', event.request.url);
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          console.log('從快取返回:', event.request.url);
          return response; // 直接返回快取響應
        }
        console.log('從網絡獲取:', event.request.url);
        return fetch(event.request, { redirect: 'follow' }) // 明確設置 redirect: follow
          .then(networkResponse => {
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

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            console.log('刪除舊快取:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// 處理推送通知
self.addEventListener('push', event => {
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: data.icon || '/images/icon-192x192.png',
    badge: '/images/icon-192x192.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/taskmanager'
    }
  };
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// 處理通知點擊
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});