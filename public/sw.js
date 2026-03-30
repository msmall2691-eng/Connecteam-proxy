// Service Worker for Workflow HQ PWA
// Enables Add to Home Screen on iOS and Android

const CACHE_NAME = 'workflowhq-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', () => self.clients.claim())

// Network-first strategy — always try network, fall back to cache
self.addEventListener('fetch', (event) => {
  // Only cache GET requests for app shell
  if (event.request.method !== 'GET') return

  // Don't cache API calls
  if (event.request.url.includes('/api/')) return

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        }
        return response
      })
      .catch(() => caches.match(event.request))
  )
})
