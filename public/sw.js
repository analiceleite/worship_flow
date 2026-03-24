const CACHE_NAME = 'worship-flow-v3'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/manifest.webmanifest',
        '/logo.jpg',
        '/logo-192.jpg',
        '/logo-512.jpg',
        '/logo-192.png',
        '/logo-512.png'
      ])
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const url = new URL(event.request.url)

  if (url.origin !== self.location.origin) {
    return
  }

  if (url.pathname.startsWith('/_next/') || url.pathname === '/sw.js') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request) || caches.match('/') || new Response('Network error', { status: 503 }))
    )
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/'))
    )
    return
  }

  const shouldCacheAsset =
    event.request.destination === 'image' ||
    event.request.destination === 'font' ||
    url.pathname.endsWith('.webmanifest') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg')

  if (!shouldCacheAsset) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request) || caches.match('/') || new Response('Network error', { status: 503 }))
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      return fetch(event.request)
        .then((networkResponse) => {
          const responseToCache = networkResponse.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache)
          })
          return networkResponse
        })
        .catch(() => Response.error())
    })
  )
})
