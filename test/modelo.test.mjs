import { test } from "node:test";
import assert from "node:assert/strict";
import { Juego, Horizontal, Vertical } from "../js/modelo.js";
import { Almirante } from "../js/ia.js";

function semilla(s) {
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function preparar() {
  const juego = new Juego();
  juego.agregarUsuario("pepe");
  juego.agregarUsuario("luis");
  const { codigo } = juego.jugadorCreaPartida("pepe");
  juego.jugadorSeUneAPartida("luis", codigo);
  const partida = juego.obtenerPartida(codigo);
  return { juego, partida, pepe: juego.obtenerUsuario("pepe"), luis: juego.obtenerUsuario("luis") };
}

test("la partida pasa a desplegando con dos jugadores y no admite un tercero", () => {
  const { juego, partida } = preparar();
  assert.equal(partida.fase, "desplegando");
  juego.agregarUsuario("ana");
  assert.equal(juego.jugadorSeUneAPartida("ana", partida.codigo).codigo, -1);
});

test("no se puede colocar fuera del tablero ni encima de otro barco, pero sí pegado", () => {
  const { pepe } = preparar();
  assert.equal(pepe.colocarBarco("portaaviones", 6, 0, new Horizontal()), false);
  assert.equal(pepe.colocarBarco("portaaviones", 0, 0, new Horizontal()), true);
  assert.equal(pepe.colocarBarco("destructor", 2, 0, new Vertical()), false); // encima
  assert.equal(pepe.colocarBarco("destructor", 0, 1, new Horizontal()), true); // pegado
  assert.equal(pepe.colocarBarco("destructor", 0, 2, new Horizontal()), true); // y se mueve
  assert.equal(pepe.colocarBarco("acorazado", 9, 6, new Vertical()), true);
  assert.equal(pepe.colocarBarco("crucero", 9, 8, new Vertical()), false);
});

test("recolocar un barco lo mueve sin dejar restos", () => {
  const { pepe } = preparar();
  pepe.colocarBarco("crucero", 0, 0, new Horizontal());
  pepe.colocarBarco("crucero", 1, 0, new Horizontal()); // se solapa consigo mismo: permitido
  assert.equal(pepe.tableroPropio.casillas[0][0].contiene.esAgua(), true);
  assert.equal(pepe.tableroPropio.casillas[3][0].contiene.nombre, "crucero");
});

test("despliegue aleatorio y paso a jugando", () => {
  const { partida, pepe, luis } = preparar();
  assert.equal(pepe.desplegarAleatorio(semilla(1)), true);
  assert.equal(luis.desplegarAleatorio(semilla(2)), true);
  pepe.barcosDesplegados();
  assert.equal(partida.fase, "jugando");
  assert.equal(partida.turno, pepe);
});

test("agua pasa el turno, tocado repite, hundido no descubre el agua de alrededor", () => {
  const { partida, pepe, luis } = preparar();
  pepe.desplegarAleatorio(semilla(3));
  luis.colocarBarco("destructor", 0, 0, new Vertical());
  luis.colocarBarco("portaaviones", 5, 9, new Horizontal());
  luis.colocarBarco("acorazado", 9, 0, new Vertical());
  luis.colocarBarco("crucero", 3, 3, new Horizontal());
  luis.colocarBarco("submarino", 3, 6, new Vertical());
  luis.barcosDesplegados();

  assert.equal(pepe.disparar(0, 0).estado, "tocado");
  assert.equal(partida.turno, pepe);
  assert.equal(pepe.disparar(0, 0).error, "Ya has disparado ahí.");
  const r = pepe.disparar(0, 1);
  assert.equal(r.estado, "hundido");
  assert.equal(r.alrededor, undefined);
  assert.equal(pepe.tableroRival.obtenerMarca(1, 1), null);
  assert.equal(pepe.tableroRival.obtenerMarca(0, 2), null);
  assert.equal(pepe.disparar(5, 5).estado, "agua");
  assert.equal(partida.turno, luis);
  assert.equal(pepe.disparar(6, 6).error, "No es tu turno.");
});

test("un barco vertical se hunde bien (fallaba en el modelo original)", () => {
  const { pepe, luis } = preparar();
  pepe.desplegarAleatorio(semilla(4));
  luis.colocarBarco("acorazado", 4, 2, new Vertical());
  for (const n of ["portaaviones", "crucero", "submarino", "destructor"]) {
    const b = luis.flota[n];
    for (let i = 0; i < 300 && !b.desplegado; i++) {
      luis.colocarBarco(n, i % 10, Math.floor(i / 10) % 10, i % 2 ? new Vertical() : new Horizontal());
    }
  }
  luis.barcosDesplegados();
  for (const y of [2, 3, 4]) assert.equal(pepe.disparar(4, y).estado, "tocado");
  assert.equal(pepe.disparar(4, 5).estado, "hundido");
});

for (const dificultad of ["facil", "normal", "dificil"]) {
  test(`la IA (${dificultad}) termina siempre la partida`, () => {
    for (let s = 1; s <= 30; s++) {
      const { partida, pepe, luis } = preparar();
      pepe.desplegarAleatorio(semilla(s));
      luis.desplegarAleatorio(semilla(s + 100));
      pepe.barcosDesplegados();
      partida.turno = luis;
      const ia = new Almirante(10, dificultad, semilla(s + 200));
      let disparos = 0;
      while (!partida.esFinal()) {
        partida.turno = luis;
        const [x, y] = ia.elegirDisparo();
        const r = luis.disparar(x, y);
        assert.ok(!r.error, r.error);
        ia.registrar(r);
        disparos++;
        assert.ok(disparos <= 100);
      }
      assert.equal(partida.ganador, luis);
    }
  });
}

test("la IA difícil necesita de media menos disparos que la fácil", () => {
  const media = (dificultad) => {
    let total = 0;
    for (let s = 1; s <= 40; s++) {
      const { partida, pepe, luis } = preparar();
      pepe.desplegarAleatorio(semilla(s));
      luis.desplegarAleatorio(semilla(s + 1));
      pepe.barcosDesplegados();
      const ia = new Almirante(10, dificultad, semilla(s + 7));
      while (!partida.esFinal()) {
        partida.turno = luis;
        const [x, y] = ia.elegirDisparo();
        ia.registrar(luis.disparar(x, y));
        total++;
      }
    }
    return total / 40;
  };
  const f = media("facil"), n = media("normal"), d = media("dificil");
  console.log(`media de disparos: fácil ${f}, normal ${n}, difícil ${d}`);
  assert.ok(d < n && n < f);
});

test("colocación manual: mover, girar en el sitio y respetar límites; se admiten barcos pegados", () => {
  const { pepe } = preparar();
  assert.equal(pepe.colocarBarco("destructor", 0, 0, new Horizontal()), true);
  // mover solapando su propia posición anterior
  assert.equal(pepe.colocarBarco("destructor", 1, 0, new Horizontal()), true);
  assert.deepEqual(pepe.flota.destructor.obtenerPosiciones(), [[1, 0], [2, 0]]);
  // girar en el sitio no duplica ni pierde casillas
  assert.equal(pepe.colocarBarco("destructor", 1, 0, new Vertical()), true);
  assert.deepEqual(pepe.flota.destructor.obtenerPosiciones(), [[1, 0], [1, 1]]);
  assert.equal(pepe.tableroPropio.casillas[2][0].contiene.esAgua(), true);
  // pegado (también en diagonal) se puede; solapado no
  assert.equal(pepe.colocarBarco("crucero", 2, 2, new Horizontal()), true);
  assert.equal(pepe.colocarBarco("crucero", 1, 1, new Horizontal()), false); // pisa el destructor en (1,1)
  assert.equal(pepe.colocarBarco("crucero", 3, 3, new Horizontal()), true);
  // fuera del tablero: no se coloca y el barco previo no se pierde
  assert.equal(pepe.colocarBarco("crucero", 8, 3, new Horizontal()), false);
  assert.deepEqual(pepe.flota.crucero.obtenerPosiciones(), [[3, 3], [4, 3], [5, 3]]);
  assert.equal(pepe.colocarBarco("crucero", 3, 8, new Vertical()), false);
  assert.equal(pepe.colocarBarco("crucero", -1, 3, new Horizontal()), false);
});

test("desplegarAleatorio que falla no deja la flota a medias", () => {
  const { pepe } = preparar();
  assert.equal(pepe.desplegarAleatorio(() => 0), false);
  assert.ok(Object.values(pepe.flota).every((b) => !b.desplegado));
  assert.equal(pepe.tableroPropio.casillas[0][0].contiene.esAgua(), true);
});
