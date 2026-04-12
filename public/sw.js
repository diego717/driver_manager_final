// Service Worker for SiteOps Dashboard PWA
const CACHE_NAME = 'driver-manager-1203d51e36';
const STATIC_ASSETS = [
  '/web/dashboard',
  '/dashboard.css?v=d9e514a1e9',
  '/chart.umd.js?v=74401d738d',
  '/jsqr.js?v=bc40c8a151',
  '/dashboard-qr.js?v=961179b0a2',
  '/dashboard-api.js?v=0c3f98fae4',
  '/dashboard-geolocation.js?v=a99f19d896',
  '/dashboard-scan.js?v=eee9eb93aa',
  '/dashboard-modals.js?v=6976cff499',
  '/dashboard-incidents.js?v=b9e761e562',
  '/dashboard-assets.js?v=595d145605',
  '/dashboard-drivers.js?v=107284fd17',
  '/dashboard-audit.js?v=cb0cf05086',
  '/dashboard-overview.js?v=c278d46315',
  '/dashboard-my-cases.js?v=12d40c4c92',
  '/dashboard-realtime.js?v=d763a18c75',
  '/dashboard-auth.js?v=342e9830f4',
  '/dashboard-navigation.js?v=74eb06359c',
  '/dashboard-bootstrap.js?v=65dba6e7cf',
  '/dashboard.js?v=3379b5648d',
  '/dashboard-pwa.js?v=55b84aa40e',
  '/manifest.json?v=9130a5f920',
  '/assets/fonts/material-symbols-outlined.ttf'
];

const STATIC_ASSET_PATHS = new Set([
  '/web/dashboard',
  '/dashboard.css',
  '/chart.umd.js',
  '/jsqr.js',
  '/dashboard-qr.js',
  '/dashboard-api.js',
  '/dashboard-geolocation.js',
  '/dashboard-scan.js',
  '/dashboard-modals.js',
  '/dashboard-incidents.js',
  '/dashboard-assets.js',
  '/dashboard-drivers.js',
  '/dashboard-audit.js',
  '/dashboard-overview.js',
  '/dashboard-my-cases.js',
  '/dashboard-realtime.js',
  '/dashboard-auth.js',
  '/dashboard-navigation.js',
  '/dashboard-bootstrap.js',
  '/dashboard.js',
  '/dashboard-pwa.js',
  '/manifest.json',
  '/assets/fonts/material-symbols-outlined.ttf'
]);

function getAssetPath(input) {
  const rawUrl = typeof input === 'string' ? input : input?.url;
  return new URL(rawUrl, self.location.origin).pathname;
}

async function shouldCacheResponse(requestOrUrl, response) {
  if (!response || response.status !== 200) return false;

  const path = getAssetPath(requestOrUrl);
  if (!STATIC_ASSET_PATHS.has(path)) {
    return false;
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed <= 0) {
      console.warn('[SW] Skip caching empty asset (content-length=0):', path);
      return false;
    }
  }

  try {
    const body = await response.clone().arrayBuffer();
    if (!body || body.byteLength <= 0) {
      console.warn('[SW] Skip caching empty asset body:', path);
      return false;
    }
  } catch (err) {
    console.warn('[SW] Could not validate asset body, skip cache:', path, err);
    return false;
  }

  return true;
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        console.log('[SW] Caching static assets');
        for (const asset of STATIC_ASSETS) {
          try {
            const request = new Request(asset, { cache: 'no-store' });
            const networkResponse = await fetch(request);
            if (!(await shouldCacheResponse(request, networkResponse))) {
              continue;
            }
            await cache.put(request, networkResponse.clone());
          } catch (err) {
            console.error('[SW] Error caching asset:', asset, err);
          }
        }
      })
      .then(() => {
        console.log('[SW] Static assets cached successfully');
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Error caching assets:', err);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const requestPath = url.pathname;
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip API requests - always go to network
  if (url.pathname.startsWith('/web/') && 
      !url.pathname.includes('/dashboard') &&
      !url.pathname.includes('.css') &&
      !url.pathname.includes('.js')) {
    return;
  }
  
  // Skip external requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Secure default: cache only explicit static dashboard shell assets.
  if (!STATIC_ASSET_PATHS.has(requestPath)) {
    return;
  }
  
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        // Return cached version if available
        if (cachedResponse) {
          // Fetch new version in background (stale-while-revalidate)
          fetch(request)
            .then(async (networkResponse) => {
              if (await shouldCacheResponse(request, networkResponse)) {
                caches.open(CACHE_NAME)
                  .then((cache) => {
                    cache.put(request, networkResponse.clone());
                  });
              }
            })
            .catch(() => {
              // Network failed, but we have cached version
            });
          
          return cachedResponse;
        }
        
        // No cache, fetch from network
        return fetch(request)
          .then(async (networkResponse) => {
            if (!(await shouldCacheResponse(request, networkResponse))) {
              return networkResponse;
            }
            
            // Cache the response
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseToCache);
              });
            
            return networkResponse;
          })
          .catch((err) => {
            console.error('[SW] Fetch failed:', err);
            
            // Return offline fallback for navigation requests
            if (request.mode === 'navigate') {
              return caches.match('/web/dashboard');
            }
            
            throw err;
          });
      })
  );
});

// Background sync for offline form submissions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-installations') {
    event.waitUntil(syncInstallations());
  }
});

// Push notifications (for future WebSocket integration)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body || 'Nueva actualización disponible',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: data.tag || 'default',
      requireInteraction: true,
      actions: [
        {
          action: 'open',
          title: 'Abrir'
        },
        {
          action: 'close',
          title: 'Cerrar'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(
        data.title || 'SiteOps',
        options
      )
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow('/web/dashboard')
    );
  }
});

// Message handler from main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

// Helper function for background sync
async function syncInstallations() {
  // This would sync any offline data when connection is restored
  console.log('[SW] Syncing installations...');
  // Implementation would go here
}

// Periodic background sync (if supported)
if ('periodicSync' in self.registration) {
  self.registration.periodicSync.register('update-stats', {
    minInterval: 24 * 60 * 60 * 1000 // 24 hours
  }).catch((err) => {
    console.log('[SW] Periodic sync not granted:', err);
  });
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-stats') {
    event.waitUntil(updateStatsInBackground());
  }
});

async function updateStatsInBackground() {
  // Update cached statistics in background
  console.log('[SW] Updating stats in background...');
  // Implementation would go here
}

console.log('[SW] Service Worker loaded');
