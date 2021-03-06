'use strict';

importScripts('scripts/shared.min.js');
const cacheBaseName = 'world';
const cacheStatic = `${cacheBaseName}-static`;
const cacheVersion = 'v1.0.0';

// Open a connection to indexedDB
const dbPromise = idb.open('mundus-db', 2, upgradeDB => {});

// On install, cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(`${cacheStatic}-${cacheVersion}`)
      .then(cache => {
        return cache.addAll([
          '/',
          'index.html',
          'styles/index.css',
          'styles/wicons.css',
          'assets/fonts/weathericons-regular-webfont.eot',
          'assets/fonts/weathericons-regular-webfont.svg',
          'assets/fonts/weathericons-regular-webfont.ttf',
          'assets/fonts/weathericons-regular-webfont.woff',
          'assets/fonts/weathericons-regular-webfont.woff2',
          'assets/icons/favicon.ico',
          'assets/icons/iss.png',
          'assets/images/poweredby-oneline.png',
          'scripts/shared.min.js',
          'scripts/loader.min.js',
          'scripts/earth.details.min.js',
          'scripts/sky.details.min.js',
          'scripts/space.details.min.js',
          'scripts/index.min.js'
        ])
      })
  );
});

// On activate, delete any caches with an old version
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.filter(cacheName => {
            return cacheName.startsWith(cacheBaseName)
              && !cacheName.endsWith(cacheVersion);
          })
          .map(cacheName => {
            return caches.delete(cacheName);
          })
        );
      })
      .catch(error => console.log('Error cleaning old cache version', error))
  );
});

// Handle any request that interacts with the cache
const handleCacheRequest = event => {
  event.respondWith(
    caches.match(event.request, {ignoreSearch: true})
      .then(response => {
        if (response) {
          return response;
        }

        const fetchRequest = event.request.clone();

        return fetch(fetchRequest)
          .then(response => {
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            const responseToCache = response.clone();
            caches.open(`${cacheStatic}-${cacheVersion}`)
              .then(cache => {
                cache.put(event.request, responseToCache);
              })
              .catch(error => console.log('Static cache error', error));
            return response;
          })
      })
      .catch(error => console.log('SW Fetch error', error))
  );
}

// Handle any request that interacts with the indexedDB
const handleIDBRequest = event => {
  let dbStore = undefined;
  let numRecordsToKeep = 1;
  const url = event.request.url;

  if (url.indexOf('darksky') !== -1) {
    dbStore = 'weather';
    numRecordsToKeep = 10;
  }

  if (typeof dbStore === 'undefined') {
    return;
  }

  event.respondWith(
    dbPromise.then(db => {
      console.log('background fetch start');
      return fetch(event.request)
        .then(response => {
          console.log('background fetch response', response);
          return response.json()
            .then(data => {
              data['id'] = `${data.latitude},${data.longitude}`;
              console.log('got background data', data);

              const tx = db.transaction(dbStore, 'readwrite');
              const idbWrite = tx.objectStore(dbStore);
              idbWrite.put(data);
              idbWrite.openCursor(null, 'prev')
                .then(function (cursor) {
                  return cursor.advance(numRecordsToKeep);
                })
                .then(function clearDB(cursor) {
                  if (!cursor) return;
                  cursor.delete();
                  return cursor.continue().then(clearDB);
                })
              return tx.complete.then(() => {
                return data;
              });
            })
            .catch(error => console.log('Background fetch response parse error', error))
        })
        .then(parsedResponse => new Response(JSON.stringify(parsedResponse)))
        .catch(error => console.log('IDB fetch failed', error));
    })
  );
}

// Hook into fetch events
self.addEventListener('fetch', event => {
  const url = event.request.url;

  if (url.indexOf('localhost') != -1) {
    // calling for assets
    console.log('assets');
    handleCacheRequest(event);
  } else if (url.indexOf('darksky') != -1) {
    // calling for weather
    handleIDBRequest(event);
  }
});

// Hook into message event from client
self.addEventListener('message', event => {
  const dbEvent = event.data.title;
  const data = event.data.body;
  data['id'] = 0;
  if (dbEvent === 'set-location') {
    dbPromise.then(db => {
      const idbWrite = db.transaction('location', 'readwrite').objectStore('location');
      idbWrite.put(data);
    })
    .catch(error => console.log('Error storing location', error))
  }
});
