import { test } from "node:test";
import assert from "node:assert/strict";
import { Horizontal, Vertical, FLOTA_ESTANDAR } from "../js/modelo.js";
import { Almirante } from "../js/ia.js";
import {
  ALFABETO_CODIGO,
  generarCodigo,
  normalizarCodigo,
  crearUsuarioLocal,
  serializarFlota,
  deserializarFlota,
  crearEstadoLocal,
  validarDisparo,
  resolverDisparo,
  aplicarSala,
  verificarHistorial,
} from "../js/protocolo.js";
import { crearServidorMemoria } from "./red-memoria.mjs";

function semilla(s) {
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Jugador simulado: red + estado local + (opcional) IA que elige los disparos.
// Reacciona a la sala como lo hará la interfaz: aplica lo nuevo y responde a los disparos pendientes.
async function crearJugador(servidor, nick, semFlota, semIA) {
  const red = servidor.crearRed();
  const uid = await red.entrar();
  const usuario = crearUsuarioLocal(nick);
  assert.equal(usuario.desplegarAleatorio(semilla(semFlota)), true);
  return {
    nick,
    red,
    uid,
    usuario,
    estado: crearEstadoLocal(uid, usuario),
    ia: new Almirante(10, "dificil", semilla(semIA)),
    nuevas: [],
    respondidos: 0,
  };
}

function conectar(j) {
  return j.red.escuchar(async (sala) => {
    const { nuevas, pendiente } = aplicarSala(j.estado, sala);
    j.nuevas.push(...nuevas);
    if (!pendiente) return;
    const r = resolverDisparo(j.usuario, pendiente.x, pendiente.y, j.uid, pendiente.de);
    assert.ok(!r.error, r.error);
    await j.red.responder(r.res, r.cambios);
    j.respondidos++;
  });
}

// Crea la sala, une al segundo jugador, despliegan y quedan listos. Devuelve { servidor, a, b, codigo }.
async function salaListaParaJugar(sem = 1) {
  const servidor = crearServidorMemoria({ rnd: semilla(sem) });
  const a = await crearJugador(servidor, "ana", sem + 10, sem + 20);
  const b = await crearJugador(servidor, "beto", sem + 11, sem + 21);
  const codigo = await a.red.crearSala("ana");
  await b.red.unirse(codigo, "beto");
  conectar(a);
  conectar(b);
  for (const j of [a, b]) {
    await j.red.guardarFlota(serializarFlota(j.usuario));
    await j.red.marcarListo();
  }
  await servidor.reposo();
  return { servidor, a, b, codigo };
}

const sin = (j, a, b) => (j === a ? b : a);

// ---------------------------------------------------------------- Piezas sueltas

test("los códigos de sala tienen 5 caracteres del alfabeto y son reproducibles con semilla", () => {
  assert.equal(ALFABETO_CODIGO, "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  const rnd = semilla(7);
  const vistos = new Set();
  for (let i = 0; i < 200; i++) {
    const c = generarCodigo(rnd);
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    vistos.add(c);
  }
  assert.ok(vistos.size > 190);
  assert.equal(generarCodigo(semilla(3)), generarCodigo(semilla(3)));
  assert.equal(normalizarCodigo(" ab2cd "), "AB2CD");
  assert.equal(normalizarCodigo("AB0CD"), null); // el 0 no está en el alfabeto
  assert.equal(normalizarCodigo("ABCD"), null);
});

test("serializar y deserializar la flota conserva posiciones y orientaciones", () => {
  const origen = crearUsuarioLocal("a");
  assert.equal(origen.desplegarAleatorio(semilla(5)), true);
  const datos = serializarFlota(origen);
  assert.deepEqual(Object.keys(datos), FLOTA_ESTANDAR.map((b) => b.nombre));
  assert.deepEqual(JSON.parse(JSON.stringify(datos)), datos); // apta para JSON/Firebase
  const copia = crearUsuarioLocal("b");
  assert.equal(deserializarFlota(datos, copia), true);
  for (const { nombre } of FLOTA_ESTANDAR) {
    assert.deepEqual(copia.flota[nombre].obtenerPosiciones(), origen.flota[nombre].obtenerPosiciones());
  }
  assert.deepEqual(serializarFlota(copia), datos);
});

test("deserializarFlota rechaza flotas incompletas, solapadas o con barcos pegados", () => {
  const base = crearUsuarioLocal("a");
  base.desplegarAleatorio(semilla(6));
  const datos = serializarFlota(base);
  const u = () => crearUsuarioLocal("x");

  const incompleta = { ...datos };
  delete incompleta.destructor;
  assert.equal(deserializarFlota(incompleta, u()), false);

  const pegados = structuredClone(datos);
  pegados.portaaviones = { x: 0, y: 0, ori: "horizontal" };
  pegados.acorazado = { x: 0, y: 1, ori: "horizontal" };
  assert.equal(deserializarFlota(pegados, u()), false);

  const fuera = structuredClone(datos);
  fuera.portaaviones = { x: 8, y: 0, ori: "horizontal" };
  assert.equal(deserializarFlota(fuera, u()), false);

  const rara = structuredClone(datos);
  rara.crucero.ori = "diagonal";
  assert.equal(deserializarFlota(rara, u()), false);
  assert.equal(deserializarFlota(null, u()), false);
  assert.equal(deserializarFlota(datos, u()), true);
});

test("resolverDisparo: agua pasa el turno, tocado lo mantiene y hundir el último cierra la partida", () => {
  const def = crearUsuarioLocal("def");
  def.colocarBarco("destructor", 0, 0, new Horizontal());
  def.colocarBarco("portaaviones", 0, 5, new Horizontal());
  def.colocarBarco("acorazado", 9, 0, new Vertical());
  def.colocarBarco("crucero", 4, 2, new Horizontal());
  def.colocarBarco("submarino", 4, 8, new Horizontal());

  let r = resolverDisparo(def, 7, 7, "def", "atq");
  assert.equal(r.res.estado, "agua");
  assert.deepEqual(r.cambios, { turno: "def" });

  r = resolverDisparo(def, 0, 0, "def", "atq");
  assert.equal(r.res.estado, "tocado");
  assert.deepEqual(r.cambios, { turno: "atq" });

  // Idempotente: repetir la misma casilla devuelve el mismo resultado sin volver a contar el golpe.
  assert.deepEqual(resolverDisparo(def, 0, 0, "def", "atq"), r);

  r = resolverDisparo(def, 1, 0, "def", "atq");
  assert.equal(r.res.estado, "hundido");
  assert.equal(r.res.barco.nombre, "destructor");
  assert.equal(r.cambios.fase, undefined);

  assert.ok(resolverDisparo(def, 10, 0, "def", "atq").error);

  // Se hunden las cuatro naves restantes: el último hundimiento cierra la partida.
  const todas = [
    [0, 5, 5, "horizontal"],
    [9, 0, 4, "vertical"],
    [4, 2, 3, "horizontal"],
    [4, 8, 3, "horizontal"],
  ];
  let ultimo;
  for (const [x, y, tam, ori] of todas) {
    for (let i = 0; i < tam; i++) {
      ultimo = resolverDisparo(def, ori === "horizontal" ? x + i : x, ori === "horizontal" ? y : y + i, "def", "atq");
    }
  }
  assert.equal(ultimo.res.estado, "hundido");
  assert.deepEqual(ultimo.cambios, { turno: "atq", fase: "final", ganador: "atq" });
});

// ---------------------------------------------------------------- Partida completa

test("partida completa: turnos, repetir tras acertar, fuera de turno, agua alrededor, ganador y verificación", async () => {
  const { servidor, a, b, codigo } = await salaListaParaJugar(1);

  let sala = servidor.sala(codigo);
  assert.equal(sala.fase, "jugando");
  assert.equal(sala.turno, a.uid);
  assert.equal(sala.creador, a.uid);
  assert.equal(sala.invitado, b.uid);

  // Fuera de turno: lo rechazan tanto la comprobación local como la red.
  assert.equal(validarDisparo(b.estado, 0, 0), "No es tu turno.");
  await assert.rejects(b.red.disparar(0, 0), /No es tu turno/);
  assert.equal(validarDisparo(a.estado, 10, 0), "Disparo fuera del tablero.");
  await assert.rejects(a.red.disparar(-1, 3), /fuera del tablero/);

  const jugadores = [a, b];
  let disparos = 0;
  let repeticiones = 0;
  let hundimientos = 0;
  while ((sala = servidor.sala(codigo)).fase !== "final") {
    const j = jugadores.find((p) => p.uid === sala.turno);
    const otro = sin(j, a, b);
    assert.equal(sala.pendiente, null);
    await assert.rejects(otro.red.disparar(0, 0), /No es tu turno/); // fuera de turno, siempre
    const [x, y] = j.ia.elegirDisparo();
    assert.equal(validarDisparo(j.estado, x, y), null);
    await j.red.disparar(x, y);

    await servidor.reposo();

    sala = servidor.sala(codigo);
    const entrada = sala.historial.at(-1);
    assert.deepEqual([entrada.de, entrada.x, entrada.y], [j.uid, x, y]);
    assert.equal(sala.n, sala.historial.length);
    assert.equal(sala.pendiente, null);
    disparos++;

    // Turno: el agua lo pasa, acertar lo conserva (salvo que la partida termine).
    if (entrada.estado === "agua") {
      assert.equal(sala.turno, otro.uid);
    } else {
      assert.equal(sala.turno, j.uid);
      repeticiones++;
    }

    // El atacante ve la casilla marcada y, si hunde, el agua de alrededor ya descubierta.
    const marca = j.usuario.tableroRival.obtenerMarca(x, y);
    assert.equal(marca, entrada.estado);
    if (entrada.estado === "hundido") {
      hundimientos++;
      for (const [px, py] of entrada.barco.posiciones) {
        assert.equal(j.usuario.tableroRival.obtenerMarca(px, py), "hundido");
      }
      assert.ok(entrada.alrededor.length >= 6);
      for (const [ax, ay] of entrada.alrededor) {
        assert.ok(j.usuario.tableroRival.obtenerMarca(ax, ay), `casilla ${ax},${ay} sin descubrir`);
        assert.notEqual(j.usuario.tableroRival.obtenerMarca(ax, ay), "tocado");
      }
      // Quien repite turno no puede volver a disparar en una casilla descubierta (lo impide el cliente).
      const [ax, ay] = entrada.alrededor[0];
      if (sala.fase !== "final") assert.equal(validarDisparo(j.estado, ax, ay), "Ya has disparado ahí.");
    }
    j.ia.registrar(entrada);
    assert.ok(disparos <= 200);
  }

  // Final de la partida.
  sala = servidor.sala(codigo);
  const ganador = jugadores.find((p) => p.uid === sala.ganador);
  const perdedor = sin(ganador, a, b);
  assert.ok(ganador, "hay ganador");
  assert.equal(sala.motivo, "flota hundida");
  assert.equal(hundimientos >= 5, true);
  assert.equal(perdedor.usuario.flotaHundida(), true);
  assert.equal(ganador.usuario.flotaHundida(), false);
  assert.equal(ganador.usuario.aciertos, 17);
  assert.equal(a.estado.fase, "final");
  assert.equal(b.estado.ganador, ganador.uid);
  assert.ok(repeticiones >= 17);
  await assert.rejects(ganador.red.disparar(0, 0), /no está en juego/);

  // Cada jugador revela su flota y el otro comprueba que sus respuestas cuadraban.
  await a.red.revelar(serializarFlota(a.usuario));
  await b.red.revelar(serializarFlota(b.usuario));
  await assert.rejects(a.red.revelar(serializarFlota(b.usuario)), /no coincide/);
  await servidor.reposo();
  sala = servidor.sala(codigo);
  assert.equal(Object.keys(sala.revelada).length, 2);
  assert.deepEqual(verificarHistorial(sala.historial, sala.revelada[b.uid], b.uid), { ok: true });
  assert.deepEqual(verificarHistorial(sala.historial, sala.revelada[a.uid], a.uid), { ok: true });

  // Los tableros locales de cada uno reflejan exactamente el historial (sin reaplicar nada por duplicado).
  assert.equal(a.usuario.disparos + b.usuario.disparos, sala.historial.length);
});

test("verificarHistorial detecta respuestas falsas del defensor", async () => {
  const { servidor, a, b, codigo } = await salaListaParaJugar(2);
  const jugadores = [a, b];
  let sala;
  while ((sala = servidor.sala(codigo)).fase !== "final") {
    const j = jugadores.find((p) => p.uid === sala.turno);
    const [x, y] = j.ia.elegirDisparo();
    await j.red.disparar(x, y);
    await servidor.reposo();
    j.ia.registrar(servidor.sala(codigo).historial.at(-1));
  }
  sala = servidor.sala(codigo);
  const flotaB = serializarFlota(b.usuario);
  const flotaA = serializarFlota(a.usuario);
  assert.deepEqual(verificarHistorial(sala.historial, flotaB, b.uid), { ok: true });

  // 1) B dice "agua" a un disparo que le había dado.
  const mentira = structuredClone(sala.historial);
  const i = mentira.findIndex((e) => e.de === a.uid && e.estado === "tocado");
  assert.ok(i >= 0);
  mentira[i].estado = "agua";
  let v = verificarHistorial(mentira, flotaB, b.uid);
  assert.equal(v.ok, false);
  assert.equal(v.indice, i);

  // 2) B dice "tocado" a un disparo que cayó en el agua.
  const mentira2 = structuredClone(sala.historial);
  const k = mentira2.findIndex((e) => e.de === a.uid && e.estado === "agua");
  mentira2[k].estado = "tocado";
  v = verificarHistorial(mentira2, flotaB, b.uid);
  assert.equal(v.ok, false);
  assert.equal(v.indice, k);

  // 3) B declara hundido un barco con otras posiciones o con otra agua alrededor.
  const mentira3 = structuredClone(sala.historial);
  const h = mentira3.findIndex((e) => e.de === a.uid && e.estado === "hundido");
  mentira3[h].barco.posiciones[0] = [9, 9];
  v = verificarHistorial(mentira3, flotaB, b.uid);
  assert.equal(v.ok, false);
  assert.equal(v.indice, h);
  const mentira4 = structuredClone(sala.historial);
  mentira4[h].alrededor.pop();
  assert.equal(verificarHistorial(mentira4, flotaB, b.uid).ok, false);

  // 4) Reveló una flota distinta de la usada: no cuadra con las respuestas.
  assert.equal(verificarHistorial(sala.historial, flotaA, b.uid).ok, false);

  // 5) Disparo repetido o turno incoherente en el historial.
  const repetido = structuredClone(sala.historial);
  repetido.splice(1, 0, structuredClone(repetido[0]));
  assert.equal(verificarHistorial(repetido, flotaB, b.uid).ok, false);

  // 6) Flota revelada inválida.
  assert.equal(verificarHistorial(sala.historial, { portaaviones: { x: 0, y: 0, ori: "horizontal" } }, b.uid).ok, false);
});

test("aplicarSala reconstruye los tableros al recargar la página", async () => {
  const { servidor, a, b, codigo } = await salaListaParaJugar(3);
  const jugadores = [a, b];
  for (let n = 0; n < 40; n++) {
    const sala = servidor.sala(codigo);
    if (sala.fase === "final") break;
    const j = jugadores.find((p) => p.uid === sala.turno);
    const [x, y] = j.ia.elegirDisparo();
    await j.red.disparar(x, y);
    await servidor.reposo();
    j.ia.registrar(servidor.sala(codigo).historial.at(-1));
  }
  // B "recarga": recupera su flota privada y la sala, y empieza con el estado vacío.
  const usuario = crearUsuarioLocal("beto");
  assert.equal(deserializarFlota(servidor.flotaPrivada(codigo, b.uid), usuario), true);
  const estado = crearEstadoLocal(b.uid, usuario);
  const { nuevas, pendiente } = aplicarSala(estado, servidor.sala(codigo));
  assert.equal(pendiente, null);
  assert.equal(nuevas.length, servidor.sala(codigo).historial.length);
  assert.deepEqual(usuario.tableroPropio.marcas, b.usuario.tableroPropio.marcas);
  assert.deepEqual(usuario.tableroRival.marcas, b.usuario.tableroRival.marcas);
  assert.equal(usuario.aciertos, b.usuario.aciertos);
  assert.equal(estado.turno, servidor.sala(codigo).turno);
});

// ---------------------------------------------------------------- Sala, abandono y desconexión

test("la sala no admite un tercer jugador ni salas inexistentes", async () => {
  const servidor = crearServidorMemoria({ rnd: semilla(4) });
  const a = servidor.crearRed();
  const b = servidor.crearRed();
  const c = servidor.crearRed();
  for (const r of [a, b, c]) await r.entrar();
  const codigo = await a.crearSala("ana");
  await assert.rejects(a.unirse(codigo, "ana2"), /creador/);
  await b.unirse(codigo, "beto");
  await assert.rejects(c.unirse(codigo, "carla"), /llena/);
  await assert.rejects(c.unirse("ZZZZZ", "carla"), /no existe/);
  assert.equal(servidor.sala(codigo).fase, "desplegando");
});

test("abandonar da la victoria al rival y cierra la partida", async () => {
  const { servidor, a, b, codigo } = await salaListaParaJugar(5);
  await a.red.disparar(0, 0);
  await servidor.reposo();
  await b.red.abandonar();
  await servidor.reposo();
  const sala = servidor.sala(codigo);
  assert.equal(sala.fase, "final");
  assert.equal(sala.ganador, a.uid);
  assert.equal(sala.motivo, "abandono");
  assert.equal(a.estado.fase, "final");
  assert.equal(a.estado.ganador, a.uid);
  assert.equal(a.estado.motivo, "abandono");
  await assert.rejects(a.red.disparar(5, 5), /no está en juego/);

  // Tras el abandono se puede revelar y el historial parcial sigue siendo coherente.
  await b.red.revelar(serializarFlota(b.usuario));
  await servidor.reposo();
  assert.deepEqual(verificarHistorial(servidor.sala(codigo).historial, servidor.sala(codigo).revelada[b.uid], b.uid), { ok: true });
});

test("una desconexión se ve en la sala y la partida continúa al reconectar", async () => {
  const { servidor, a, b, codigo } = await salaListaParaJugar(6);
  b.red.desconectar();
  await servidor.reposo();
  assert.equal(servidor.sala(codigo).jugadores[b.uid].conectado, false);
  assert.equal(a.nuevas.length, 0);

  // A dispara; B no se entera mientras está desconectado.
  const [x, y] = a.ia.elegirDisparo();
  await a.red.disparar(x, y);
  await servidor.reposo();
  let sala = servidor.sala(codigo);
  assert.deepEqual(sala.pendiente, { de: a.uid, x, y });
  assert.equal(b.respondidos, 0);
  await assert.rejects(b.red.responder({ estado: "agua" }, { turno: b.uid }), /Sin conexión/);
  await assert.rejects(a.red.disparar((x + 1) % 10, y), /pendiente/);

  // B reconecta, recibe el disparo pendiente y lo responde.
  b.red.reconectar();
  await servidor.reposo();
  sala = servidor.sala(codigo);
  assert.equal(sala.jugadores[b.uid].conectado, true);
  assert.equal(sala.pendiente, null);
  assert.equal(sala.historial.length, 1);
  assert.equal(b.respondidos, 1);
  assert.equal(a.estado.n, 1);
});

test("si la respuesta no llegó a escribirse, el defensor puede reenviarla sin repetir el golpe", async () => {
  const { servidor, a, b, codigo } = await salaListaParaJugar(7);
  // Buscamos un disparo que dé en un barco de B para comprobar que no cuenta dos veces.
  const [bx, by] = b.usuario.flota.destructor.obtenerPosiciones()[0];
  const res = resolverDisparo(b.usuario, bx, by, b.uid, a.uid); // aplicado en local, sin escribir
  assert.equal(res.res.estado, "tocado");
  await a.red.disparar(bx, by);
  await servidor.reposo(); // B responde solo desde su escuchador: debe reconstruir el mismo "tocado"
  const sala = servidor.sala(codigo);
  assert.equal(sala.historial.length, 1);
  assert.equal(sala.historial[0].estado, "tocado");
  assert.equal(b.usuario.flota.destructor.estado, "tocado");
  assert.equal(sala.turno, a.uid);
});
