import { test } from "node:test";
import assert from "node:assert/strict";
import { Almirante } from "../js/ia.js";
import { crearUsuarioLocal, serializarFlota } from "../js/protocolo.js";
import { crearControlador, crearRivalFantasma, almacenSala } from "../js/online.js";
import { crearServidorMemoria } from "./red-memoria.mjs";

function semilla(s) {
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const almacenMemoria = () => {
  let v = null;
  return { leer: () => v, guardar: (c) => { v = c; }, borrar: () => { v = null; } };
};

// Cliente = red + controlador + registro de lo que ve la interfaz.
async function cliente(servidor, nick, semFlota, semIA, { uid = null, colocar = true } = {}) {
  const red = servidor.crearRed(uid);
  const usuario = crearUsuarioLocal(nick);
  if (colocar) assert.equal(usuario.desplegarAleatorio(semilla(semFlota)), true);
  const c = {
    nick,
    red,
    usuario,
    almacen: almacenMemoria(),
    ia: new Almirante(10, "dificil", semilla(semIA)),
    cambios: 0,
    disparos: [],
    fines: [],
    verificaciones: [],
    errores: [],
  };
  c.ctl = crearControlador({
    red,
    nick,
    usuario,
    almacen: c.almacen,
    esperaVerificacion: 20,
    alCambiar: () => c.cambios++,
    alDisparo: (entrada, propio) => c.disparos.push({ entrada, propio }),
    alFin: (r) => c.fines.push(r),
    alVerificar: (v) => c.verificaciones.push(v),
    alError: (m) => c.errores.push(m),
  });
  return c;
}

async function salaLista(sem = 1) {
  const servidor = crearServidorMemoria({ rnd: semilla(sem) });
  const a = await cliente(servidor, "ana", sem + 10, sem + 20);
  const b = await cliente(servidor, "beto", sem + 11, sem + 21);
  const { codigo } = await a.ctl.crearSala();
  assert.match(codigo, /^[A-Z2-9]{5}$/);
  assert.deepEqual(await b.ctl.unirse(codigo.toLowerCase()), { codigo });
  assert.deepEqual(await a.ctl.marcarListo(), {});
  assert.deepEqual(await b.ctl.marcarListo(), {});
  await servidor.reposo();
  return { servidor, a, b, codigo };
}

// Cada jugador, cuando le toca, dispara con su IA; devuelve cuando la partida ha terminado.
async function jugarHasta(servidor, a, b, { maxDisparos = 400, parar = () => false } = {}) {
  const jugadores = [a, b];
  for (let n = 0; n < maxDisparos; n++) {
    const sala = a.ctl.sala;
    if (sala.fase === "final" || parar(n)) return;
    const j = jugadores.find((p) => p.ctl.uid === sala.turno);
    const [x, y] = j.ia.elegirDisparo();
    assert.deepEqual(await j.ctl.disparar(x, y), {});
    await servidor.reposo();
    j.ia.registrar(j.ctl.historial.at(-1));
  }
  assert.fail("la partida no termina");
}

test("sala: estado del rival (esperando, colocando, listo) y desconexión", async () => {
  const servidor = crearServidorMemoria({ rnd: semilla(11) });
  const a = await cliente(servidor, "ana", 1, 2);
  const b = await cliente(servidor, "beto", 3, 4);
  const { codigo } = await a.ctl.crearSala();
  assert.equal(a.almacen.leer(), codigo);
  await servidor.reposo();
  assert.equal(a.ctl.rival.estado, "esperando");
  assert.equal(a.ctl.fase, "desplegando");

  // Aún no hay rival: no se puede marcar listo.
  assert.match((await a.ctl.marcarListo()).error, /se una tu rival/);

  await b.ctl.unirse(codigo);
  await servidor.reposo();
  assert.deepEqual(a.ctl.rival, { uid: b.ctl.uid, nick: "beto", estado: "colocando" });
  assert.equal(b.ctl.rival.nick, "ana");

  await b.ctl.marcarListo();
  await servidor.reposo();
  assert.equal(a.ctl.rival.estado, "listo");
  assert.equal(b.ctl.fase, "listo");
  assert.equal(a.ctl.fase, "desplegando");

  b.red.desconectar();
  await servidor.reposo();
  assert.equal(a.ctl.rival.estado, "desconectado");
  b.red.reconectar();
  await servidor.reposo();
  assert.equal(a.ctl.rival.estado, "listo");

  await a.ctl.marcarListo();
  await servidor.reposo();
  assert.equal(a.ctl.fase, "jugando");
  assert.equal(a.ctl.rival.estado, "jugando");
});

test("unirse: código no válido, sala inexistente, sala llena y mensajes en español", async () => {
  const servidor = crearServidorMemoria({ rnd: semilla(12) });
  const a = await cliente(servidor, "ana", 1, 2);
  const b = await cliente(servidor, "beto", 3, 4);
  const c = await cliente(servidor, "carla", 5, 6);
  const { codigo } = await a.ctl.crearSala();
  await b.ctl.unirse(codigo);

  assert.match((await c.ctl.unirse("AB0")).error, /no es válido/);
  assert.match((await c.ctl.unirse("ZZZZZ")).error, /no existe/);
  assert.match((await c.ctl.unirse(codigo)).error, /llena/);
  assert.equal(c.errores.length, 3);
  assert.equal(c.ctl.codigo, null);
  assert.equal(c.almacen.leer(), null);

  // Dos veces en la misma sala no se puede; ya dentro, abrir otra vez el enlace retoma la sala.
  assert.match((await b.ctl.crearSala()).error, /Ya estás/);
  const b2 = await cliente(servidor, "beto", 3, 4, { uid: b.ctl.uid });
  assert.deepEqual(await b2.ctl.unirse(codigo), { codigo, retomada: true });
});

test("marcarListo exige la flota completa", async () => {
  const servidor = crearServidorMemoria({ rnd: semilla(13) });
  const a = await cliente(servidor, "ana", 1, 2, { colocar: false });
  const b = await cliente(servidor, "beto", 3, 4);
  const { codigo } = await a.ctl.crearSala();
  await b.ctl.unirse(codigo);
  await servidor.reposo();
  assert.match((await a.ctl.marcarListo()).error, /no está colocado/);
  assert.equal(a.ctl.listo, false);
});

test("partida completa con semilla: turnos, espera de respuesta, historial, victoria, revelado y verificación", async () => {
  const { servidor, a, b, codigo } = await salaLista(21);
  assert.equal(a.ctl.fase, "jugando");
  assert.equal(a.ctl.estado.turno, a.ctl.uid);
  assert.equal(b.ctl.estado.turno, a.ctl.uid);

  // Fuera de turno: lo rechaza el controlador sin tocar la red.
  assert.match((await b.ctl.disparar(0, 0)).error, /No es tu turno/);

  const jugadores = [a, b];
  let disparos = 0;
  let esperaVista = false;
  while (a.ctl.sala.fase !== "final") {
    const sala = a.ctl.sala;
    const j = jugadores.find((p) => p.ctl.uid === sala.turno);
    const otro = j === a ? b : a;
    const [x, y] = j.ia.elegirDisparo();
    const promesa = j.ctl.disparar(x, y);
    // Mientras se espera la respuesta no se puede disparar otra vez.
    assert.equal(j.ctl.esperando, true);
    assert.match((await j.ctl.disparar((x + 1) % 10, y)).error, /Espera la respuesta/);
    await promesa;
    esperaVista = true;
    await servidor.reposo();
    assert.equal(j.ctl.esperando, false);
    const entrada = j.ctl.historial.at(-1);
    assert.deepEqual([entrada.de, entrada.x, entrada.y, entrada.propio], [j.ctl.uid, x, y, true]);
    assert.equal(otro.ctl.historial.at(-1).propio, false);
    if (a.ctl.sala.fase !== "final") {
      assert.equal(a.ctl.estado.turno, entrada.estado === "agua" ? otro.ctl.uid : j.ctl.uid);
      assert.equal(b.ctl.estado.turno, a.ctl.estado.turno);
    }
    j.ia.registrar(entrada);
    disparos++;
    assert.ok(disparos <= 200);
  }
  assert.ok(esperaVista);
  await servidor.reposo();
  await servidor.reposo();

  const sala = servidor.sala(codigo);
  const ganador = jugadores.find((p) => p.ctl.uid === sala.ganador);
  const perdedor = ganador === a ? b : a;
  assert.equal(sala.motivo, "flota hundida");
  assert.equal(ganador.ctl.resultado.gano, true);
  assert.equal(perdedor.ctl.resultado.gano, false);
  assert.equal(ganador.ctl.resultado.abandono, false);
  assert.equal(ganador.fines.length, 1);
  assert.equal(perdedor.fines.length, 1);
  assert.equal(ganador.ctl.hundidosRival.size, 5);
  assert.ok(perdedor.ctl.hundidosRival.size < 5);
  assert.equal(ganador.ctl.terminado, true);
  assert.equal(ganador.almacen.leer(), null);
  assert.equal(ganador.disparos.length, sala.historial.length);

  // Las dos flotas se revelan y cada uno verifica las respuestas del otro.
  assert.equal(Object.keys(sala.revelada).length, 2);
  assert.deepEqual(a.ctl.verificacion, { ok: true });
  assert.deepEqual(b.ctl.verificacion, { ok: true });
  assert.equal(a.verificaciones.length, 1);
  assert.deepEqual(serializarFlota(a.ctl.rivalRevelado), serializarFlota(b.usuario));
  assert.match((await ganador.ctl.disparar(0, 0)).error, /no está en juego/);
});

test("una respuesta falsa del defensor da un resultado no verificable", async () => {
  const { servidor, a, b } = await salaLista(22);
  // B miente: responde "agua" a cualquier disparo, aunque dé en un barco suyo.
  const original = b.red.responder;
  b.red.responder = (res, cambios) =>
    original(res.estado === "agua" ? res : { estado: "agua" }, res.estado === "agua" ? cambios : { turno: b.ctl.uid });
  await jugarHasta(servidor, a, b, { parar: (n) => n >= 30 });
  await a.ctl.abandonar(); // se cierra la partida para forzar la comprobación
  await servidor.reposo();
  await servidor.reposo();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(a.ctl.verificacion.ok, false);
  assert.ok(a.ctl.verificacion.motivo.length > 0);
  assert.equal(b.ctl.verificacion.ok, true); // B no ha visto trampa en las respuestas de A
});

test("abandono: derrota para quien abandona y victoria por abandono para el otro", async () => {
  const { servidor, a, b, codigo } = await salaLista(23);
  await a.ctl.disparar(0, 0);
  await servidor.reposo();
  assert.deepEqual(await b.ctl.abandonar(), {});
  await servidor.reposo();
  await servidor.reposo();

  assert.deepEqual(a.ctl.resultado, { gano: true, abandono: true, ganador: a.ctl.uid, motivo: "abandono" });
  assert.deepEqual(b.ctl.resultado, { gano: false, abandono: true, ganador: a.ctl.uid, motivo: "abandono" });
  assert.equal(a.fines.length, 1);
  assert.equal(b.fines.length, 1);
  assert.equal(servidor.sala(codigo).motivo, "abandono");
  assert.equal(a.almacen.leer(), null);
  assert.equal(b.almacen.leer(), null);
  assert.deepEqual(a.ctl.verificacion, { ok: true });
  assert.match((await a.ctl.disparar(5, 5)).error, /no está en juego/);
});

test("abandonar antes de colocar la flota termina sin intentar revelarla", async () => {
  const servidor = crearServidorMemoria({ rnd: semilla(14) });
  const a = await cliente(servidor, "ana", 1, 2);
  const b = await cliente(servidor, "beto", 3, 4, { colocar: false });
  const { codigo } = await a.ctl.crearSala();
  await b.ctl.unirse(codigo);
  await servidor.reposo();
  await b.ctl.abandonar();
  await servidor.reposo();
  await servidor.reposo();
  assert.equal(a.ctl.resultado.gano, true);
  assert.equal(b.ctl.resultado.gano, false);
  assert.deepEqual(b.errores, []);
  assert.deepEqual(a.ctl.verificacion, { ok: true, vacia: true });
});

test("recarga a mitad de partida: se retoma con la flota privada y se sigue jugando", async () => {
  const { servidor, a, b, codigo } = await salaLista(24);
  await jugarHasta(servidor, a, b, { parar: (n) => n >= 25 });
  assert.equal(a.ctl.sala.fase, "jugando");
  assert.equal(b.almacen.leer(), codigo);

  // B recarga: cliente nuevo, mismo uid, tablero vacío; el código viene del almacenamiento.
  b.ctl.cerrar({ olvidar: false });
  const b2 = await cliente(servidor, "beto", 99, 98, { uid: b.ctl.uid, colocar: false });
  b2.almacen.guardar(b.almacen.leer());
  b2.ia = b.ia; // la IA de pruebas no forma parte del estado que se recupera
  assert.deepEqual(await b2.ctl.retomar(b2.almacen.leer()), { codigo, retomada: true });
  await servidor.reposo();

  assert.deepEqual(b2.usuario.tableroPropio.marcas, b.usuario.tableroPropio.marcas);
  assert.deepEqual(b2.usuario.tableroRival.marcas, b.usuario.tableroRival.marcas);
  assert.deepEqual(serializarFlota(b2.usuario), serializarFlota(b.usuario));
  assert.equal(b2.usuario.aciertos, b.usuario.aciertos);
  assert.equal(b2.ctl.estado.turno, a.ctl.estado.turno);
  assert.equal(b2.ctl.fase, "jugando");
  assert.equal(b2.ctl.listo, true);
  assert.equal(b2.ctl.hundidosRival.size, b.ctl.hundidosRival.size);
  assert.equal(b2.disparos.length, a.ctl.historial.length);
  assert.deepEqual(b2.errores, []);

  // La partida continúa hasta el final con B ya recargado y se verifica.
  await jugarHasta(servidor, a, b2);
  await servidor.reposo();
  await servidor.reposo();
  assert.equal(b2.fines.length, 1);
  assert.deepEqual(a.ctl.verificacion, { ok: true });
  assert.deepEqual(b2.ctl.verificacion, { ok: true });
});

test("recarga con un disparo del rival sin responder: se responde al retomar", async () => {
  const { servidor, a, b, codigo } = await salaLista(25);
  b.red.desconectar();
  await servidor.reposo();
  const [x, y] = a.ia.elegirDisparo();
  await a.ctl.disparar(x, y);
  await servidor.reposo();
  assert.ok(servidor.sala(codigo).pendiente);
  assert.equal(a.ctl.esperando, true);

  const b2 = await cliente(servidor, "beto", 99, 98, { uid: b.ctl.uid, colocar: false });
  await b2.ctl.retomar(codigo);
  await servidor.reposo();
  assert.equal(servidor.sala(codigo).pendiente, null);
  assert.equal(servidor.sala(codigo).historial.length, 1);
  assert.equal(a.ctl.esperando, false);
  assert.deepEqual(b2.errores, []);
});

test("retomar: sala inexistente o ajena limpia el código guardado", async () => {
  const { servidor, codigo } = await salaLista(26);
  const intruso = await cliente(servidor, "eva", 1, 2);
  intruso.almacen.guardar(codigo);
  assert.match((await intruso.ctl.retomar(codigo)).error, /No eres jugador/);
  assert.equal(intruso.almacen.leer(), null);
  intruso.almacen.guardar("ZZZZZ");
  assert.match((await intruso.ctl.retomar("ZZZZZ")).error, /no existe/);
  assert.equal(intruso.almacen.leer(), null);
});

test("un evento duplicado o tardío no repite el golpe ni da error", async () => {
  const servidor = crearServidorMemoria({ rnd: semilla(15) });
  const a = await cliente(servidor, "ana", 1, 2);
  // B espía la entrega de la sala para poder reenviar una versión antigua.
  const b = await cliente(servidor, "beto", 3, 4);
  let alSalaB = null;
  let vieja = null;
  const escuchar = b.red.escuchar;
  b.red.escuchar = (cb) => {
    alSalaB = cb;
    return escuchar((sala) => {
      if (sala?.pendiente) vieja = sala;
      return cb(sala);
    });
  };
  const { codigo } = await a.ctl.crearSala();
  await b.ctl.unirse(codigo);
  await a.ctl.marcarListo();
  await b.ctl.marcarListo();
  await servidor.reposo();

  const [bx, by] = b.usuario.flota.destructor.obtenerPosiciones()[0];
  await a.ctl.disparar(bx, by);
  await servidor.reposo(); // B responde
  assert.ok(vieja?.pendiente, "B vio el disparo pendiente");
  assert.equal(servidor.sala(codigo).historial.length, 1);

  await alSalaB(vieja); // llega otra vez el estado con el disparo pendiente
  await alSalaB(vieja);
  await servidor.reposo();
  assert.deepEqual(b.errores, []);
  assert.equal(servidor.sala(codigo).historial.length, 1);
  assert.equal(b.usuario.flota.destructor.estado, "tocado");
  assert.equal(b.usuario.tableroPropio.casillas[bx][by].contiene.casillas.get(`${bx},${by}`), "tocado");
});

test("sala que desaparece: se avisa y se olvida el código", async () => {
  const servidor = crearServidorMemoria({ rnd: semilla(16) });
  const a = await cliente(servidor, "ana", 1, 2);
  await a.ctl.crearSala();
  await servidor.reposo();
  a.ctl.cerrar({ olvidar: false });
  const a2 = await cliente(servidor, "ana", 1, 2, { uid: a.ctl.uid });
  let alSala;
  const escuchar2 = a2.red.escuchar;
  a2.red.escuchar = (f) => ((alSala = f), escuchar2(f));
  await a2.ctl.retomar(a.ctl.codigo);
  await servidor.reposo();
  await alSala(null);
  assert.equal(a2.ctl.perdida, true);
  assert.match(a2.errores.at(-1), /ya no existe/);
  assert.equal(a2.almacen.leer(), null);
});

test("rival fantasma y almacén: sin almacenamiento disponible no fallan", () => {
  const f = crearRivalFantasma("Rival");
  assert.equal(f.barcosAFlote(), 5);
  assert.equal(f.todosDesplegados(), false);
  const al = almacenSala("clave-de-prueba");
  assert.equal(al.leer(), null);
  al.guardar("ABCDE");
  al.borrar();
  // Con almacenamiento que lanza, tampoco.
  globalThis.sessionStorage = {
    getItem() { throw new Error("bloqueado"); },
    setItem() { throw new Error("bloqueado"); },
    removeItem() { throw new Error("bloqueado"); },
  };
  try {
    assert.equal(al.leer(), null);
    al.guardar("ABCDE");
    al.borrar();
  } finally {
    delete globalThis.sessionStorage;
  }
});
