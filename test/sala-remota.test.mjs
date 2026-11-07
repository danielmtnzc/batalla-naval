import { test } from "node:test";
import assert from "node:assert/strict";
import { Almirante } from "../js/ia.js";
import { crearUsuarioLocal, serializarFlota, crearEstadoLocal, aplicarSala, resolverDisparo } from "../js/protocolo.js";
import { normalizarSala, salaNueva, entradaHistorial, mismaFlota, mensajeError, limpiarNick } from "../js/sala-remota.js";
import { crearServidorMemoria } from "./red-memoria.mjs";

function semilla(s) {
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Simula cómo guarda y devuelve Firebase un valor: sin null, sin arrays/objetos vacíos y,
// opcionalmente, con los arrays convertidos en objetos {0: .., 1: ..} y las claves ordenadas.
function comoFirebase(v, comoObjeto = false) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const items = v.map((e) => comoFirebase(e, comoObjeto));
    if (!items.length) return undefined;
    return comoObjeto ? Object.fromEntries(items.map((e, i) => [String(i), e])) : items;
  }
  if (typeof v === "object") {
    const salida = {};
    for (const k of Object.keys(v).sort()) {
      const e = comoFirebase(v[k], comoObjeto);
      if (e !== undefined) salida[k] = e;
    }
    return Object.keys(salida).length ? salida : undefined;
  }
  return v;
}

async function partidaTerminada(sem) {
  const servidor = crearServidorMemoria({ rnd: semilla(sem) });
  const jugadores = [];
  for (const nick of ["ana", "beto"]) {
    const red = servidor.crearRed();
    const uid = await red.entrar();
    const usuario = crearUsuarioLocal(nick);
    usuario.desplegarAleatorio(semilla(sem + nick.length));
    jugadores.push({ red, uid, usuario, estado: crearEstadoLocal(uid, usuario), ia: new Almirante(10, "dificil", semilla(sem + 5)) });
  }
  const [a, b] = jugadores;
  const codigo = await a.red.crearSala("ana");
  const salas = [servidor.sala(codigo)];
  await b.red.unirse(codigo, "beto");
  for (const j of jugadores) {
    j.red.escuchar(async (sala) => {
      const { pendiente } = aplicarSala(j.estado, sala);
      if (!pendiente) return;
      const r = resolverDisparo(j.usuario, pendiente.x, pendiente.y, j.uid, pendiente.de);
      await j.red.responder(r.res, r.cambios);
    });
  }
  for (const j of jugadores) {
    await j.red.guardarFlota(serializarFlota(j.usuario));
    await j.red.marcarListo();
  }
  await servidor.reposo();
  let sala;
  while ((sala = servidor.sala(codigo)).fase !== "final") {
    const j = jugadores.find((p) => p.uid === sala.turno);
    await j.red.disparar(...j.ia.elegirDisparo());
    salas.push(servidor.sala(codigo)); // con `pendiente`
    await servidor.reposo();
    j.ia.registrar(servidor.sala(codigo).historial.at(-1));
  }
  for (const j of jugadores) await j.red.revelar(serializarFlota(j.usuario));
  salas.push(servidor.sala(codigo));
  return { salas, a, b };
}

test("normalizarSala devuelve la misma sala que la red en memoria tras pasar por Firebase", async () => {
  const { salas } = await partidaTerminada(11);
  assert.ok(salas.length > 20);
  for (const original of salas) {
    assert.deepEqual(normalizarSala(comoFirebase(original)), original);
    assert.deepEqual(normalizarSala(comoFirebase(original, true)), original);
  }
  assert.equal(normalizarSala(null), null);
  assert.equal(normalizarSala(undefined), null);
});

test("salaNueva y entradaHistorial producen datos aptos para Firebase y coherentes con la memoria", () => {
  const nueva = salaNueva("u1", "  ana  ");
  assert.deepEqual(normalizarSala(nueva), {
    creador: "u1",
    invitado: null,
    fase: "esperando",
    turno: null,
    ganador: null,
    motivo: null,
    n: 0,
    jugadores: { u1: { nick: "ana", listo: false, conectado: true } },
    pendiente: null,
    historial: [],
    revelada: {},
  });
  assert.equal(limpiarNick(""), "Capitán");
  assert.equal(limpiarNick("x".repeat(40)).length, 20);

  const p = { de: "u1", x: 3, y: 4 };
  assert.deepEqual(entradaHistorial(p, { estado: "agua" }), { de: "u1", x: 3, y: 4, estado: "agua" });
  const hundido = entradaHistorial(p, {
    estado: "hundido",
    barco: { nombre: "destructor", tam: 2, posiciones: [[3, 4], [4, 4]], extra: 1 },
  });
  assert.deepEqual(hundido.barco, { nombre: "destructor", tam: 2, posiciones: [[3, 4], [4, 4]] });
  assert.ok(!JSON.stringify(hundido).includes("undefined"));
});

test("mismaFlota no depende del orden de las claves y mensajeError traduce los errores", async () => {
  const { a, b } = await partidaTerminada(12);
  const fa = serializarFlota(a.usuario);
  assert.equal(mismaFlota(fa, comoFirebase(fa)), true);
  assert.equal(mismaFlota(fa, serializarFlota(b.usuario)), false);
  assert.equal(mismaFlota(fa, null), false);

  assert.match(mensajeError({ code: "PERMISSION_DENIED", message: "PERMISSION_DENIED: Permission denied" }), /rechazado/);
  assert.equal(mensajeError({ code: "auth/network-request-failed" }), "Sin conexión.");
  assert.match(mensajeError({ code: "auth/operation-not-allowed" }), /anónimo/);
});
