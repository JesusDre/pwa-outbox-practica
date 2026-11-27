// sw.js - Service Worker (App Shell + Background Sync)

// Fragmento A: cargar las funciones de IndexedDB dentro del SW
importScripts('./db-helper.js');

const CACHE_STATIC_NAME = 'static-outbox-v3';
const API_URL = 'https://jsonplaceholder.typicode.com/posts';

const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ---------- install: guardar los archivos en caché ----------
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then(function (cache) {
        return cache.addAll(STATIC_FILES);
      })
      .then(function () {
        return self.skipWaiting(); // activar la nueva versión sin esperar
      })
  );
});

// ---------- activate: borrar cachés viejas ----------
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (nombres) {
        const borrados = nombres
          .filter(function (nombre) {
            return nombre !== CACHE_STATIC_NAME;
          })
          .map(function (nombre) {
            return caches.delete(nombre);
          });
        return Promise.all(borrados);
      })
      .then(function () {
        return self.clients.claim(); // controlar las pestañas ya abiertas
      })
  );
});

// ---------- fetch: Cache First ----------
self.addEventListener('fetch', function (event) {
  // Los POST no se guardan en caché: si fallan, app.js los encola
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (enCache) {
      return enCache || fetch(event.request);
    })
  );
});

// ---------- Fragmento B: avisar a las pestañas abiertas ----------
function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (clientes) {
      clientes.forEach(function (cliente) {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

// ---------- Fragmento C: reenviar los pendientes ----------
function sincronizarPendientesSW() {
  console.log('[SW-Sync] Buscando transacciones pendientes...');

  return obtenerTodosLosRegistros().then(function (registros) {
    const pendientes = registros.filter(function (item) {
      return item.estado === 'pendiente';
    });

    if (pendientes.length === 0) {
      console.log('[SW-Sync] Nada por sincronizar.');
      return;
    }

    const promesasDeEnvio = pendientes.map(function (item) {
      return fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: item.titulo, body: item.descripcion })
      })
        .then(function (respuesta) {
          if (!respuesta.ok) {
            throw new Error('Error HTTP ' + respuesta.status + ' al sincronizar ID ' + item.id);
          }
          return actualizarEstadoRegistro(item.id, 'sincronizado');
        });
    });

    return Promise.all(promesasDeEnvio).then(function () {
      return notificarClientesActualizacion();
    });
  });
}

// ---------- Fragmento D: evento sync ----------
self.addEventListener('sync', function (event) {
  console.log('[SW-Sync] Evento sync con etiqueta:', event.tag);

  if (event.tag === 'sync-reportes') {
    event.waitUntil(
      sincronizarPendientesSW().catch(function (error) {
        console.error('[SW-Sync] Falló; el navegador reintentará luego:', error);
        throw error; // relanzar = el navegador programa un reintento
      })
    );
  }
});
