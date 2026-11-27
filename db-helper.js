// db-helper.js
// Funciones para usar IndexedDB con promesas.
// Se carga en la página (index.html) y en el Service Worker (importScripts).

const DB_NAME = 'pwa-outbox-db';
const DB_VERSION = 1;
const STORE_NAME = 'transacciones_pendientes';

// ---------- Abrir la base de datos ----------
function abrirDB() {
  return new Promise(function (resolve, reject) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Solo se ejecuta si la base es nueva o si subió DB_VERSION
    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // autoIncrement genera los id solos: 1, 2, 3...
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = function (event) {
      resolve(event.target.result);
    };

    request.onerror = function (event) {
      reject(event.target.error);
    };
  });
}

// ---------- CREATE: guardar un registro ----------
function guardarRegistro(datos) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(datos);
      let idGenerado;

      req.onsuccess = function (event) {
        idGenerado = event.target.result;
      };

      // Resolvemos hasta que la transacción termina de guardar en disco
      tx.oncomplete = function () {
        resolve(idGenerado);
      };

      tx.onerror = function (event) {
        reject(event.target.error);
      };
    });
  });
}

// ---------- READ: leer todos los registros ----------
function obtenerTodosLosRegistros() {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = function (event) {
        resolve(event.target.result);
      };

      req.onerror = function (event) {
        reject(event.target.error);
      };
    });
  });
}

// ---------- DELETE: borrar un registro por su id ----------
function eliminarRegistro(id) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      store.delete(id);

      tx.oncomplete = function () {
        resolve(true);
      };

      tx.onerror = function (event) {
        reject(event.target.error);
      };
    });
  });
}

// ---------- UPDATE: cambiar el estado de un registro ----------
// Leemos (get) y guardamos (put) dentro de la misma transacción.
function actualizarEstadoRegistro(id, nuevoEstado) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // 1. Leer el registro actual
      const reqGet = store.get(id);

      reqGet.onsuccess = function (event) {
        const registro = event.target.result;
        if (!registro) {
          reject(new Error('No se encontró el registro con ID: ' + id));
          return;
        }
        // 2. Cambiar el estado y sobrescribir
        registro.estado = nuevoEstado;
        registro.fechaSincronizacion = Date.now();
        store.put(registro);
      };

      // 3. Resolver cuando la transacción termina
      tx.oncomplete = function () {
        resolve(true);
      };

      tx.onerror = function (event) {
        reject(event.target.error);
      };
    });
  });
}
