// Interfaz del juego: une el modelo con la página.

import { Juego, Horizontal, Vertical, TAM_TABLERO } from "./modelo.js";
import { Almirante } from "./ia.js";
import { crearUsuarioLocal, deserializarFlota, normalizarCodigo } from "./protocolo.js";
import { crearControlador, crearRivalFantasma, almacenSala } from "./online.js";

const LETRAS = "ABCDEFGHIJ";
const coord = (x, y) => `${LETRAS[x]}${y + 1}`;
const RETARDO_IA = 650;

const $ = (sel) => document.querySelector(sel);
const ui = {
  propio: $("#tablero-propio"),
  rival: $("#tablero-rival"),
  zonaPropia: $("#zona-propia"),
  zonaRival: $("#zona-rival"),
  flotaPropia: $("#flota-propia"),
  flotaRival: $("#flota-rival"),
  mensaje: $("#mensaje"),
  bitacora: $("#bitacora"),
  nick: $("#nick"),
  modo: $("#modo"),
  dificultad: $("#dificultad"),
  sala: $("#panel-online"),
  crearSala: $("#crear-sala"),
  formUnirse: $("#form-unirse"),
  codigoSala: $("#codigo-sala"),
  unirse: $("#unirse"),
  salaCodigo: $("#sala-codigo"),
  copiarEnlace: $("#copiar-enlace"),
  salaRival: $("#sala-rival"),
  salaError: $("#sala-error"),
  tituloRival: $("#titulo-rival"),
  chapaPropia: $("#chapa-propia"),
  etiquetaFlote: $("#etiqueta-flote"),
  finVerif: $("#fin-verif"),
  nueva: $("#nueva"),
  salir: $("#salir"),
  oriHorizontal: $("#ori-horizontal"),
  oriVertical: $("#ori-vertical"),
  aleatorio: $("#aleatorio"),
  limpiar: $("#limpiar"),
  batalla: $("#batalla"),
  disparos: $("#m-disparos"),
  aciertos: $("#m-aciertos"),
  precision: $("#m-precision"),
  aFlote: $("#m-flote"),
  fin: $("#fin"),
  finEtiqueta: $("#fin-etiqueta"),
  finTitulo: $("#fin-titulo"),
  finTexto: $("#fin-texto"),
  ver: $("#ver"),
  otra: $("#otra"),
};

function leer(k, def) {
  try { return localStorage.getItem(k) ?? def; } catch { return def; }
}
function guardar(k, v) {
  try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ }
}

let e = null; // estado de la partida en curso (e.modo: "ia" | "online")
const almacen = almacenSala();

const enLinea = () => e.modo === "online";
const nickActual = () => ui.nick.value.trim() || "Capitán";
// Nombre con el que se habla del rival en los textos.
const nombreRival = () => (enLinea() ? e.maquina.nick : "El enemigo");
// Disparo propio sin respuesta (online) o turno de la IA en marcha.
const botonEmpezar = () => (enLinea() ? "«¡Listo!»" : "«¡A la batalla!»");
const ocupado = () => (enLinea() ? !!e.ctl?.esperando : e.ocupado);

// ------------------------------------------------------------ partida

// Abandona la partida en curso; en online pide confirmación si hay un rival jugando.
async function salirDePartida() {
  if (!e) return true;
  clearTimeout(e.temporizador);
  const ctl = e.ctl;
  if (enLinea() && ctl) {
    const activa = ctl.codigo && !ctl.terminado;
    // Solo se pierde (y se confirma) con el rival jugando; esperando o desplegando se sale sin pérdida.
    const enCurso = activa && ctl.estado?.fase === "jugando";
    if (enCurso && !confirm("Si sales ahora perderás la partida por abandono. ¿Quieres salir?")) return false;
    if (activa) await ctl.abandonar(); // el rival se entera y la sala queda cerrada
    ctl.cerrar();
  }
  return true;
}

// Devuelve false si el usuario cancela al salir de una partida online en curso.
async function nuevaPartida({ inicio = false } = {}) {
  if (!(await salirDePartida())) return false;
  if (ui.fin.open) ui.fin.close();
  ui.finVerif.hidden = true;
  mostrarError("");
  if (ui.modo.value === "online") iniciarOnline(inicio);
  else iniciarContraIA();
  return true;
}

function iniciarContraIA() {
  const nick = nickActual();
  const nickMaquina = nick === "Almirante IA" ? "Almirante IA II" : "Almirante IA";
  const juego = new Juego();
  juego.agregarUsuario(nick);
  juego.agregarUsuario(nickMaquina);
  const { codigo } = juego.jugadorCreaPartida(nick);
  juego.jugadorSeUneAPartida(nickMaquina, codigo);

  const partida = juego.obtenerPartida(codigo);
  const jugador = juego.obtenerUsuario(nick);
  const maquina = juego.obtenerUsuario(nickMaquina);
  maquina.desplegarAleatorio();

  e = {
    modo: "ia",
    partida,
    jugador,
    maquina,
    ia: new Almirante(TAM_TABLERO, ui.dificultad.value),
    orientacion: new Horizontal(),
    seleccionado: Object.keys(jugador.flota)[0],
    hover: null,
    ocupado: false,
    temporizador: null,
    ultimo: null,
  };

  ui.bitacora.innerHTML = "";
  avisar(`Coloca tu flota, ${nick}. Cuando la tengas lista, pulsa «¡A la batalla!».`);
  render();
}

function empezarBatallaOnline() {
  if (!e.ctl || e.ctl.estado?.fase !== "desplegando") return avisar("Espera a que se una tu rival.");
  if (!e.jugador.todosDesplegados()) return avisar("Coloca todos tus barcos antes de pulsar «¡Listo!».");
  mostrarError("");
  e.ctl.marcarListo();
}

function empezarBatalla() {
  if (enLinea()) return empezarBatallaOnline();
  if (!e.jugador.todosDesplegados()) return;
  e.maquina.barcosDesplegados();
  e.jugador.barcosDesplegados();
  e.seleccionado = null;
  e.hover = null;
  avisar("¡Empieza la batalla! Dispara en las aguas enemigas.");
  anotarTexto("Comienza la partida.", "mio");
  render();
}

function disparoJugador(x, y) {
  const { partida, jugador } = e;
  if (!partida.esJugando() || partida.turno !== jugador || ocupado()) return;
  if (enLinea()) return void e.ctl.disparar(x, y); // la respuesta llega por la sala
  const res = jugador.disparar(x, y);
  if (res.error) return avisar(res.error);
  anotar(res, true);
  render();
  if (partida.esFinal()) return terminar();
  if (partida.turno === e.maquina) turnoMaquina();
}

function turnoMaquina() {
  const actual = e;
  actual.ocupado = true;
  render();
  actual.temporizador = setTimeout(() => {
    if (actual !== e) return;
    const disparo = actual.ia.elegirDisparo();
    if (!disparo) return;
    const res = actual.maquina.disparar(disparo[0], disparo[1]);
    actual.ia.registrar(res);
    actual.ocupado = false;
    anotar(res, false);
    render();
    if (actual.partida.esFinal()) return terminar();
    if (actual.partida.turno === actual.maquina) turnoMaquina();
  }, RETARDO_IA);
}

function terminar() {
  const gano = e.partida.ganador === e.jugador;
  const { disparos, aciertos } = e.jugador;
  const precision = disparos ? Math.round((aciertos / disparos) * 100) : 0;
  ui.finEtiqueta.textContent = gano ? "Flota enemiga hundida" : "Tu flota ha sido hundida";
  ui.finTitulo.textContent = gano ? "¡Victoria!" : "Derrota";
  ui.finTexto.textContent = gano
    ? `Lo has conseguido en ${disparos} disparos, con un ${precision} % de acierto.`
    : `Al enemigo le quedaban ${e.maquina.barcosAFlote()} barcos a flote. Tu precisión: ${precision} %.`;
  avisar(gano ? "¡Victoria! Has hundido toda la flota enemiga." : "Derrota. El enemigo ha hundido toda tu flota.");
  anotarTexto(gano ? "Fin de la partida: ganas tú." : "Fin de la partida: gana el enemigo.", gano ? "exito" : "peligro");
  render();
  setTimeout(() => ui.fin.showModal(), 450);
}

// ------------------------------------------------------------ online

// Sustituto de `Partida` en modo online: fase, turno y ganador vienen de la sala remota.
function crearFachadaOnline(ev) {
  const quien = (uid) => (!uid || !ev.ctl ? null : uid === ev.ctl.uid ? ev.jugador : ev.maquina);
  return {
    get fase() { return ev.ctl ? ev.ctl.fase : "desplegando"; },
    get turno() { return quien(ev.ctl?.estado?.turno); },
    get ganador() { return quien(ev.ctl?.estado?.ganador); },
    get historial() {
      if (!ev.ctl) return [];
      return ev.ctl.historial.map((h) => ({
        atacante: h.propio ? ev.jugador.nick : ev.maquina.nick, x: h.x, y: h.y,
      }));
    },
    esInicial() { return false; },
    esDesplegando() { return this.fase === "desplegando"; },
    esJugando() { return this.fase === "jugando"; },
    esFinal() { return this.fase === "final"; },
  };
}

function iniciarOnline(inicio) {
  const jugador = crearUsuarioLocal(nickActual());
  e = {
    modo: "online",
    partida: null,
    jugador,
    maquina: crearRivalFantasma("Rival"),
    ctl: null,
    conectando: false,
    visto: null,
    orientacion: new Horizontal(),
    seleccionado: Object.keys(jugador.flota)[0],
    hover: null,
    ocupado: false,
    temporizador: null,
    ultimo: null,
  };
  e.partida = crearFachadaOnline(e);
  ui.bitacora.innerHTML = "";
  ui.codigoSala.value = "";

  const enlace = normalizarCodigo(new URLSearchParams(location.search).get("sala"));
  const guardado = almacen.leer();
  const bienvenida = "Crea una sala y pásale el código a tu rival, o únete a la suya. Mientras tanto, puedes ir colocando tu flota.";
  avisar(bienvenida);
  render();
  renderSala();
  // Recarga a mitad de partida: se vuelve a la sala guardada (si el enlace es de otra sala, manda el enlace).
  if (inicio && guardado && (!enlace || enlace === guardado)) {
    avisar("Volviendo a tu partida online…");
    conectarOnline(async (ctl) => {
      const r = await ctl.retomar(guardado);
      if (r.caducada) avisar(bienvenida); // la sala ya no existe: el código se olvidó
      else if (!r.error) avisar(`Has vuelto a la sala ${guardado}.`);
      return r;
    });
  } else if (inicio && enlace) {
    ui.codigoSala.value = enlace;
    avisar(`Te han invitado a la sala ${enlace}. Revisa tu nombre y pulsa «Unirse».`);
  }
}

async function crearRed() {
  if (globalThis.crearRedOnline) return globalThis.crearRedOnline(); // sustituto para pruebas
  let modulo;
  try {
    modulo = await import("./red-firebase.js");
  } catch {
    throw new Error("No se ha podido cargar el modo online. Comprueba tu conexión e inténtalo de nuevo.");
  }
  return modulo.crearRedFirebase();
}

// Crea el controlador la primera vez (carga Firebase solo ahora) y ejecuta `accion(ctl)`.
async function conectarOnline(accion) {
  const actual = e;
  if (actual.conectando || actual.ctl?.codigo) return;
  actual.conectando = true;
  mostrarError("");
  renderSala();
  let ctl = null;
  try {
    ctl = crearControladorOnline(actual, await crearRed());
    if (actual !== e) return ctl.cerrar({ olvidar: false });
    actual.ctl = ctl;
    const r = await accion(ctl);
    if (r?.error && !ctl.codigo) {
      ctl.cerrar({ olvidar: false });
      if (actual.ctl === ctl) actual.ctl = null;
    }
  } catch (err) {
    ctl?.cerrar({ olvidar: false });
    if (actual.ctl === ctl) actual.ctl = null;
    if (actual === e) mostrarError(String(err?.message ?? err));
  } finally {
    actual.conectando = false;
    if (actual === e) { render(); renderSala(); }
  }
}

function crearControladorOnline(actual, red) {
  actual.jugador.nick = nickActual();
  const activo = () => e === actual;
  return crearControlador({
    red,
    nick: actual.jugador.nick,
    usuario: actual.jugador,
    almacen,
    alCambiar: () => { if (activo()) { render(); renderSala(); avisarTransiciones(); } },
    alDisparo: (entrada, propio) => { if (activo()) anotar(entrada, propio); },
    alFin: (resultado) => { if (activo()) terminarOnline(resultado); },
    alVerificar: (v) => { if (activo()) mostrarVerificacion(v); },
    alError: (texto) => { if (activo()) mostrarError(texto); },
  });
}

function crearSala() {
  if (e.conectando || e.ctl?.codigo) return;
  conectarOnline(async (ctl) => {
    const r = await ctl.crearSala();
    if (!r.error) avisar(`Sala ${r.codigo} creada. Pásale el código o el enlace a tu rival; mientras tanto, coloca tu flota.`);
    return r;
  });
}

function unirseASala() {
  if (e.conectando || e.ctl?.codigo) return;
  if (!normalizarCodigo(ui.codigoSala.value)) {
    return mostrarError("El código de sala son 5 letras o cifras (sin I, L, O, 0 ni 1).");
  }
  conectarOnline(async (ctl) => {
    const r = await ctl.unirse(ui.codigoSala.value);
    if (!r.error) avisar(`Te has unido a la sala ${r.codigo}. Coloca tu flota y pulsa «¡Listo!».`);
    return r;
  });
}

function enlaceDeSala() {
  const url = new URL(location.href);
  url.searchParams.set("sala", e.ctl.codigo);
  url.hash = "";
  return url.toString();
}

async function copiarEnlace() {
  if (!e.ctl?.codigo) return;
  const enlace = enlaceDeSala();
  try {
    await navigator.clipboard.writeText(enlace);
    ui.copiarEnlace.textContent = "¡Copiado!";
    setTimeout(() => { ui.copiarEnlace.textContent = "Copiar enlace"; }, 1800);
  } catch {
    prompt("Copia el enlace y pásaselo a tu rival:", enlace);
  }
}

function mostrarError(texto) {
  ui.salaError.textContent = texto;
  ui.salaError.hidden = !texto;
}

// Anuncia en el mensaje los cambios de fase y de estado del rival.
function avisarTransiciones() {
  const ctl = e.ctl;
  if (!ctl?.estado || ctl.terminado) return;
  const rival = ctl.rival;
  const ahora = { fase: ctl.fase, rival: rival?.estado, sala: ctl.estado.fase };
  const antes = e.visto;
  e.visto = ahora;
  if (!antes) return;
  const nombre = e.maquina.nick;
  if (rival?.estado === "desconectado" && antes.rival !== "desconectado") {
    avisar(`${nombre} se ha desconectado. La partida seguirá cuando vuelva.`);
  } else if (antes.rival === "desconectado" && rival?.estado !== "desconectado") {
    avisar(`${nombre} ha vuelto.`);
  } else if (antes.sala === "esperando" && ahora.sala === "desplegando") {
    avisar(`${nombre} se ha unido. Coloca tu flota y pulsa «¡Listo!».`);
  } else if (antes.fase !== "listo" && ahora.fase === "listo") {
    avisar(`Flota lista. Esperando a que ${nombre} termine de colocar la suya.`);
  } else if (antes.fase !== "jugando" && ahora.fase === "jugando") {
    avisar(ctl.estado.turno === ctl.uid
      ? `¡Empieza la batalla! Dispara en las aguas de ${nombre}.`
      : `¡Empieza la batalla! Dispara primero ${nombre}.`);
    anotarTexto("Comienza la partida.", "mio");
  }
}

function textoRival(r) {
  if (!r) return "";
  const n = r.nick;
  return {
    esperando: "Esperando a que se una tu rival. Pásale el código o el enlace.",
    colocando: `${n} está colocando su flota.`,
    listo: `${n} está listo.`,
    jugando: `${n} está en la partida.`,
    desconectado: `${n} se ha desconectado. Esperando a que vuelva…`,
    fin: `${n} ha terminado la partida.`,
  }[r.estado] ?? "";
}

function renderSala() {
  if (!enLinea()) return;
  const ctl = e.ctl;
  ui.sala.dataset.estado = ctl?.codigo ? "activa" : "inicio";
  ui.salaCodigo.textContent = ctl?.codigo ?? "";
  const r = ctl?.rival;
  ui.salaRival.dataset.estado = r?.estado ?? "";
  ui.salaRival.textContent = textoRival(r);
  ui.crearSala.disabled = ui.unirse.disabled = ui.codigoSala.disabled = e.conectando;
}

// Mantiene al rival fantasma al día: nick y barcos hundidos según el historial.
function sincronizarRival() {
  const r = e.ctl?.rival;
  const nick = r?.nick ?? "Rival";
  e.maquina.nick = nick === e.jugador.nick ? `${nick} (rival)` : nick;
  for (const nombre of e.ctl?.hundidosRival ?? []) {
    const barco = e.maquina.flota[nombre];
    if (barco) barco.estado = "hundido";
  }
}

function terminarOnline({ gano, abandono }) {
  sincronizarRival();
  const rival = e.maquina.nick;
  const { disparos, aciertos } = e.jugador;
  const precision = disparos ? Math.round((aciertos / disparos) * 100) : 0;
  if (abandono) {
    ui.finEtiqueta.textContent = gano ? "El rival se ha retirado" : "Has abandonado";
    ui.finTexto.textContent = gano ? `${rival} ha abandonado la partida.` : `Has abandonado: la victoria es para ${rival}.`;
  } else {
    ui.finEtiqueta.textContent = gano ? "Flota rival hundida" : "Tu flota ha sido hundida";
    ui.finTexto.textContent = gano
      ? `Lo has conseguido en ${disparos} disparos, con un ${precision} % de acierto.`
      : `A ${rival} le quedaban ${e.maquina.barcosAFlote()} barcos a flote. Tu precisión: ${precision} %.`;
  }
  ui.finTitulo.textContent = gano ? "¡Victoria!" : "Derrota";
  ui.finVerif.className = "fin-verif";
  ui.finVerif.textContent = "Comprobando el resultado con la flota del rival…";
  ui.finVerif.hidden = false;
  const msg = abandono
    ? (gano ? `Victoria por abandono: ${rival} se ha retirado.` : "Derrota por abandono: te has retirado.")
    : (gano ? `¡Victoria! Has hundido toda la flota de ${rival}.` : `Derrota. ${rival} ha hundido toda tu flota.`);
  avisar(msg);
  anotarTexto(msg, gano ? "exito" : "peligro");
  render();
  renderSala();
  setTimeout(() => { if (!ui.fin.open) ui.fin.showModal(); }, 450);
}

function mostrarVerificacion(v) {
  if (v.vacia) { ui.finVerif.hidden = true; return; }
  const texto = v.ok
    ? "Resultado verificado: las respuestas de tu rival cuadran con la flota que ha revelado."
    : `Resultado no verificable: ${v.motivo}.`;
  ui.finVerif.className = `fin-verif ${v.ok ? "ok" : "mal"}`;
  ui.finVerif.textContent = texto;
  ui.finVerif.hidden = false;
  anotarTexto(texto, v.ok ? "" : "peligro");
  render(); // con la flota revelada se dibujan los barcos que quedaron sin hundir
}

// ------------------------------------------------------------ colocación

function clicPropio(x, y) {
  const { partida, jugador } = e;
  if (!partida.esDesplegando()) return;
  const contenido = jugador.tableroPropio.casillas[x][y].contiene;

  if (!e.seleccionado) {
    if (contenido.esAgua()) return avisar("Pulsa primero un barco de la lista.");
    // sin barco elegido, pulsar uno colocado lo levanta para moverlo
    e.orientacion = contenido.orientacion;
    jugador.quitarBarco(contenido.nombre);
    e.seleccionado = contenido.nombre;
    avisar(`Mueve el ${contenido.nombre}: pulsa la casilla donde quieres que empiece.`);
    return render();
  }

  // con un barco elegido, la casilla pulsada es siempre su inicio
  const nombre = e.seleccionado;
  if (jugador.colocarBarco(nombre, x, y, e.orientacion)) {
    e.seleccionado = siguienteSinColocar();
    avisar(e.seleccionado
      ? `${capital(nombre)} colocado. Ahora el ${e.seleccionado}.`
      : `Flota lista. Pulsa ${botonEmpezar()} cuando quieras.`);
  } else {
    avisar(`El ${nombre} no cabe ahí: se sale del tablero o se solapa con otro barco.`);
  }
  render();
}

function siguienteSinColocar() {
  return Object.values(e.jugador.flota).find((b) => !b.desplegado)?.nombre || null;
}

function ponerOrientacion(ori) {
  if (!e.partida.esDesplegando()) return;
  e.orientacion = ori;
  render();
}

function girar() {
  ponerOrientacion(e.orientacion.girar());
}

// ------------------------------------------------------------ mensajes

function avisar(texto) {
  ui.mensaje.textContent = texto;
}

function anotarTexto(texto, clase = "") {
  const li = document.createElement("li");
  li.textContent = texto;
  if (clase) li.className = clase;
  ui.bitacora.prepend(li);
}

function anotar(res, esJugador) {
  const c = coord(res.x, res.y);
  e.ultimo = { lado: esJugador ? "rival" : "propio", x: res.x, y: res.y };
  let texto;
  let clase = esJugador ? "mio" : "";
  if (esJugador) {
    if (res.estado === "agua") texto = `Disparas a ${c}: agua.`;
    else if (res.estado === "tocado") texto = `Disparas a ${c}: ¡tocado! Vuelves a disparar.`;
    else { texto = `Disparas a ${c}: ¡tocado y hundido! Cae su ${res.barco.nombre}.`; clase = "exito"; }
  } else {
    const quien = nombreRival();
    if (res.estado === "agua") texto = `${quien} dispara a ${c}: agua. Tu turno.`;
    else if (res.estado === "tocado") texto = `${quien} dispara a ${c}: te ha tocado.`;
    else { texto = `${quien} dispara a ${c}: ha hundido tu ${res.barco.nombre}.`; clase = "peligro"; }
  }
  anotarTexto(texto, clase);
  avisar(texto);
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------ dibujo

function construirTablero(el, lado) {
  el.innerHTML = "";
  el.celdas = [];
  const esquina = document.createElement("span");
  esquina.className = "etiqueta";
  el.append(esquina);
  for (let x = 0; x < TAM_TABLERO; x++) {
    const s = document.createElement("span");
    s.className = "etiqueta";
    s.textContent = LETRAS[x];
    el.append(s);
    el.celdas[x] = [];
  }
  for (let y = 0; y < TAM_TABLERO; y++) {
    const s = document.createElement("span");
    s.className = "etiqueta";
    s.textContent = y + 1;
    el.append(s);
    for (let x = 0; x < TAM_TABLERO; x++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "casilla";
      b.dataset.x = x;
      b.dataset.y = y;
      b.dataset.lado = lado;
      b.setAttribute("aria-label", coord(x, y));
      el.append(b);
      el.celdas[x][y] = b;
    }
  }
}

function clasesBarco(barco, x, y) {
  const pos = barco.obtenerPosiciones();
  const i = pos.findIndex(([px, py]) => px === x && py === y);
  const cls = ["barco", barco.orientacion.esHorizontal() ? "h" : "v"];
  if (i === 0) cls.push("proa");
  if (i === pos.length - 1) cls.push("popa");
  return cls;
}

function aplicarModo() {
  const online = enLinea();
  const rival = e.maquina.nick;
  document.body.dataset.modo = e.modo;
  ui.batalla.textContent = online ? "¡Listo!" : "¡A la batalla!";
  ui.tituloRival.textContent = !online ? "Aguas enemigas" : rival === "Rival" ? "Aguas del rival" : `Aguas de ${rival}`;
  ui.chapaPropia.textContent = !online ? "Dispara el enemigo" : `Dispara ${rival === "Rival" ? "el rival" : rival}`;
  ui.etiquetaFlote.textContent = online ? "Barcos rivales a flote" : "Enemigos a flote";
}

function render() {
  if (enLinea()) sincronizarRival();
  aplicarModo();
  const { partida, jugador, maquina } = e;
  document.body.dataset.fase = partida.fase;
  const miTurno = partida.esJugando() && partida.turno === jugador && !ocupado();
  // flota rival que se descubre al final: la de la IA o la que el rival ha revelado
  const reveladoRival = enLinea() ? e.ctl?.rivalRevelado : maquina;

  // previsualización de colocación
  let previo = null;
  if (partida.esDesplegando() && e.hover && e.seleccionado) {
    const barco = jugador.flota[e.seleccionado];
    const { x, y } = e.hover;
    previo = {
      ok: jugador.tableroPropio.puedeColocar(barco, x, y, e.orientacion),
      celdas: new Set(e.orientacion.posiciones(barco.tam, x, y).map(([a, b]) => `${a},${b}`)),
    };
  }

  // tablero propio
  for (let x = 0; x < TAM_TABLERO; x++) {
    for (let y = 0; y < TAM_TABLERO; y++) {
      const cls = ["casilla"];
      const contenido = jugador.tableroPropio.casillas[x][y].contiene;
      const marca = jugador.tableroPropio.obtenerMarca(x, y);
      let etiqueta = coord(x, y);
      if (!contenido.esAgua()) {
        cls.push(...clasesBarco(contenido, x, y));
        if (contenido.estado === "hundido") cls.push("hundido");
        else if (marca === "tocado") cls.push("tocado");
        etiqueta += `, ${contenido.nombre}`;
      } else if (marca === "agua") {
        cls.push("agua");
      }
      if (previo && previo.celdas.has(`${x},${y}`)) cls.push(previo.ok ? "previo-ok" : "previo-mal");
      if (e.ultimo && e.ultimo.lado === "propio" && e.ultimo.x === x && e.ultimo.y === y) cls.push("nuevo");
      const celda = ui.propio.celdas[x][y];
      celda.className = cls.join(" ");
      celda.setAttribute("aria-label", etiqueta);
    }
  }

  // tablero enemigo
  for (let x = 0; x < TAM_TABLERO; x++) {
    for (let y = 0; y < TAM_TABLERO; y++) {
      const cls = ["casilla"];
      const marca = jugador.tableroRival.obtenerMarca(x, y);
      if (marca === "agua") {
        cls.push("agua");
        if (!partida.historial.some((r) => r.atacante === jugador.nick && r.x === x && r.y === y)) cls.push("auto");
      } else if (marca) {
        cls.push(marca);
      } else if (partida.esFinal() && reveladoRival && !reveladoRival.tableroPropio.casillas[x][y].contiene.esAgua()) {
        cls.push("revelado");
      }
      if (!marca && miTurno) cls.push("apuntable");
      if (e.ultimo && e.ultimo.lado === "rival" && e.ultimo.x === x && e.ultimo.y === y) cls.push("nuevo");
      const celda = ui.rival.celdas[x][y];
      celda.className = cls.join(" ");
      celda.setAttribute("aria-label", `${coord(x, y)}${marca ? `, ${marca}` : ""}`);
    }
  }
  e.ultimo = null;

  // turnos
  ui.zonaRival.classList.toggle("activa", partida.esJugando() && partida.turno === jugador);
  ui.zonaPropia.classList.toggle("activa", partida.esJugando() && partida.turno === maquina);

  // panel de colocación
  const horizontal = e.orientacion.esHorizontal();
  ui.oriHorizontal.setAttribute("aria-pressed", String(horizontal));
  ui.oriVertical.setAttribute("aria-pressed", String(!horizontal));
  ui.batalla.disabled = !jugador.todosDesplegados()
    || (enLinea() && (!e.ctl || e.ctl.estado?.fase !== "desplegando" || e.conectando));

  renderFlotas();
  renderSalir();

  // marcador
  ui.disparos.textContent = jugador.disparos;
  ui.aciertos.textContent = jugador.aciertos;
  ui.precision.textContent = jugador.disparos ? `${Math.round((jugador.aciertos / jugador.disparos) * 100)} %` : "–";
  ui.aFlote.textContent = maquina.barcosAFlote();
}

// Botón de salir: online mientras haya sala activa; contra el ordenador mientras no haya terminado.
function renderSalir() {
  const visible = enLinea()
    ? !!e.ctl?.codigo && !e.ctl.terminado
    : !e.partida.esFinal();
  ui.salir.hidden = !visible;
  ui.salir.textContent = enLinea() ? "Salir de la sala" : "Abandonar partida";
}

// Sale de la partida y vuelve al estado inicial (panel de sala en online, partida nueva contra la IA).
async function salir() {
  if (!enLinea() && e.jugador.disparos > 0 && !e.partida.esFinal()
    && !confirm("Se perderá la partida en curso. ¿Quieres abandonarla?")) return;
  if (await nuevaPartida()) avisar(enLinea() ? "Has salido de la sala. Crea una nueva o únete a otra." : "Has abandonado la partida. Coloca tu flota para empezar otra.");
}

function piezas(barco, mostrarTocados) {
  const span = document.createElement("span");
  span.className = "piezas";
  const estados = barco.desplegado ? [...barco.casillas.values()] : Array(barco.tam).fill("intacto");
  for (const est of estados) {
    const i = document.createElement("i");
    if (mostrarTocados && est === "tocado") i.className = "t";
    span.append(i);
  }
  return span;
}

function renderFlotas() {
  const { partida, jugador, maquina } = e;
  const desplegando = partida.esDesplegando();

  ui.flotaPropia.innerHTML = "";
  for (const barco of Object.values(jugador.flota)) {
    const li = document.createElement("li");
    const fila = document.createElement(desplegando ? "button" : "div");
    fila.className = "barco-fila";
    if (desplegando) {
      fila.type = "button";
      if (!barco.desplegado) fila.classList.add("pendiente");
      if (e.seleccionado === barco.nombre) fila.classList.add("seleccionado");
      fila.addEventListener("click", () => {
        if (barco.desplegado) {
          e.orientacion = barco.orientacion; // igual que al levantarlo desde el tablero
          jugador.quitarBarco(barco.nombre);
        }
        e.seleccionado = barco.nombre;
        avisar(`Coloca el ${barco.nombre} (${barco.tam} casillas).`);
        render();
      });
    }
    if (barco.estado === "hundido") fila.classList.add("hundido");
    const nombre = document.createElement("span");
    nombre.className = "barco-nombre";
    nombre.textContent = barco.nombre;
    const info = document.createElement("span");
    info.className = "barco-info";
    info.append(piezas(barco, true));
    const estado = document.createElement("span");
    estado.textContent = desplegando
      ? (barco.desplegado ? "colocado" : "pendiente")
      : { intacto: "a flote", tocado: "tocado", hundido: "hundido" }[barco.estado];
    info.append(estado);
    fila.append(nombre, info);
    li.append(fila);
    ui.flotaPropia.append(li);
  }

  ui.flotaRival.innerHTML = "";
  for (const barco of Object.values(maquina.flota)) {
    const li = document.createElement("li");
    const fila = document.createElement("div");
    fila.className = "barco-fila";
    const hundido = barco.estado === "hundido";
    if (hundido) fila.classList.add("hundido");
    const nombre = document.createElement("span");
    nombre.className = "barco-nombre";
    nombre.textContent = barco.nombre;
    const info = document.createElement("span");
    info.className = "barco-info";
    info.append(piezas(barco, false));
    const estado = document.createElement("span");
    estado.textContent = hundido ? "hundido" : "a flote";
    info.append(estado);
    fila.append(nombre, info);
    li.append(fila);
    ui.flotaRival.append(li);
  }
}

// ------------------------------------------------------------ eventos

function iniciar() {
  ui.nick.value = leer("hlf-nick", "Capitán");
  const hayEnlace = !!new URLSearchParams(location.search).get("sala");
  const modo = hayEnlace ? "online" : leer("hlf-modo", "ia");
  ui.modo.value = modo === "online" ? "online" : "ia";
  const dif = leer("hlf-dificultad", "normal");
  ui.dificultad.value = ["facil", "normal", "dificil"].includes(dif) ? dif : "normal";

  construirTablero(ui.propio, "propio");
  construirTablero(ui.rival, "rival");

  ui.propio.addEventListener("click", (ev) => {
    const b = ev.target.closest(".casilla");
    if (b) clicPropio(+b.dataset.x, +b.dataset.y);
  });
  ui.rival.addEventListener("click", (ev) => {
    const b = ev.target.closest(".casilla");
    if (b) disparoJugador(+b.dataset.x, +b.dataset.y);
  });

  const alPasar = (ev) => {
    const b = ev.target.closest(".casilla");
    if (!e || !e.partida.esDesplegando()) return;
    const nuevo = b ? { x: +b.dataset.x, y: +b.dataset.y } : null;
    if (nuevo?.x === e.hover?.x && nuevo?.y === e.hover?.y) return;
    e.hover = nuevo;
    render();
  };
  ui.propio.addEventListener("pointerover", alPasar);
  ui.propio.addEventListener("focusin", alPasar);
  ui.propio.addEventListener("pointerleave", () => {
    if (e && e.hover) { e.hover = null; render(); }
  });

  ui.oriHorizontal.addEventListener("click", () => ponerOrientacion(new Horizontal()));
  ui.oriVertical.addEventListener("click", () => ponerOrientacion(new Vertical()));
  ui.aleatorio.addEventListener("click", () => {
    if (!e.partida.esDesplegando()) return;
    if (e.jugador.desplegarAleatorio()) {
      e.seleccionado = null;
      avisar(`Flota colocada al azar. Puedes moverla o pulsar ${botonEmpezar()}.`);
    } else {
      e.seleccionado = siguienteSinColocar();
      avisar("No se ha podido colocar la flota al azar. Inténtalo otra vez.");
    }
    render();
  });
  ui.limpiar.addEventListener("click", () => {
    if (!e.partida.esDesplegando()) return;
    e.jugador.quitarTodos();
    e.seleccionado = siguienteSinColocar();
    avisar("Tablero despejado. Vuelve a colocar tu flota.");
    render();
  });
  ui.batalla.addEventListener("click", empezarBatalla);
  ui.nueva.addEventListener("click", () => nuevaPartida());
  ui.otra.addEventListener("click", () => nuevaPartida());
  ui.salir.addEventListener("click", salir);
  ui.crearSala.addEventListener("click", crearSala);
  ui.formUnirse.addEventListener("submit", (ev) => {
    ev.preventDefault();
    unirseASala();
  });
  ui.copiarEnlace.addEventListener("click", copiarEnlace);
  ui.modo.addEventListener("change", async () => {
    const previo = e.modo;
    if (await nuevaPartida()) guardar("hlf-modo", ui.modo.value);
    else ui.modo.value = previo;
  });
  window.addEventListener("online", () => e.ctl?.reintentar());
  ui.ver.addEventListener("click", () => ui.fin.close());

  ui.nick.addEventListener("change", () => guardar("hlf-nick", ui.nick.value.trim()));
  ui.dificultad.addEventListener("change", () => {
    guardar("hlf-dificultad", ui.dificultad.value);
    if (!e || !e.ia) return;
    if (!e.partida.esFinal() && e.jugador.disparos === 0) {
      e.ia = new Almirante(TAM_TABLERO, ui.dificultad.value);
    } else {
      avisar("La nueva dificultad se aplicará en la próxima partida.");
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.target.matches("input, select, textarea")) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat || !e) return; // Ctrl+R recarga, no gira
    if (ev.key === "r" || ev.key === "R") girar();
  });

  nuevaPartida({ inicio: true });
}

iniciar();
