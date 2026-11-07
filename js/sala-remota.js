// Conversión entre lo que guarda Firebase y la sala que consume el resto del modo online.
// Lógica pura (sin SDK) para poder probarla con node:test; la usa js/red-firebase.js.
//
// Firebase no guarda null, ni arrays u objetos vacíos, y puede devolver un array como objeto
// {0: .., 1: ..}. normalizarSala devuelve siempre la misma forma que la red en memoria
// (test/red-memoria.mjs): todos los campos presentes, null donde no hay valor,
// historial como array y revelada/jugadores como objetos.

import { FLOTA_ESTANDAR } from "./modelo.js";
import { listaHistorial } from "./protocolo.js";

const NICK_MAX = 20;

// Array a partir de un array o de un objeto con claves numéricas (orden numérico).
function aArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((e) => e !== null && e !== undefined);
  if (typeof v !== "object") return [];
  return Object.keys(v)
    .map(Number)
    .filter(Number.isInteger)
    .sort((a, b) => a - b)
    .map((i) => v[i]);
}

const aCelda = (c) => {
  const [x, y] = aArray(c);
  return [x, y];
};

function normalizarEntrada(e) {
  const entrada = { de: e.de ?? null, x: e.x, y: e.y, estado: e.estado };
  if (e.barco) {
    entrada.barco = {
      nombre: e.barco.nombre,
      tam: e.barco.tam,
      posiciones: aArray(e.barco.posiciones).map(aCelda),
    };
  }
  if (e.alrededor || e.estado === "hundido") entrada.alrededor = aArray(e.alrededor).map(aCelda);
  return entrada;
}

export function normalizarSala(v) {
  if (!v || typeof v !== "object") return null;
  const jugadores = {};
  for (const [uid, j] of Object.entries(v.jugadores ?? {})) {
    jugadores[uid] = { nick: j?.nick ?? "", listo: j?.listo === true, conectado: j?.conectado === true };
  }
  const p = v.pendiente;
  return {
    creador: v.creador ?? null,
    invitado: v.invitado ?? null,
    fase: v.fase ?? "esperando",
    turno: v.turno ?? null,
    ganador: v.ganador ?? null,
    motivo: v.motivo ?? null,
    n: Number.isInteger(v.n) ? v.n : 0,
    jugadores,
    pendiente: p && typeof p === "object" ? { de: p.de, x: p.x, y: p.y } : null,
    historial: listaHistorial(v.historial).filter(Boolean).map(normalizarEntrada),
    revelada: v.revelada && typeof v.revelada === "object" ? structuredClone(v.revelada) : {},
  };
}

// Sala recién creada, tal como se escribe en Firebase (sin los campos null).
export function salaNueva(uid, nick) {
  return {
    creador: uid,
    fase: "esperando",
    n: 0,
    jugadores: { [uid]: { nick: limpiarNick(nick), listo: false, conectado: true } },
  };
}

export function limpiarNick(nick) {
  return String(nick ?? "").trim().slice(0, NICK_MAX) || "Capitán";
}

// Entrada del historial lista para Firebase: sin undefined (Firebase los rechaza).
export function entradaHistorial(pendiente, res) {
  const entrada = { de: pendiente.de, x: pendiente.x, y: pendiente.y, estado: res.estado };
  if (res.estado === "hundido") {
    entrada.barco = {
      nombre: res.barco.nombre,
      tam: res.barco.tam,
      posiciones: res.barco.posiciones.map(([x, y]) => [x, y]),
    };
    entrada.alrededor = (res.alrededor ?? []).map(([x, y]) => [x, y]);
  }
  return entrada;
}

// Compara dos flotas serializadas sin depender del orden de las claves
// (Firebase las devuelve ordenadas alfabéticamente).
export function mismaFlota(a, b) {
  if (!a || !b) return false;
  return FLOTA_ESTANDAR.every(({ nombre }) => {
    const p = a[nombre];
    const q = b[nombre];
    return p && q && p.x === q.x && p.y === q.y && p.ori === q.ori;
  });
}

// Mensaje en español para un error del SDK de Firebase (Auth o Realtime Database).
export function mensajeError(err) {
  const codigo = String(err?.code ?? "");
  const texto = String(err?.message ?? err ?? "");
  if (/permission[_-]denied/i.test(codigo) || /permission[_ ]denied/i.test(texto)) {
    return "La base de datos ha rechazado la operación.";
  }
  if (codigo === "auth/network-request-failed" || /offline|network|disconnect/i.test(texto)) return "Sin conexión.";
  if (codigo === "auth/operation-not-allowed" || codigo === "auth/admin-restricted-operation") {
    return "El acceso anónimo no está activado en el proyecto de Firebase.";
  }
  if (codigo === "auth/too-many-requests") return "Demasiados intentos; espera un momento y vuelve a probar.";
  if (/max-retries|maxretry/i.test(codigo + texto)) return "Hay demasiada actividad en la sala; inténtalo de nuevo.";
  return texto ? `Error de conexión con el servidor: ${texto}` : "Error de conexión con el servidor.";
}

export const esPermisoDenegado = (err) =>
  /permission[_-]denied/i.test(String(err?.code ?? "")) || /permission[_ ]denied/i.test(String(err?.message ?? ""));
