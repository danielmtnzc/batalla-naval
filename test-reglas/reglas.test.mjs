// Pruebas de database.rules.json contra el emulador de Realtime Database.
// Se ejecutan con `npm test` desde test-reglas/ (ver docs/claude/comandos.md); necesitan el emulador
// en marcha (firebase emulators:exec lo arranca y fija FIREBASE_DATABASE_EMULATOR_HOST).

import { describe, it, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { ref, set, get, update, remove } from "firebase/database";

import { crearUsuarioLocal, serializarFlota } from "../js/protocolo.js";
import { salaNueva, entradaHistorial } from "../js/sala-remota.js";

const COD = "ABCDE";
const A = "alice"; // creador
const B = "bob"; // invitado
const C = "carol"; // tercero ajeno a la sala

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-batalla-naval",
    database: { rules: readFileSync(fileURLToPath(new URL("../database.rules.json", import.meta.url)), "utf8") },
  });
});
after(async () => env.cleanup());
beforeEach(async () => env.clearDatabase());

// ---------------------------------------------------------------- Helpers

const db = (uid) => (uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database());
const sala = (d, cod = COD) => ref(d, `salas/${cod}`);
const sembrar = (ruta, datos) =>
  env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), ruta), datos));
// withSecurityRulesDisabled devuelve void: el valor leído hay que sacarlo por una variable.
const leerSembrado = async (ruta) => {
  let valor;
  await env.withSecurityRulesDisabled(async (ctx) => {
    valor = (await get(ref(ctx.database(), ruta))).val();
  });
  return valor;
};

// Flota real (colocada con el modelo) para que los datos sean los que escribiría la aplicación.
function flotaReal(semilla = 7) {
  let s = semilla;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const usr = crearUsuarioLocal("test");
  if (!usr.desplegarAleatorio(rnd)) throw new Error("No se pudo desplegar la flota de prueba.");
  return serializarFlota(usr);
}
const FLOTA_A = flotaReal(7);
const FLOTA_B = flotaReal(11);

const jugador = (nick, listo = false) => ({ nick, listo, conectado: true });
const salaEsperando = () => salaNueva(A, "Ana");
const salaDesplegando = (extra = {}) => ({
  creador: A,
  invitado: B,
  fase: "desplegando",
  n: 0,
  jugadores: { [A]: jugador("Ana"), [B]: jugador("Beto") },
  ...extra,
});
const salaJugando = (extra = {}) => ({
  ...salaDesplegando({ turno: A }),
  fase: "jugando",
  jugadores: { [A]: jugador("Ana", true), [B]: jugador("Beto", true) },
  ...extra,
});
const salaConPendiente = (p = { de: A, x: 3, y: 4 }, extra = {}) => salaJugando({ pendiente: p, ...extra });

const sembrarEsperando = () => sembrar(`salas/${COD}`, salaEsperando());
const sembrarDesplegando = () => sembrar(`salas/${COD}`, salaDesplegando());
const sembrarJugando = () => sembrar(`salas/${COD}`, salaJugando());
const sembrarConPendiente = (p, extra) => sembrar(`salas/${COD}`, salaConPendiente(p, extra));
const sembrarFlotas = () =>
  sembrar(`flotas/${COD}`, { [A]: FLOTA_A, [B]: FLOTA_B });

// Escritura multi-ruta del defensor, como la hace Red.responder.
// `res.crudo` escribe los campos tal cual (sin pasar por entradaHistorial, que normaliza y
// descartaría justo los datos inválidos que se quieren probar).
const respuesta = (p, res, { n = 0, turno = B, final = false, ganador } = {}) => {
  const e = {
    [`historial/${n}`]: res.crudo ? { de: p.de, x: p.x, y: p.y, ...res.crudo } : entradaHistorial(p, res),
    n: n + 1,
    pendiente: null,
    turno,
  };
  if (final) Object.assign(e, { fase: "final", ganador: ganador ?? p.de, motivo: "flota hundida" });
  return e;
};
const AGUA = { estado: "agua" };
const TOCADO = { estado: "tocado" };
const HUNDIDO = {
  estado: "hundido",
  barco: { nombre: "destructor", tam: 2, posiciones: [[3, 4], [4, 4]] },
  alrededor: [[2, 3], [2, 4], [2, 5], [3, 3], [3, 5], [4, 3], [4, 5], [5, 3], [5, 4], [5, 5]],
};

// ---------------------------------------------------------------- Crear sala

describe("crear sala", () => {
  it("el creador autenticado puede crear una sala válida", async () => {
    await assertSucceeds(set(sala(db(A)), salaEsperando()));
  });

  it("sin autenticación no se puede crear", async () => {
    await assertFails(set(sala(db(null)), salaEsperando()));
  });

  for (const cod of ["ABCD", "ABCDEF", "abcde", "ABCD0", "ABCDI", "ABCDL", "ABCDO", "ABCD1"]) {
    it(`código mal formado "${cod}" falla`, async () => {
      await assertFails(set(sala(db(A), cod), salaEsperando()));
    });
  }

  it("la fase inicial debe ser esperando", async () => {
    for (const fase of ["desplegando", "jugando", "final"]) {
      await assertFails(set(sala(db(A)), { ...salaEsperando(), fase }));
    }
  });

  it("n debe ser 0", async () => {
    await assertFails(set(sala(db(A)), { ...salaEsperando(), n: 1 }));
  });

  it("el creador de la sala debe ser quien escribe", async () => {
    await assertFails(set(sala(db(C)), salaEsperando()));
  });

  it("campos extra no permitidos", async () => {
    await assertFails(set(sala(db(A)), { ...salaEsperando(), extra: 1 }));
    await assertFails(set(sala(db(A)), { ...salaEsperando(), invitado: B }));
    await assertFails(set(sala(db(A)), { ...salaEsperando(), turno: A }));
    await assertFails(set(sala(db(A)), { ...salaEsperando(), ganador: A }));
    await assertFails(set(sala(db(A)), { ...salaEsperando(), pendiente: { de: A, x: 0, y: 0 } }));
  });

  it("el creador debe aparecer como jugador no listo y conectado", async () => {
    const base = salaEsperando();
    await assertFails(set(sala(db(A)), { ...base, jugadores: { [A]: jugador("Ana", true) } }));
    await assertFails(set(sala(db(A)), { ...base, jugadores: { [A]: { nick: "Ana", listo: false, conectado: false } } }));
    await assertFails(set(sala(db(A)), { ...base, jugadores: { [A]: { ...jugador("Ana"), extra: 1 } } }));
    await assertFails(set(sala(db(A)), { ...base, jugadores: { [A]: jugador("N".repeat(21)) } }));
  });

  it("no se puede sobrescribir una sala existente (ni con el mismo creador)", async () => {
    await sembrarEsperando();
    await assertFails(set(sala(db(A)), salaEsperando()));
    await assertFails(set(sala(db(C)), { ...salaEsperando(), creador: C, jugadores: { [C]: jugador("Carlos") } }));
  });

  it("el creador puede borrar su sala mientras espera rival", async () => {
    await sembrarEsperando();
    await assertSucceeds(remove(sala(db(A))));
  });

  it("nadie más puede borrarla, ni el creador una vez hay invitado", async () => {
    await sembrarEsperando();
    await assertFails(remove(sala(db(C))));
    await sembrarDesplegando();
    await assertFails(remove(sala(db(A))));
  });
});

// ---------------------------------------------------------------- Unirse

describe("unirse como invitado", () => {
  const unirse = (uid, nick = "Beto") =>
    update(sala(db(uid)), {
      invitado: uid,
      fase: "desplegando",
      [`jugadores/${uid}`]: jugador(nick),
    });

  it("un jugador ajeno se une a una sala que espera", async () => {
    await sembrarEsperando();
    await assertSucceeds(unirse(B));
    const s = await leerSembrado(`salas/${COD}`);
    if (s.invitado !== B || s.fase !== "desplegando") throw new Error("La sala no quedó como se esperaba.");
  });

  it("sin autenticación no puede unirse", async () => {
    await sembrarEsperando();
    await assertFails(update(sala(db(null)), { invitado: B, fase: "desplegando", [`jugadores/${B}`]: jugador("Beto") }));
  });

  it("el creador no puede unirse a su propia sala", async () => {
    await sembrarEsperando();
    await assertFails(unirse(A));
  });

  it("no se puede unir a una sala ya ocupada", async () => {
    await sembrarDesplegando();
    await assertFails(unirse(C, "Carlos"));
  });

  it("no se puede unir a una sala que ya juega o ha terminado", async () => {
    await sembrarJugando();
    await assertFails(unirse(C, "Carlos"));
    await sembrar(`salas/${COD}`, { ...salaJugando(), fase: "final", motivo: "abandono", ganador: A, turno: null });
    await assertFails(unirse(C, "Carlos"));
  });

  it("no se puede inscribir a otro como invitado", async () => {
    await sembrarEsperando();
    await assertFails(
      update(sala(db(B)), { invitado: C, fase: "desplegando", [`jugadores/${C}`]: jugador("Carlos") })
    );
    await assertFails(
      update(sala(db(B)), { invitado: B, fase: "desplegando", [`jugadores/${C}`]: jugador("Carlos") })
    );
  });

  it("unirse exige pasar a desplegando y crear su ficha de jugador", async () => {
    await sembrarEsperando();
    await assertFails(update(sala(db(B)), { invitado: B, [`jugadores/${B}`]: jugador("Beto") }));
    await assertFails(update(sala(db(B)), { invitado: B, fase: "desplegando" }));
    await assertFails(update(sala(db(B)), { fase: "desplegando", [`jugadores/${B}`]: jugador("Beto") }));
  });

  it("la ficha del invitado debe entrar no lista y con campos válidos", async () => {
    await sembrarEsperando();
    await assertFails(
      update(sala(db(B)), { invitado: B, fase: "desplegando", [`jugadores/${B}`]: { nick: "", listo: false, conectado: true } })
    );
    await assertFails(
      update(sala(db(B)), { invitado: B, fase: "desplegando", [`jugadores/${B}`]: { nick: "Beto", listo: false } })
    );
  });
});

// ---------------------------------------------------------------- Flotas

describe("guardar y leer flota", () => {
  const flotaRuta = (d, uid, cod = COD) => ref(d, `flotas/${cod}/${uid}`);

  it("el dueño guarda su flota en desplegando", async () => {
    await sembrarDesplegando();
    await assertSucceeds(set(flotaRuta(db(A), A), FLOTA_A));
    await assertSucceeds(set(flotaRuta(db(B), B), FLOTA_B));
  });

  it("puede volver a guardarla (recolocar) mientras no esté listo", async () => {
    await sembrarDesplegando();
    await assertSucceeds(set(flotaRuta(db(A), A), FLOTA_A));
    await assertSucceeds(set(flotaRuta(db(A), A), FLOTA_B));
  });

  it("no se puede cambiar una vez marcado listo", async () => {
    await sembrar(`salas/${COD}`, {
      ...salaDesplegando(),
      jugadores: { [A]: jugador("Ana", true), [B]: jugador("Beto") },
    });
    await assertFails(set(flotaRuta(db(A), A), FLOTA_A));
  });

  it("solo en la fase desplegando", async () => {
    await sembrarEsperando();
    await assertFails(set(flotaRuta(db(A), A), FLOTA_A));
    await sembrarJugando();
    await assertFails(set(flotaRuta(db(A), A), FLOTA_A));
    await sembrar(`salas/${COD}`, { ...salaJugando(), fase: "final", motivo: "abandono", ganador: B });
    await assertFails(set(flotaRuta(db(A), A), FLOTA_A));
  });

  it("no se puede guardar en una sala que no existe", async () => {
    await assertFails(set(flotaRuta(db(A), A, "ZZZZZ"), FLOTA_A));
  });

  it("nadie escribe la flota de otro (ni un tercero ni el rival)", async () => {
    await sembrarDesplegando();
    await assertFails(set(flotaRuta(db(B), A), FLOTA_A));
    await assertFails(set(flotaRuta(db(C), A), FLOTA_A));
    await assertFails(set(flotaRuta(db(null), A), FLOTA_A));
  });

  it("flotas con datos inválidos se rechazan", async () => {
    await sembrarDesplegando();
    const sinBarco = { ...FLOTA_A };
    delete sinBarco.destructor;
    await assertFails(set(flotaRuta(db(A), A), sinBarco));
    await assertFails(set(flotaRuta(db(A), A), { ...FLOTA_A, crucero: { x: 10, y: 0, ori: "horizontal" } }));
    await assertFails(set(flotaRuta(db(A), A), { ...FLOTA_A, crucero: { x: -1, y: 0, ori: "horizontal" } }));
    await assertFails(set(flotaRuta(db(A), A), { ...FLOTA_A, crucero: { x: 1.5, y: 0, ori: "horizontal" } }));
    await assertFails(set(flotaRuta(db(A), A), { ...FLOTA_A, crucero: { x: 1, y: 0, ori: "diagonal" } }));
    await assertFails(set(flotaRuta(db(A), A), { ...FLOTA_A, fragata: { x: 1, y: 0, ori: "vertical" } }));
    await assertFails(set(flotaRuta(db(A), A), { ...FLOTA_A, crucero: { ...FLOTA_A.crucero, extra: 1 } }));
  });

  it("solo el dueño lee su flota", async () => {
    await sembrarDesplegando();
    await sembrarFlotas();
    await assertSucceeds(get(flotaRuta(db(A), A)));
    await assertSucceeds(get(flotaRuta(db(B), B)));
    await assertFails(get(flotaRuta(db(B), A)));
    await assertFails(get(flotaRuta(db(A), B)));
    await assertFails(get(flotaRuta(db(C), A)));
    await assertFails(get(flotaRuta(db(null), A)));
  });

  it("no se pueden listar las flotas de la sala ni todas las flotas", async () => {
    await sembrarDesplegando();
    await sembrarFlotas();
    await assertFails(get(ref(db(A), `flotas/${COD}`)));
    await assertFails(get(ref(db(A), "flotas")));
    await assertFails(get(ref(db(A), "/")));
  });
});

// ---------------------------------------------------------------- Marcar listo

describe("marcar listo", () => {
  const listo = (uid, extra = {}) => update(sala(db(uid)), { [`jugadores/${uid}/listo`]: true, ...extra });

  it("exige tener la flota guardada", async () => {
    await sembrarDesplegando();
    await assertFails(listo(A));
    await sembrar(`flotas/${COD}/${A}`, FLOTA_A);
    await assertSucceeds(listo(A));
  });

  it("solo uno mismo puede marcarse listo", async () => {
    await sembrarDesplegando();
    await sembrarFlotas();
    await assertFails(listo(C));
    await assertFails(update(sala(db(A)), { [`jugadores/${B}/listo`]: true }));
    await assertFails(update(sala(db(null)), { [`jugadores/${A}/listo`]: true }));
  });

  it("solo en la fase desplegando", async () => {
    await sembrarFlotas();
    await sembrarEsperando();
    await assertFails(listo(A));
    await sembrarJugando();
    await sembrar(`salas/${COD}/jugadores/${A}/listo`, false);
    await assertFails(listo(A));
  });

  it("no se puede desmarcar", async () => {
    await sembrarFlotas();
    await sembrar(`salas/${COD}`, {
      ...salaDesplegando(),
      jugadores: { [A]: jugador("Ana", true), [B]: jugador("Beto") },
    });
    await assertFails(update(sala(db(A)), { [`jugadores/${A}/listo`]: false }));
  });

  it("cuando el rival ya estaba listo, marcarse listo empieza la partida (fase, turno = creador)", async () => {
    await sembrarFlotas();
    await sembrar(`salas/${COD}`, {
      ...salaDesplegando(),
      jugadores: { [A]: jugador("Ana", true), [B]: jugador("Beto") },
    });
    await assertSucceeds(listo(B, { fase: "jugando", turno: A }));
  });

  it("no se empieza la partida si el rival no está listo", async () => {
    await sembrarDesplegando();
    await sembrarFlotas();
    await assertFails(listo(B, { fase: "jugando", turno: A }));
  });

  it("el turno inicial debe ser el creador", async () => {
    await sembrarFlotas();
    await sembrar(`salas/${COD}`, {
      ...salaDesplegando(),
      jugadores: { [A]: jugador("Ana", true), [B]: jugador("Beto") },
    });
    await assertFails(listo(B, { fase: "jugando", turno: B }));
  });

  it("un tercero no puede empezar la partida", async () => {
    await sembrarFlotas();
    await sembrar(`salas/${COD}`, {
      ...salaDesplegando(),
      jugadores: { [A]: jugador("Ana", true), [B]: jugador("Beto", true) },
    });
    await assertFails(update(sala(db(C)), { fase: "jugando", turno: A }));
  });

  it("si los dos marcaron a la vez, cualquiera de los dos puede empezar (alCambiarSala)", async () => {
    await sembrarFlotas();
    await sembrar(`salas/${COD}`, {
      ...salaDesplegando(),
      jugadores: { [A]: jugador("Ana", true), [B]: jugador("Beto", true) },
    });
    await assertSucceeds(update(sala(db(B)), { fase: "jugando", turno: A }));
  });
});

// ---------------------------------------------------------------- Disparo

describe("disparo (pendiente)", () => {
  const disparar = (uid, p) => set(ref(db(uid), `salas/${COD}/pendiente`), p);

  it("el jugador del turno dispara", async () => {
    await sembrarJugando();
    await assertSucceeds(disparar(A, { de: A, x: 3, y: 4 }));
  });

  it("acepta las esquinas del tablero", async () => {
    await sembrarJugando();
    await assertSucceeds(disparar(A, { de: A, x: 0, y: 9 }));
    await sembrarJugando();
    await assertSucceeds(disparar(A, { de: A, x: 9, y: 0 }));
  });

  it("quien no tiene el turno no puede disparar", async () => {
    await sembrarJugando();
    await assertFails(disparar(B, { de: B, x: 3, y: 4 }));
  });

  it("un tercero o un anónimo no pueden disparar", async () => {
    await sembrarJugando();
    await assertFails(disparar(C, { de: C, x: 3, y: 4 }));
    await assertFails(disparar(null, { de: A, x: 3, y: 4 }));
  });

  it("no se puede disparar suplantando al rival", async () => {
    await sembrarJugando();
    await assertFails(disparar(A, { de: B, x: 3, y: 4 }));
  });

  it("coordenadas fuera de 0-9 o no enteras fallan", async () => {
    await sembrarJugando();
    for (const [x, y] of [[10, 0], [0, 10], [-1, 0], [0, -1], [1.5, 0], [0, 2.5], [100, 100]]) {
      await assertFails(disparar(A, { de: A, x, y }));
    }
    await assertFails(disparar(A, { de: A, x: "3", y: 4 }));
    await assertFails(disparar(A, { de: A, x: 3 }));
  });

  it("campos extra en el disparo fallan", async () => {
    await sembrarJugando();
    await assertFails(disparar(A, { de: A, x: 3, y: 4, estado: "agua" }));
  });

  it("no se puede disparar fuera de la fase jugando", async () => {
    await sembrarDesplegando();
    await assertFails(disparar(A, { de: A, x: 3, y: 4 }));
    await sembrar(`salas/${COD}`, { ...salaJugando(), fase: "final", motivo: "abandono", ganador: B });
    await assertFails(disparar(A, { de: A, x: 3, y: 4 }));
  });

  it("no se puede disparar con otro disparo pendiente, ni cambiarlo ni borrarlo", async () => {
    await sembrarConPendiente();
    await assertFails(disparar(A, { de: A, x: 5, y: 5 }));
    await assertFails(remove(ref(db(A), `salas/${COD}/pendiente`)));
    await assertFails(remove(ref(db(B), `salas/${COD}/pendiente`)));
  });
});

// ---------------------------------------------------------------- Respuesta del defensor

describe("respuesta del defensor (multi-ruta)", () => {
  const P = { de: A, x: 3, y: 4 };
  const responder = (uid, escritura) => update(sala(db(uid)), escritura);

  it("agua: historial/n, n+1, pendiente=null y el turno pasa al defensor", async () => {
    await sembrarConPendiente();
    await assertSucceeds(responder(B, respuesta(P, AGUA, { turno: B })));
    const s = await leerSembrado(`salas/${COD}`);
    if (s.n !== 1 || s.pendiente || s.turno !== B || s.historial[0].estado !== "agua") {
      throw new Error(`Sala inesperada: ${JSON.stringify(s)}`);
    }
  });

  it("tocado: el turno se mantiene en el atacante", async () => {
    await sembrarConPendiente();
    await assertSucceeds(responder(B, respuesta(P, TOCADO, { turno: A })));
  });

  it("hundido con barco y alrededor", async () => {
    await sembrarConPendiente();
    await assertSucceeds(responder(B, respuesta(P, HUNDIDO, { turno: A })));
  });

  it("la segunda respuesta usa n=1 (secuencia de disparos)", async () => {
    await sembrarConPendiente();
    await responder(B, respuesta(P, AGUA, { turno: B }));
    await assertSucceeds(set(ref(db(B), `salas/${COD}/pendiente`), { de: B, x: 0, y: 0 }));
    await assertSucceeds(responder(A, respuesta({ de: B, x: 0, y: 0 }, TOCADO, { n: 1, turno: B })));
  });

  it("el atacante no puede resolver su propio disparo", async () => {
    await sembrarConPendiente();
    await assertFails(responder(A, respuesta(P, AGUA, { turno: B })));
    await assertFails(responder(A, respuesta(P, TOCADO, { turno: A })));
  });

  it("un tercero o un anónimo no pueden responder", async () => {
    await sembrarConPendiente();
    await assertFails(responder(C, respuesta(P, AGUA)));
    await assertFails(responder(null, respuesta(P, AGUA)));
  });

  it("sin disparo pendiente no se puede responder", async () => {
    await sembrarJugando();
    await assertFails(responder(B, respuesta(P, AGUA)));
  });

  it("n debe subir exactamente 1", async () => {
    await sembrarConPendiente();
    for (const n of [0, 2, 5, -1]) {
      const e = respuesta(P, AGUA);
      e.n = n;
      await assertFails(responder(B, e));
    }
    const e = respuesta(P, AGUA);
    e.n = 1.5;
    await assertFails(responder(B, e));
  });

  it("la respuesta debe incluir n, pendiente=null y la entrada del historial", async () => {
    await sembrarConPendiente();
    const e = respuesta(P, AGUA);
    delete e.n;
    await assertFails(responder(B, e));
    const f = respuesta(P, AGUA);
    delete f.pendiente;
    await assertFails(responder(B, f));
    const g = respuesta(P, AGUA);
    delete g["historial/0"];
    await assertFails(responder(B, g));
  });

  it("estado inválido", async () => {
    await sembrarConPendiente();
    await assertFails(responder(B, respuesta(P, { estado: "explotado" })));
    await assertFails(responder(B, respuesta(P, { estado: "" })));
  });

  it("hundido exige el barco", async () => {
    await sembrarConPendiente();
    await assertFails(responder(B, respuesta(P, { crudo: { estado: "hundido" } })));
    await assertFails(responder(B, respuesta(P, { crudo: { estado: "hundido", alrededor: HUNDIDO.alrededor } })));
  });

  it("agua o tocado con barco o alrededor", async () => {
    await sembrarConPendiente();
    await assertFails(responder(B, respuesta(P, { crudo: { estado: "agua", barco: HUNDIDO.barco } })));
    await assertFails(responder(B, respuesta(P, { crudo: { estado: "tocado", alrededor: HUNDIDO.alrededor } })));
  });

  it("barco hundido con datos inválidos", async () => {
    await sembrarConPendiente();
    const con = (barco) =>
      respuesta(P, { crudo: { estado: "hundido", barco, alrededor: HUNDIDO.alrededor } });
    await assertFails(responder(B, con({ ...HUNDIDO.barco, nombre: "fragata" })));
    await assertFails(responder(B, con({ ...HUNDIDO.barco, tam: 6 })));
    await assertFails(responder(B, con({ ...HUNDIDO.barco, tam: 1 })));
    await assertFails(responder(B, con({ ...HUNDIDO.barco, posiciones: [[3, 10], [4, 4]] })));
    await assertFails(responder(B, con({ ...HUNDIDO.barco, posiciones: [[3, 4, 5]] })));
    await assertFails(
      responder(B, respuesta(P, { crudo: { estado: "hundido", barco: HUNDIDO.barco, alrededor: [[3, -1]] } })),
    );
  });

  it("la entrada del historial debe coincidir con el disparo pendiente", async () => {
    await sembrarConPendiente();
    await assertFails(responder(B, respuesta({ de: A, x: 5, y: 4 }, AGUA)));
    await assertFails(responder(B, respuesta({ de: A, x: 3, y: 5 }, AGUA)));
    await assertFails(responder(B, respuesta({ de: B, x: 3, y: 4 }, AGUA)));
  });

  it("la entrada del historial no admite campos extra", async () => {
    await sembrarConPendiente();
    const e = respuesta(P, AGUA);
    e["historial/0"].extra = 1;
    await assertFails(responder(B, e));
  });

  it("el índice del historial debe ser n (no se puede escribir en otra posición)", async () => {
    await sembrarConPendiente();
    const e = respuesta(P, AGUA);
    e["historial/7"] = e["historial/0"];
    delete e["historial/0"];
    await assertFails(responder(B, e));
  });

  it("no se puede reescribir una entrada ya existente del historial", async () => {
    await sembrar(`salas/${COD}`, {
      ...salaConPendiente({ de: B, x: 0, y: 0 }, { n: 1, historial: { 0: entradaHistorial(P, AGUA) } }),
    });
    const e = respuesta({ de: B, x: 0, y: 0 }, AGUA, { n: 1, turno: A });
    e["historial/0"] = entradaHistorial({ de: B, x: 0, y: 0 }, AGUA);
    delete e["historial/1"];
    e.n = 2;
    await assertFails(responder(A, e));
  });

  it("el turno resultante debe ser uno de los dos jugadores", async () => {
    await sembrarConPendiente();
    await assertFails(responder(B, respuesta(P, AGUA, { turno: C })));
  });

  it("no se puede responder sin actualizar el turno", async () => {
    await sembrarConPendiente();
    const e = respuesta(P, AGUA);
    delete e.turno;
    // Sin turno el cliente real nunca lo hace; se documenta lo que decidan las reglas.
    await assertSucceeds(responder(B, e));
  });

  it("fuera de la fase jugando no se responde", async () => {
    await sembrar(`salas/${COD}`, {
      ...salaConPendiente(),
      fase: "final",
      motivo: "abandono",
      ganador: B,
    });
    await assertFails(responder(B, respuesta(P, AGUA)));
  });

  it("el atacante no puede tocar turno, n ni historial por su cuenta", async () => {
    await sembrarConPendiente();
    await assertFails(set(ref(db(A), `salas/${COD}/turno`), B));
    await assertFails(set(ref(db(A), `salas/${COD}/n`), 1));
    await assertFails(set(ref(db(A), `salas/${COD}/historial/0`), entradaHistorial(P, AGUA)));
  });
});

// ---------------------------------------------------------------- Fin de partida

describe("fin de partida", () => {
  const P = { de: A, x: 3, y: 4 };
  const responder = (uid, escritura) => update(sala(db(uid)), escritura);

  it("flota hundida: el defensor cierra la partida con ganador = atacante", async () => {
    await sembrarConPendiente();
    await assertSucceeds(responder(B, respuesta(P, HUNDIDO, { turno: A, final: true, ganador: A })));
    const s = await leerSembrado(`salas/${COD}`);
    if (s.fase !== "final" || s.ganador !== A || s.motivo !== "flota hundida") throw new Error("Sala final incorrecta.");
  });

  it("el defensor no puede declararse ganador", async () => {
    await sembrarConPendiente();
    await assertFails(responder(B, respuesta(P, HUNDIDO, { turno: A, final: true, ganador: B })));
  });

  it("el motivo debe ser flota hundida", async () => {
    await sembrarConPendiente();
    const e = respuesta(P, HUNDIDO, { turno: A, final: true, ganador: A });
    e.motivo = "otro";
    await assertFails(responder(B, e));
  });

  it("no se puede terminar por flota hundida sin resolver un disparo pendiente", async () => {
    await sembrarJugando();
    await assertFails(update(sala(db(B)), { fase: "final", ganador: A, motivo: "flota hundida" }));
    await sembrarConPendiente();
    await assertFails(update(sala(db(A)), { fase: "final", ganador: A, motivo: "flota hundida", pendiente: null, n: 1 }));
  });

  it("un tercero no puede terminar la partida", async () => {
    await sembrarConPendiente();
    await assertFails(responder(C, respuesta(P, HUNDIDO, { turno: A, final: true, ganador: A })));
    await assertFails(update(sala(db(C)), { fase: "final", motivo: "abandono", ganador: A }));
  });

  describe("abandono", () => {
    const abandonar = (uid, extra = {}) =>
      update(sala(db(uid)), { fase: "final", motivo: "abandono", ...extra });

    it("quien abandona en juego da la victoria al rival", async () => {
      await sembrarJugando();
      await assertSucceeds(abandonar(A, { ganador: B }));
    });

    it("también abandona el invitado", async () => {
      await sembrarJugando();
      await assertSucceeds(abandonar(B, { ganador: A }));
    });

    it("abandonar con disparo pendiente lo borra en la misma escritura", async () => {
      await sembrarConPendiente();
      await assertSucceeds(abandonar(B, { ganador: A, pendiente: null }));
    });

    it("abandonar en desplegando", async () => {
      await sembrarDesplegando();
      await assertSucceeds(abandonar(A, { ganador: B }));
    });

    it("abandonar esperando rival (sin invitado) no lleva ganador", async () => {
      await sembrarEsperando();
      await assertSucceeds(abandonar(A));
    });

    it("no se puede declarar ganador al que abandona", async () => {
      await sembrarJugando();
      await assertFails(abandonar(A, { ganador: A }));
    });

    it("el ganador debe ser uno de los dos jugadores", async () => {
      await sembrarJugando();
      await assertFails(abandonar(A, { ganador: C }));
    });

    it("sin ganador cuando hay rival falla", async () => {
      await sembrarJugando();
      await assertFails(abandonar(A));
    });

    it("sin rival no puede haber ganador", async () => {
      await sembrarEsperando();
      await assertFails(abandonar(A, { ganador: B }));
    });

    it("un tercero o un anónimo no pueden abandonar por otro", async () => {
      await sembrarJugando();
      await assertFails(abandonar(C, { ganador: A }));
      await assertFails(abandonar(null, { ganador: A }));
    });

    it("no se puede abandonar una partida ya terminada", async () => {
      await sembrar(`salas/${COD}`, { ...salaJugando(), fase: "final", motivo: "flota hundida", ganador: A });
      await assertFails(abandonar(B, { ganador: A }));
    });

    it("el motivo debe ser abandono para ese camino", async () => {
      await sembrarJugando();
      await assertFails(update(sala(db(A)), { fase: "final", motivo: "flota hundida", ganador: B }));
    });
  });
});

// ---------------------------------------------------------------- Revelar flota

describe("revelar flota", () => {
  const revelar = (uid, destino, flota) => set(ref(db(uid), `salas/${COD}/revelada/${destino}`), flota);
  const sembrarFinal = () =>
    sembrar(`salas/${COD}`, { ...salaJugando(), fase: "final", motivo: "flota hundida", ganador: A, turno: A });

  it("el dueño revela una flota idéntica a la guardada, en fase final", async () => {
    await sembrarFinal();
    await sembrarFlotas();
    await assertSucceeds(revelar(A, A, FLOTA_A));
    await assertSucceeds(revelar(B, B, FLOTA_B));
  });

  it("no coincide con la guardada: falla", async () => {
    await sembrarFinal();
    await sembrarFlotas();
    await assertFails(revelar(A, A, FLOTA_B));
    const alterada = { ...FLOTA_A, destructor: { ...FLOTA_A.destructor, x: (FLOTA_A.destructor.x + 1) % 10 } };
    await assertFails(revelar(A, A, alterada));
    const orientacion = {
      ...FLOTA_A,
      crucero: { ...FLOTA_A.crucero, ori: FLOTA_A.crucero.ori === "horizontal" ? "vertical" : "horizontal" },
    };
    await assertFails(revelar(A, A, orientacion));
  });

  it("sin flota guardada no se puede revelar", async () => {
    await sembrarFinal();
    await assertFails(revelar(A, A, FLOTA_A));
  });

  it("solo en fase final", async () => {
    await sembrarFlotas();
    await sembrarJugando();
    await assertFails(revelar(A, A, FLOTA_A));
    await sembrarDesplegando();
    await assertFails(revelar(A, A, FLOTA_A));
  });

  it("nadie puede revelar la flota de otro, ni siquiera copiándola", async () => {
    await sembrarFinal();
    await sembrarFlotas();
    await assertFails(revelar(B, A, FLOTA_A));
    await assertFails(revelar(C, A, FLOTA_A));
    await assertFails(revelar(A, B, FLOTA_B));
    await assertFails(revelar(null, A, FLOTA_A));
  });

  it("un tercero no puede revelar con su propio uid (no tiene flota guardada)", async () => {
    await sembrarFinal();
    await sembrarFlotas();
    await assertFails(revelar(C, C, FLOTA_A));
  });

  it("no se puede reescribir lo ya revelado", async () => {
    await sembrarFinal();
    await sembrarFlotas();
    await assertSucceeds(revelar(A, A, FLOTA_A));
    await assertFails(revelar(A, A, FLOTA_A));
  });

  it("la flota revelada no admite campos extra", async () => {
    await sembrarFinal();
    await sembrarFlotas();
    await assertFails(revelar(A, A, { ...FLOTA_A, extra: { x: 0, y: 0, ori: "vertical" } }));
  });

  it("lo revelado es legible por cualquier jugador autenticado", async () => {
    await sembrarFinal();
    await sembrarFlotas();
    await revelar(A, A, FLOTA_A);
    await assertSucceeds(get(ref(db(B), `salas/${COD}/revelada/${A}`)));
  });
});

// ---------------------------------------------------------------- Terceros y lectura

describe("terceros y lectura", () => {
  it("un tercero no escribe en ninguna ruta de una sala ajena", async () => {
    await sembrarConPendiente();
    await assertFails(set(ref(db(C), `salas/${COD}/turno`), C));
    await assertFails(set(ref(db(C), `salas/${COD}/fase`), "final"));
    await assertFails(set(ref(db(C), `salas/${COD}/n`), 5));
    await assertFails(set(ref(db(C), `salas/${COD}/ganador`), C));
    await assertFails(set(ref(db(C), `salas/${COD}/creador`), C));
    await assertFails(set(ref(db(C), `salas/${COD}/invitado`), C));
    await assertFails(set(ref(db(C), `salas/${COD}/jugadores/${A}/listo`), true));
    await assertFails(set(ref(db(C), `salas/${COD}/jugadores/${C}`), jugador("Carlos")));
    await assertFails(set(ref(db(C), `salas/${COD}`), salaEsperando()));
    await assertFails(remove(ref(db(C), `salas/${COD}`)));
  });

  it("los jugadores no pueden cambiar creador, invitado ni los nicks ajenos", async () => {
    await sembrarJugando();
    await assertFails(set(ref(db(A), `salas/${COD}/creador`), B));
    await assertFails(set(ref(db(B), `salas/${COD}/invitado`), C));
    await assertFails(set(ref(db(B), `salas/${COD}/jugadores/${A}/nick`), "Otro"));
  });

  it("un jugador puede actualizar su propia presencia", async () => {
    await sembrarJugando();
    await assertSucceeds(set(ref(db(A), `salas/${COD}/jugadores/${A}/conectado`), false));
    await assertSucceeds(set(ref(db(A), `salas/${COD}/jugadores/${A}/conectado`), true));
    await assertFails(set(ref(db(B), `salas/${COD}/jugadores/${A}/conectado`), false));
  });

  it("onDisconnect: con la sala ya terminada se puede seguir marcando la presencia propia", async () => {
    await sembrar(`salas/${COD}`, { ...salaJugando(), fase: "final", motivo: "abandono", ganador: B });
    await assertSucceeds(set(ref(db(A), `salas/${COD}/jugadores/${A}/conectado`), false));
  });

  it("la lectura de una sala sin autenticar falla", async () => {
    await sembrarJugando();
    await assertFails(get(sala(db(null))));
    await assertFails(get(ref(db(null), `salas/${COD}/turno`)));
    await assertFails(get(ref(db(null), `salas/${COD}/historial`)));
  });

  it("un autenticado puede leer una sala por su código (necesario para unirse)", async () => {
    await sembrarEsperando();
    await assertSucceeds(get(sala(db(C))));
    await assertSucceeds(get(sala(db(A))));
  });

  it("no se puede listar /salas ni la raíz", async () => {
    await sembrarEsperando();
    await assertFails(get(ref(db(A), "salas")));
    await assertFails(get(ref(db(null), "salas")));
    await assertFails(get(ref(db(A), "/")));
  });

  it("no hay escritura en la raíz ni en rutas desconocidas", async () => {
    await assertFails(set(ref(db(A), "otra/cosa"), 1));
    await assertFails(set(ref(db(A), "salas"), { [COD]: salaEsperando() }));
    await assertFails(set(ref(db(A), "/"), { a: 1 }));
  });
});
