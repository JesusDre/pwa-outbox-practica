// app.js - Lógica de la pantalla

const API_URL = 'https://jsonplaceholder.typicode.com/posts';

const form = document.getElementById('form-incidencia');
const inputTitulo = document.getElementById('titulo');
const inputDescripcion = document.getElementById('descripcion');
const listaOutbox = document.getElementById('lista-outbox');
const btnPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');

// ---------- Service Worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(function (registro) {
      console.log('[SW] Registrado. Scope:', registro.scope);
    })
    .catch(function (error) {
      console.log('[SW] Error al registrar:', error);
    });

  // Fragmento G: el SW avisa cuando terminó de sincronizar
  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Aviso del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

// ---------- Indicador de red ----------
function actualizarIndicadorRed() {
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge online';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge offline';
  }
}

// ---------- READ: dibujar la bandeja ----------
function renderizarColaOutbox() {
  return obtenerTodosLosRegistros().then(function (registros) {
    listaOutbox.innerHTML = '';

    if (registros.length === 0) {
      const vacio = document.createElement('li');
      vacio.className = 'vacio';
      vacio.textContent = 'La bandeja está vacía.';
      listaOutbox.appendChild(vacio);
      return;
    }

    registros.forEach(function (item) {
      const li = document.createElement('li');
      const hora = new Date(item.fechaCreacion).toLocaleTimeString();

      // textContent muestra el texto tal cual (no ejecuta HTML)
      li.textContent = item.titulo + ' · ' + hora;

      const estado = document.createElement('span');
      estado.className = 'estado ' + item.estado;
      estado.textContent = item.estado;

      li.appendChild(estado);
      listaOutbox.appendChild(li);
    });
  });
}

// ---------- CREATE: enviar o guardar como pendiente (Fragmentos B y E) ----------
function procesarEnvioReporte(datosFormulario) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then(function (respuesta) {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(function () {
      // Sí hubo internet: guardamos como 'sincronizado'
      return guardarRegistro({
        titulo: datosFormulario.titulo,
        descripcion: datosFormulario.descripcion,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(function () {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');
      return guardarRegistro({
        titulo: datosFormulario.titulo,
        descripcion: datosFormulario.descripcion,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(function () {
          // Si el navegador tiene Background Sync, el SW se encarga del reenvío
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then(function (registro) {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              })
              .catch(function (error) {
                // Si no se pudo registrar el sync, el reporte ya está guardado
                console.warn('[Outbox] No se pudo registrar el sync:', error);
              });
          }
        });
    })
    .then(function () {
      return renderizarColaOutbox();
    });
}

// ---------- Formulario ----------
form.addEventListener('submit', function (e) {
  e.preventDefault();

  const datos = {
    titulo: inputTitulo.value,
    descripcion: inputDescripcion.value
  };

  procesarEnvioReporte(datos)
    .then(function () {
      form.reset();
    })
    .catch(function (error) {
      console.error('[UI] No se pudo procesar el reporte:', error);
    });
});

// ---------- UPDATE: plan B para navegadores sin Background Sync ----------
function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then(function (registros) {
      const pendientes = registros.filter(function (item) {
        return item.estado === 'pendiente';
      });

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay pendientes por sincronizar.');
        return;
      }

      // Cada pendiente se convierte en una promesa: enviar y luego actualizar
      const promesasDeEnvio = pendientes.map(function (item) {
        return fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then(function (res) {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      // Esperamos a que terminen todos
      return Promise.all(promesasDeEnvio);
    })
    .then(function () {
      return renderizarColaOutbox();
    })
    .catch(function (error) {
      console.error('[Outbox] Error durante la sincronización:', error);
    });
}

// ---------- Eventos de red (Fragmento F) ----------
window.addEventListener('online', function () {
  actualizarIndicadorRed();

  // Solo si NO hay Background Sync (Safari/iOS, Firefox).
  // En Chrome lo hace el SW; si lo hiciéramos aquí también, se enviaría doble.
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Usando el plan B...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// ---------- DELETE: purgar los ya sincronizados ----------
btnPurgar.addEventListener('click', function () {
  obtenerTodosLosRegistros()
    .then(function (registros) {
      const enviados = registros.filter(function (item) {
        return item.estado === 'sincronizado';
      });

      const promesasDeBorrado = enviados.map(function (item) {
        return eliminarRegistro(item.id);
      });

      return Promise.all(promesasDeBorrado);
    })
    .then(function () {
      return renderizarColaOutbox();
    })
    .catch(function (error) {
      console.error('[Outbox] Error al purgar:', error);
    });
});

// ---------- Al abrir la página ----------
actualizarIndicadorRed();
renderizarColaOutbox(); // esta promesa "rescata" los registros guardados

// En Safari/Firefox: si al abrir ya hay internet, enviamos lo pendiente
if (navigator.onLine && !('SyncManager' in window)) {
  sincronizarPendientesFallback();
}
