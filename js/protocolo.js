// Protocolo del modo online: lógica pura (sin DOM ni Firebase).
// Cada navegador conserva SOLO su tablero propio; el rival responde a los disparos con el suyo.
// La sala compartida (salas/{codigo}) lleva el historial de disparos ya resueltos.

import {
  FLOTA_ESTANDAR,
  TAM_TABLERO,
  Usuario,
  Horizontal,
  Vertical,
  resolverEn,
  aplicarResultado,
} from "./modelo.js";

export const ALFABETO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LONGITUD_CODIGO = 5;

const clave = (x, y) => `${x},${y}`;

// ---------------------------------------------------------------- Códigos de sala

// Código de sala de 5 caracteres del alfabeto sin caracteres ambiguos (sin I, L, O, 0, 1).
export function generarCodigo(rnd = Math.random) {
  let codigo = "";
  for (let i = 0; i < LONGITUD_CODIGO; i++) {
    codigo += ALFABETO_CODIGO[Math.floor(rnd() * ALFABETO_CODIGO.length)];
  }
  return codigo;
}

// Normaliza lo que escribe el usuario; devuelve null si no es un código válido.
export function normalizarCodigo(texto) {
  const codigo = String(texto ?? "").trim().toUpperCase();
  if (codigo.length !== LONGITUD_CODIGO) return null;
  return [...codigo].every((c) => ALFABETO_CODIGO.includes(c)) ? codigo : null;
}

// ---------------------------------------------------------------- Flota

// Usuario sin partida ni Juego: solo tableros y flota. Es el jugador local del modo online.
export function crearUsuarioLocal(nick) {
  const usr = new Usuario(nick, null);
  usr.inicializarTableros(TAM_TABLERO);
  usr.inicializarFlota();
  // Usuario.colocarBarco/desplegarAleatorio exigen una partida en fase "desplegando". En línea la fase
  // la lleva el estado local (estado.fase), así que se pone un sustituto mínimo para poder desplegar.
  usr.partida = { esDesplegando: () => true };
  return usr;
}

// { portaaviones: { x, y, ori: "horizontal" | "vertical" }, ... } a partir de la flota ya colocada.
export function serializarFlota(usuario) {
  const salida = {};
  for (const { nombre } of FLOTA_ESTANDAR) {
    const barco = usuario.flota[nombre];
    if (!barco || !barco.desplegado) throw new Error(`El barco ${nombre} no está colocado.`);
    salida[nombre] = { x: barco.x, y: barco.y, ori: barco.orientacion.nombre };
  }
  return salida;
}

// Coloca en `usuario` la flota serializada. Devuelve true si es válida (completa, dentro del
// tablero y sin solaparse); si no, deja el tablero vacío y devuelve false.
export function deserializarFlota(datos, usuario) {
  const vaciar = () => {
    for (const barco of Object.values(usuario.flota)) usuario.tableroPropio.quitarBarco(barco);
  };
  vaciar();
  if (!datos || typeof datos !== "object") return false;
  for (const { nombre } of FLOTA_ESTANDAR) {
    const d = datos[nombre];
    if (!d || !Number.isInteger(d.x) || !Number.isInteger(d.y)) return vaciar(), false;
    if (d.ori !== "horizontal" && d.ori !== "vertical") return vaciar(), false;
    const ori = d.ori === "horizontal" ? new Horizontal() : new Vertical();
    if (!usuario.tableroPropio.colocarBarco(usuario.flota[nombre], d.x, d.y, ori)) {
      return vaciar(), false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- Estado local

// Estado que mantiene cada navegador. `n` = entradas del historial ya aplicadas.
export function crearEstadoLocal(uid, usuario) {
  return { uid, usuario, n: 0, fase: "esperando", turno: null, ganador: null, motivo: null };
}

export function rivalDe(sala, uid) {
  return sala.creador === uid ? sala.invitado ?? null : sala.creador;
}

// El historial puede llegar como array o como objeto {0:..,1:..} (Firebase); siempre se devuelve array.
export function listaHistorial(historial) {
  if (!historial) return [];
  if (Array.isArray(historial)) return historial.filter(Boolean);
  return Object.keys(historial)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => historial[i]);
}

// Comprobación del lado atacante antes de escribir `pendiente`. Devuelve null si puede disparar,
// o el motivo en texto.
export function validarDisparo(estado, x, y, pendiente = null) {
  if (estado.fase !== "jugando") return "La partida no está en juego.";
  if (estado.turno !== estado.uid) return "No es tu turno.";
  if (pendiente) return "Espera la respuesta del rival.";
  const tablero = estado.usuario.tableroRival;
  if (!tablero.dentro(x, y)) return "Disparo fuera del tablero.";
  if (tablero.obtenerMarca(x, y)) return "Ya has disparado ahí.";
  return null;
}

// ---------------------------------------------------------------- Lado defensor

function resultadoYaAplicado(usuario, x, y) {
  const tablero = usuario.tableroPropio;
  const contenido = tablero.casillas[x][y].contiene;
  if (contenido.esAgua()) return { estado: "agua" };
  if (contenido.estado !== "hundido") return { estado: "tocado" };
  const posiciones = contenido.obtenerPosiciones();
  return {
    estado: "hundido",
    barco: { nombre: contenido.nombre, tam: contenido.tam, posiciones },
  };
}

// El rival (uidAtacante) ha disparado a (x, y). Aplica el disparo a mi tablero y devuelve
// { res, cambios } para pasárselos a Red.responder, o { error }.
// cambios = { turno, fase?, ganador? } con uids: agua pasa el turno a quien defiende (yo);
// tocado/hundido mantiene el turno en el atacante; hundir mi última nave cierra la partida.
export function resolverDisparo(usuarioLocal, x, y, uidLocal, uidAtacante) {
  const tablero = usuarioLocal.tableroPropio;
  if (!tablero.dentro(x, y)) return { error: "Disparo fuera del tablero." };
  // Idempotente: si ya lo había aplicado pero la respuesta no llegó a escribirse (corte de red),
  // se reconstruye el mismo resultado desde mi tablero en vez de volver a disparar.
  const res = tablero.obtenerMarca(x, y) ? resultadoYaAplicado(usuarioLocal, x, y) : resolverEn(usuarioLocal, x, y);
  const cambios = {};
  if (res.estado === "agua") {
    cambios.turno = uidLocal;
  } else {
    cambios.turno = uidAtacante;
    if (usuarioLocal.flotaHundida()) {
      cambios.fase = "final";
      cambios.ganador = uidAtacante;
    }
  }
  return { res, cambios };
}

// ---------------------------------------------------------------- Aplicar la sala

// Aplica al estado local lo nuevo de la sala:
// - mis disparos resueltos por el rival: marca mi tablero de disparos;
// - disparos del rival que mi tablero aún no refleja (p. ej. tras recargar la página): los repite;
// - fase, turno, ganador y motivo.
// Devuelve { nuevas: [{ i, propio, entrada }], pendiente } donde `pendiente` es un disparo del rival
// que me toca resolver (o null).
export function aplicarSala(estado, sala) {
  const nuevas = [];
  if (!sala) return { nuevas, pendiente: null };
  const lista = listaHistorial(sala.historial);
  const usr = estado.usuario;
  for (let i = estado.n; i < lista.length; i++) {
    const e = lista[i];
    const propio = e.de === estado.uid;
    if (propio) {
      if (!usr.tableroRival.obtenerMarca(e.x, e.y)) aplicarResultado(usr, e.x, e.y, e);
    } else if (!usr.tableroPropio.obtenerMarca(e.x, e.y)) {
      resolverEn(usr, e.x, e.y);
    }
    nuevas.push({ i, propio, entrada: e });
  }
  estado.n = Math.max(estado.n, lista.length);
  estado.fase = sala.fase ?? estado.fase;
  estado.turno = sala.turno ?? null;
  estado.ganador = sala.ganador ?? null;
  estado.motivo = sala.motivo ?? null;
  const p = sala.pendiente;
  const pendiente = p && p.de !== estado.uid ? p : null;
  return { nuevas, pendiente };
}

// ---------------------------------------------------------------- Verificación

const mismasCasillas = (a = [], b = []) => {
  const sa = new Set(a.map(([x, y]) => clave(x, y)));
  const sb = new Set(b.map(([x, y]) => clave(x, y)));
  return sa.size === sb.size && [...sa].every((k) => sb.has(k));
};

// Comprueba que las respuestas del defensor (uidDefensor) cuadran con la flota que ha revelado:
// repite sus disparos recibidos sobre esa flota y compara estado y barco hundido.
// También comprueba la regla de turnos (agua cambia de atacante, acierto repite) y que no haya
// disparos repetidos. Devuelve { ok: true } o { ok: false, indice, motivo }.
export function verificarHistorial(historial, flotaRevelada, uidDefensor) {
  const usr = crearUsuarioLocal("verificacion");
  if (!deserializarFlota(flotaRevelada, usr)) {
    return { ok: false, indice: -1, motivo: "La flota revelada no es válida." };
  }
  const lista = listaHistorial(historial);
  for (let i = 0; i < lista.length; i++) {
    const e = lista[i];
    if (i > 0) {
      const prev = lista[i - 1];
      const esperado = prev.estado === "agua" ? prev.de !== e.de : prev.de === e.de;
      if (!esperado) return { ok: false, indice: i, motivo: "Turno incorrecto." };
    }
    if (e.de === uidDefensor) continue;
    const tablero = usr.tableroPropio;
    if (!tablero.dentro(e.x, e.y)) return { ok: false, indice: i, motivo: "Disparo fuera del tablero." };
    if (tablero.obtenerMarca(e.x, e.y)) return { ok: false, indice: i, motivo: "Disparo repetido." };
    const real = resolverEn(usr, e.x, e.y);
    if (real.estado !== e.estado) {
      return { ok: false, indice: i, motivo: `Respondió "${e.estado}" y era "${real.estado}".` };
    }
    if (real.estado === "hundido") {
      if (!e.barco || e.barco.nombre !== real.barco.nombre || !mismasCasillas(e.barco.posiciones, real.barco.posiciones)) {
        return { ok: false, indice: i, motivo: "Barco hundido incorrecto." };
      }
    }
  }
  return { ok: true };
}
