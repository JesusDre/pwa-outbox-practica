// app.js — versión 5.3

const API_URL = 'https://jsonplaceholder.typicode.com/posts';

const form = document.getElementById('form-incidencia');
const inputTitulo = document.getElementById('titulo');
const inputDescripcion = document.getElementById('descripcion');
const listaOutbox = document.getElementById('lista-outbox');
const btnPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');

// ===================== Registro del Service Worker =====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')   // ← ruta RELATIVA
      .then((reg) => console.log('[SW] Registrado. Scope:', reg.scope))
      .catch((err) => console.error('[SW] Error al registrar:', err));
  });

  // Fragmento G: puente SW → UI
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

// ===================== Indicador de red =====================
function actualizarIndicadorRed() {
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge online';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge offline';
  }
}

// ===================== READ: dibujar la cola =====================
function formatearHora(timestamp) {
  return new Date(timestamp).toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function renderizarColaOutbox() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      listaOutbox.innerHTML = '';

      if (registros.length === 0) {
        const vacio = document.createElement('li');
        vacio.className = 'vacio';
        vacio.textContent = 'La bandeja está vacía.';
        listaOutbox.appendChild(vacio);
        return;
      }

      // Más recientes primero
      registros
        .sort((a, b) => b.fechaCreacion - a.fechaCreacion)
        .forEach((item) => {
          const li = document.createElement('li');

          const info = document.createElement('div');
          const titulo = document.createElement('div');
          titulo.className = 'item-titulo';
          titulo.textContent = item.titulo;          // textContent evita inyección de HTML
          const hora = document.createElement('div');
          hora.className = 'item-hora';
          hora.textContent = `#${item.id} · ${formatearHora(item.fechaCreacion)}`;
          info.appendChild(titulo);
          info.appendChild(hora);

          const estado = document.createElement('span');
          estado.className = `estado ${item.estado}`;
          estado.textContent = item.estado;

          li.appendChild(info);
          li.appendChild(estado);
          listaOutbox.appendChild(li);
        });
    })
    .catch((error) => console.error('[UI] Error al renderizar la bandeja:', error));
}

// ===================== CREATE: envío resiliente (Fragmentos B + E) =====================
function procesarEnvioReporte(datosFormulario) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      // Envío exitoso: bitácora local como 'sincronizado'
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          // Detección de soporte de Background Sync.
          // NO hacemos "return": serviceWorker.ready solo se resuelve cuando hay un SW
          // activo; si no lo hay, la promesa nunca termina y bloquearía el repintado.
          // El dato ya está a salvo en IndexedDB, así que el sync se registra aparte.
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              })
              .catch((err) => {
                // Si falla el registro del sync, el dato YA está a salvo en IndexedDB
                console.warn('[Outbox] No se pudo registrar sync:', err);
              });
          }
        });
    })
    .then(() => renderizarColaOutbox());
}

// ===================== Conexión del formulario (submit) =====================
form.addEventListener('submit', (e) => {
  e.preventDefault();

  const datos = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };
  if (!datos.titulo || !datos.descripcion) return;

  procesarEnvioReporte(datos)
    .then(() => form.reset())
    .catch((error) => console.error('[UI] No se pudo procesar el reporte:', error));
});

// ===================== UPDATE: fallback sin Background Sync (Fragmento C) =====================
function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

// ===================== Eventos de red (Fragmento F) =====================
window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradación elegante: solo sincroniza la UI si NO hay Background Sync (Safari/iOS, Firefox)
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});
window.addEventListener('offline', actualizarIndicadorRed);

// ===================== DELETE: purgar sincronizados =====================
btnPurgar.addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const enviados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(enviados.map((item) => eliminarRegistro(item.id)));
    })
    .then((resultados) => {
      console.log(`[Outbox] Purgados ${resultados.length} registros sincronizados.`);
      return renderizarColaOutbox();
    })
    .catch((error) => console.error('[Outbox] Error al purgar:', error));
});

// ===================== Arranque =====================
actualizarIndicadorRed();
renderizarColaOutbox();   // ← esta promesa "rescata" los registros al abrir la página
if (navigator.onLine && !('SyncManager' in window)) {
  sincronizarPendientesFallback();
}
