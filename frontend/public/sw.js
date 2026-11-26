/**
 * PANDA Custom Progressive Web App (PWA) Service Worker.
 *
 * Handles:
 * 1. Background push event processing for SuperUser access requests
 * 2. Notification click interactions and app navigation focus
 * 3. Lifecycle skip-waiting and client claiming
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Push notification arrival
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = {
        title: 'PANDA Facility Alert',
        body: event.data.text(),
      };
    }
  }

  const title = data.title || 'PANDA Facility Access Alert';
  const options = {
    body: data.body || 'New room entry request submitted.',
    icon: data.icon || '/icons/icon-192x192.svg',
    badge: data.badge || '/icons/badge-72x72.svg',
    tag: data.tag || 'panda-notification',
    data: data.data || { url: '/?tab=pending' },
    vibrate: [200, 100, 200],
    renotify: true,
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click behavior
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if available
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus().then((focusedClient) => {
            if ('navigate' in focusedClient) {
              return focusedClient.navigate(targetUrl);
            }
          });
        }
      }
      // Or open a new browser window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
