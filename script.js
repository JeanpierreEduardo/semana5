// script.js — CineMax Perú
// Mejoras de programación (JavaScript) sobre la base HTML5 + CSS3:
//  1) Animación de aparición (fade-in) de la cartelera al desplazarse.
//  2) Registro de reservas: valida el formulario, genera un código de
//     reserva y la guarda directamente en Supabase (Postgres) usando
//     el cliente supabase-js cargado por CDN en cada página.

// ---------------------------------------------------------------------
// Configuración de Supabase
// Reemplaza estos dos valores por los de tu proyecto:
// Project Settings → API → "Project URL" y "anon public" key.
// La anon key es pública a propósito: la seguridad la da RLS (ver
// cinemax_supabase.sql), no el secreto de esta clave.
// ---------------------------------------------------------------------
const SUPABASE_URL = 'https://mymltiopvsbuilxzygtc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_sELSBDBQjkYTRXBhEkrVfw_YS6FIM4X';

const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

document.addEventListener('DOMContentLoaded', () => {
  activarFadeInCartelera();
  activarFormularioReserva();
});

/* ---------------------------------------------------------------------
   1) Aparición (fade-in) de la cartelera al desplazarse
--------------------------------------------------------------------- */
function activarFadeInCartelera() {
  const tarjetas = document.querySelectorAll('.tarjeta-pelicula');
  if (!tarjetas.length) return;

  const observador = new IntersectionObserver(
    (entradas) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting) {
          entrada.target.classList.add('visible');
          observador.unobserve(entrada.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  tarjetas.forEach((tarjeta) => observador.observe(tarjeta));
}

/* ---------------------------------------------------------------------
   2) Registro de reserva
--------------------------------------------------------------------- */
function activarFormularioReserva() {
  const formulario = document.querySelector('.formulario-reserva');
  if (!formulario) return;

  formulario.addEventListener('submit', manejarEnvioReserva);
}

async function manejarEnvioReserva(evento) {
  evento.preventDefault();

  const formulario = evento.target;
  const boton = formulario.querySelector('button[type="submit"]');

  limpiarErrores(formulario);

  const reserva = {
    id: generarCodigoReserva(),
    nombre: formulario.nombre.value.trim(),
    correo: formulario.correo.value.trim(),
    pelicula: formulario.pelicula.value,
    horario: formulario.horario.value,
    entradas: Number(formulario.entradas.value),
    comentario: formulario.comentario.value.trim(),
  };

  const errores = validarReserva(reserva);
  if (errores.length) {
    mostrarErrores(formulario, errores);
    return;
  }

  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = 'Procesando...';

  try {
    await guardarReserva(reserva);
    mostrarConfirmacion(reserva);
    formulario.reset();
  } catch (error) {
    console.error('Error al guardar la reserva:', error);
    alert('No se pudo registrar la reserva. Intenta nuevamente en unos segundos.');
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

function validarReserva(reserva) {
  const errores = [];
  const regexCorreo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!reserva.nombre) errores.push({ campo: 'nombre', mensaje: 'Ingresa tu nombre completo.' });
  if (!regexCorreo.test(reserva.correo)) errores.push({ campo: 'correo', mensaje: 'Ingresa un correo válido.' });
  if (!reserva.pelicula) errores.push({ campo: 'pelicula', mensaje: 'Selecciona una película.' });
  if (!reserva.horario) errores.push({ campo: 'horario', mensaje: 'Selecciona un horario.' });
  if (!reserva.entradas || reserva.entradas < 1 || reserva.entradas > 8) {
    errores.push({ campo: 'entradas', mensaje: 'La cantidad debe estar entre 1 y 8.' });
  }

  return errores;
}

function mostrarErrores(formulario, errores) {
  errores.forEach(({ campo, mensaje }) => {
    const input = formulario.querySelector(`[name="${campo}"]`);
    if (!input) return;
    const contenedorCampo = input.closest('.campo');
    contenedorCampo.classList.add('campo-error');

    let etiquetaError = contenedorCampo.querySelector('.mensaje-error');
    if (!etiquetaError) {
      etiquetaError = document.createElement('span');
      etiquetaError.className = 'mensaje-error';
      contenedorCampo.appendChild(etiquetaError);
    }
    etiquetaError.textContent = mensaje;
  });
}

function limpiarErrores(formulario) {
  formulario.querySelectorAll('.campo-error').forEach((campo) => {
    campo.classList.remove('campo-error');
    const etiquetaError = campo.querySelector('.mensaje-error');
    if (etiquetaError) etiquetaError.textContent = '';
  });
}

function generarCodigoReserva() {
  return 'RSV-' + Date.now().toString(36).toUpperCase();
}

/**
 * Guarda la reserva directamente en Supabase.
 * 1) Busca una función (id_funcion) que coincida con la película y la
 *    franja horaria elegidas en el formulario.
 * 2) Inserta la reserva apuntando a esa función.
 * Lanza un error si algo falla, para que manejarEnvioReserva() pueda
 * mostrar el mensaje correspondiente.
 */
async function guardarReserva(reserva) {
  if (!supabaseClient) {
    throw new Error('Supabase no está configurado (revisa SUPABASE_URL y SUPABASE_ANON_KEY).');
  }

  const { data: funciones, error: errorFuncion } = await supabaseClient
    .from('funciones')
    .select('id_funcion, peliculas!inner(codigo)')
    .eq('franja', reserva.horario)
    .eq('peliculas.codigo', reserva.pelicula)
    .order('hora', { ascending: true })
    .limit(1);

  if (errorFuncion) throw errorFuncion;
  if (!funciones || !funciones.length) {
    throw new Error('No hay funciones disponibles para esa película y horario.');
  }

  const { data, error } = await supabaseClient
    .from('reservas')
    .insert({
      codigo_reserva: reserva.id,
      nombre_cliente: reserva.nombre,
      correo_cliente: reserva.correo,
      id_funcion: funciones[0].id_funcion,
      cantidad_entradas: reserva.entradas,
      comentario: reserva.comentario || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

function mostrarConfirmacion(reserva) {
  const modal = document.createElement('div');
  modal.className = 'confirmacion-modal';
  modal.innerHTML = `
    <div class="confirmacion-tarjeta">
      <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
      <h3>¡Reserva confirmada!</h3>
      <p>Código: <strong>${reserva.id}</strong></p>
      <p>Te enviaremos los detalles a ${reserva.correo}</p>
      <button type="button" class="boton boton-primario cerrar-confirmacion">Aceptar</button>
    </div>
  `;
  document.body.appendChild(modal);

  requestAnimationFrame(() => modal.classList.add('visible'));

  modal.querySelector('.cerrar-confirmacion').addEventListener('click', () => {
    cerrarConfirmacion(modal);
  });

  modal.addEventListener('click', (evento) => {
    if (evento.target === modal) cerrarConfirmacion(modal);
  });
}

function cerrarConfirmacion(modal) {
  modal.classList.remove('visible');
  setTimeout(() => modal.remove(), 250);
}
