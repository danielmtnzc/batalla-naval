// Interfaz del juego: une el modelo con la página.

import { Juego, Horizontal, TAM_TABLERO } from "./modelo.js";
import { Almirante } from "./ia.js";

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
  dificultad: $("#dificultad"),
  nueva: $("#nueva"),
  girar: $("#girar"),
  orientacion: $("#orientacion"),
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

let e = null; // estado de la partida en curso

// ------------------------------------------------------------ partida

function nuevaPartida() {
  if (e) clearTimeout(e.temporizador);
  if (ui.fin.open) ui.fin.close();

  const nick = ui.nick.value.trim() || "Capitán";
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

function empezarBatalla() {
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
  if (!partida.esJugando() || partida.turno !== jugador || e.ocupado) return;
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

// ------------------------------------------------------------ colocación

function clicPropio(x, y) {
  const { partida, jugador } = e;
  if (!partida.esDesplegando()) return;
  const contenido = jugador.tableroPropio.casillas[x][y].contiene;

  if (!contenido.esAgua()) {
    // levantar un barco ya colocado para moverlo
    jugador.quitarBarco(contenido.nombre);
    e.seleccionado = contenido.nombre;
    e.orientacion = contenido.orientacion;
    avisar(`Mueve el ${contenido.nombre}: elige su nueva posición.`);
    return render();
  }

  if (!e.seleccionado) return avisar("Elige primero un barco de la lista.");
  const nombre = e.seleccionado;
  if (jugador.colocarBarco(nombre, x, y, e.orientacion)) {
    e.seleccionado = siguienteSinColocar();
    avisar(e.seleccionado
      ? `${capital(nombre)} colocado. Ahora el ${e.seleccionado}.`
      : "Flota lista. Pulsa «¡A la batalla!» cuando quieras.");
  } else {
    avisar(`El ${nombre} no cabe ahí: se sale del tablero o toca otro barco.`);
  }
  render();
}

function siguienteSinColocar() {
  return Object.values(e.jugador.flota).find((b) => !b.desplegado)?.nombre || null;
}

function girar() {
  if (!e.partida.esDesplegando()) return;
  e.orientacion = e.orientacion.girar();
  render();
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
    if (res.estado === "agua") texto = `El enemigo dispara a ${c}: agua. Tu turno.`;
    else if (res.estado === "tocado") texto = `El enemigo dispara a ${c}: te ha tocado.`;
    else { texto = `El enemigo dispara a ${c}: ha hundido tu ${res.barco.nombre}.`; clase = "peligro"; }
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

function render() {
  const { partida, jugador, maquina } = e;
  document.body.dataset.fase = partida.fase;
  const miTurno = partida.esJugando() && partida.turno === jugador && !e.ocupado;

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
      } else if (partida.esFinal() && !maquina.tableroPropio.casillas[x][y].contiene.esAgua()) {
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
  ui.orientacion.textContent = e.orientacion.nombre;
  ui.batalla.disabled = !jugador.todosDesplegados();

  renderFlotas();

  // marcador
  ui.disparos.textContent = jugador.disparos;
  ui.aciertos.textContent = jugador.aciertos;
  ui.precision.textContent = jugador.disparos ? `${Math.round((jugador.aciertos / jugador.disparos) * 100)} %` : "–";
  ui.aFlote.textContent = maquina.barcosAFlote();
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
        if (barco.desplegado) jugador.quitarBarco(barco.nombre);
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

  ui.girar.addEventListener("click", girar);
  ui.aleatorio.addEventListener("click", () => {
    e.jugador.desplegarAleatorio();
    e.seleccionado = null;
    avisar("Flota colocada al azar. Puedes moverla o pulsar «¡A la batalla!».");
    render();
  });
  ui.limpiar.addEventListener("click", () => {
    e.jugador.quitarTodos();
    e.seleccionado = siguienteSinColocar();
    avisar("Tablero despejado. Vuelve a colocar tu flota.");
    render();
  });
  ui.batalla.addEventListener("click", empezarBatalla);
  ui.nueva.addEventListener("click", nuevaPartida);
  ui.otra.addEventListener("click", nuevaPartida);
  ui.ver.addEventListener("click", () => ui.fin.close());

  ui.nick.addEventListener("change", () => guardar("hlf-nick", ui.nick.value.trim()));
  ui.dificultad.addEventListener("change", () => {
    guardar("hlf-dificultad", ui.dificultad.value);
    if (e && !e.partida.esFinal() && e.jugador.disparos === 0) {
      e.ia = new Almirante(TAM_TABLERO, ui.dificultad.value);
    } else {
      avisar("La nueva dificultad se aplicará en la próxima partida.");
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.target.matches("input, select, textarea")) return;
    if (ev.key === "r" || ev.key === "R") girar();
  });

  nuevaPartida();
}

iniciar();
