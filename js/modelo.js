// Modelo del juego Batalla naval.
// Basado en el modelo original de la práctica de la universidad (diciembre de 2022),
// adaptado para funcionar entero en el navegador (sin servidor ni base de datos).

export const TAM_TABLERO = 10;

export const FLOTA_ESTANDAR = [
  { nombre: "portaaviones", tam: 5 },
  { nombre: "acorazado", tam: 4 },
  { nombre: "crucero", tam: 3 },
  { nombre: "submarino", tam: 3 },
  { nombre: "destructor", tam: 2 },
];

const clave = (x, y) => `${x},${y}`;

// ---------------------------------------------------------------- Juego

export class Juego {
  constructor() {
    this.partidas = {};
    this.usuarios = {};
    this.contador = 0;
  }

  agregarUsuario(nick) {
    if (this.usuarios[nick]) return { nick: -1 };
    this.usuarios[nick] = new Usuario(nick, this);
    return { nick };
  }

  eliminarUsuario(nick) {
    delete this.usuarios[nick];
  }

  obtenerUsuario(nick) {
    return this.usuarios[nick];
  }

  jugadorCreaPartida(nick) {
    const usr = this.usuarios[nick];
    return { codigo: usr ? usr.crearPartida() : -1 };
  }

  jugadorSeUneAPartida(nick, codigo) {
    const usr = this.usuarios[nick];
    return { codigo: usr ? usr.unirseAPartida(codigo) : -1 };
  }

  crearPartida(usr) {
    const codigo = `${Date.now()}-${++this.contador}`;
    this.partidas[codigo] = new Partida(codigo, usr);
    return codigo;
  }

  unirseAPartida(codigo, usr) {
    const partida = this.partidas[codigo];
    return partida ? partida.agregarJugador(usr) : -1;
  }

  obtenerPartida(codigo) {
    return this.partidas[codigo];
  }

  obtenerPartidas() {
    return Object.values(this.partidas).map((p) => ({ codigo: p.codigo, owner: p.owner.nick }));
  }

  obtenerPartidasDisponibles() {
    return Object.values(this.partidas)
      .filter((p) => p.fase === "inicial")
      .map((p) => ({ codigo: p.codigo, owner: p.owner.nick, fase: p.fase }));
  }
}

// ---------------------------------------------------------------- Usuario

export class Usuario {
  constructor(nick, juego) {
    this.nick = nick;
    this.juego = juego;
    this.tableroPropio = null;
    this.tableroRival = null;
    this.partida = null;
    this.flota = {};
    this.disparos = 0;
    this.aciertos = 0;
  }

  crearPartida() {
    return this.juego.crearPartida(this);
  }

  unirseAPartida(codigo) {
    return this.juego.unirseAPartida(codigo, this);
  }

  inicializarTableros(dim) {
    this.tableroPropio = new Tablero(dim);
    this.tableroRival = new Tablero(dim);
  }

  inicializarFlota(definicion = FLOTA_ESTANDAR) {
    this.flota = {};
    for (const { nombre, tam } of definicion) this.flota[nombre] = new Barco(nombre, tam);
  }

  // Devuelve true si el barco ha quedado colocado.
  colocarBarco(nombre, x, y, orientacion) {
    if (!this.partida || !this.partida.esDesplegando()) return false;
    const barco = this.flota[nombre];
    if (!barco) return false;
    return this.tableroPropio.colocarBarco(barco, x, y, orientacion || barco.orientacion);
  }

  quitarBarco(nombre) {
    if (!this.partida || !this.partida.esDesplegando()) return;
    const barco = this.flota[nombre];
    if (barco) this.tableroPropio.quitarBarco(barco);
  }

  quitarTodos() {
    for (const nombre in this.flota) this.quitarBarco(nombre);
  }

  desplegarAleatorio(rnd = Math.random) {
    if (!this.partida || !this.partida.esDesplegando()) return false;
    const tam = this.tableroPropio.size;
    const barcos = Object.values(this.flota).sort((a, b) => b.tam - a.tam);
    for (let intento = 0; intento < 200; intento++) {
      this.quitarTodos();
      let ok = true;
      for (const barco of barcos) {
        let colocado = false;
        for (let k = 0; k < 300 && !colocado; k++) {
          const ori = rnd() < 0.5 ? new Horizontal() : new Vertical();
          const x = Math.floor(rnd() * tam);
          const y = Math.floor(rnd() * tam);
          colocado = this.tableroPropio.colocarBarco(barco, x, y, ori);
        }
        if (!colocado) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  todosDesplegados() {
    return Object.values(this.flota).every((b) => b.desplegado);
  }

  barcosDesplegados() {
    this.partida.barcosDesplegados();
  }

  disparar(x, y) {
    return this.partida.disparar(this.nick, x, y);
  }

  meDisparan(x, y) {
    return this.tableroPropio.meDisparan(x, y);
  }

  obtenerEstado(x, y) {
    return this.tableroPropio.obtenerEstado(x, y);
  }

  marcarEstado(estado, x, y) {
    this.tableroRival.marcarEstado(estado, x, y);
  }

  flotaHundida() {
    return Object.values(this.flota).every((b) => b.estado === "hundido");
  }

  barcosAFlote() {
    return Object.values(this.flota).filter((b) => b.estado !== "hundido").length;
  }

  obtenerFlota() {
    return this.flota;
  }
}

// ---------------------------------------------------------------- Partida

export class Partida {
  constructor(codigo, usr) {
    this.codigo = codigo;
    this.owner = usr;
    this.jugadores = [];
    this.fase = "inicial";
    this.maxJugadores = 2;
    this.turno = null;
    this.ganador = null;
    this.historial = [];
    this.agregarJugador(usr);
  }

  agregarJugador(usr) {
    if (!this.hayHueco() || this.estoy(usr.nick)) return -1;
    this.jugadores.push(usr);
    usr.partida = this;
    usr.disparos = 0;
    usr.aciertos = 0;
    usr.inicializarTableros(TAM_TABLERO);
    usr.inicializarFlota();
    this.comprobarFase();
    return this.codigo;
  }

  comprobarFase() {
    if (this.fase === "inicial" && !this.hayHueco()) this.fase = "desplegando";
  }

  hayHueco() {
    return this.jugadores.length < this.maxJugadores;
  }

  estoy(nick) {
    return this.jugadores.some((j) => j.nick === nick);
  }

  esInicial() { return this.fase === "inicial"; }
  esDesplegando() { return this.fase === "desplegando"; }
  esJugando() { return this.fase === "jugando"; }
  esFinal() { return this.fase === "final"; }

  flotasDesplegadas() {
    return this.jugadores.every((j) => j.todosDesplegados());
  }

  barcosDesplegados() {
    if (this.esDesplegando() && this.flotasDesplegadas()) {
      this.fase = "jugando";
      this.asignarTurnoInicial();
    }
  }

  asignarTurnoInicial() {
    this.turno = this.jugadores[0];
  }

  cambiarTurno(nick) {
    this.turno = this.obtenerRival(nick);
  }

  obtenerTurno() {
    return this.turno;
  }

  obtenerRival(nick) {
    return this.jugadores.find((j) => j.nick !== nick);
  }

  obtenerJugador(nick) {
    return this.jugadores.find((j) => j.nick === nick);
  }

  // Devuelve { estado, x, y, atacante, barco?, alrededor? } o { error }.
  disparar(nick, x, y) {
    if (!this.esJugando()) return { error: "La partida no está en juego." };
    const atacante = this.obtenerJugador(nick);
    if (!atacante || this.turno !== atacante) return { error: "No es tu turno." };
    if (!atacante.tableroRival.dentro(x, y)) return { error: "Disparo fuera del tablero." };
    if (atacante.tableroRival.obtenerMarca(x, y)) return { error: "Ya has disparado ahí." };

    const atacado = this.obtenerRival(nick);
    const contenido = atacado.tableroPropio.casillas[x][y].contiene;
    const estado = atacado.meDisparan(x, y);
    const resultado = { estado, x, y, atacante: nick };
    atacante.disparos++;

    if (estado === "agua") {
      atacante.marcarEstado("agua", x, y);
      atacado.tableroPropio.marcarEstado("agua", x, y);
      this.cambiarTurno(nick); // si es agua, pasa el turno; si aciertas, repites
    } else {
      atacante.aciertos++;
      atacado.tableroPropio.marcarEstado("tocado", x, y);
      if (estado === "hundido") {
        const posiciones = contenido.obtenerPosiciones();
        for (const [px, py] of posiciones) atacante.marcarEstado("hundido", px, py);
        // Los barcos no pueden tocarse: el agua alrededor de un hundido queda descubierta.
        const alrededor = atacante.tableroRival.alrededorDe(posiciones);
        for (const [ax, ay] of alrededor) {
          if (!atacante.tableroRival.obtenerMarca(ax, ay)) atacante.marcarEstado("agua", ax, ay);
        }
        resultado.barco = { nombre: contenido.nombre, tam: contenido.tam, posiciones };
        resultado.alrededor = alrededor;
      } else {
        atacante.marcarEstado("tocado", x, y);
      }
      this.comprobarFin(atacado);
    }

    this.historial.push(resultado);
    return resultado;
  }

  comprobarFin(atacado) {
    if (atacado.flotaHundida()) {
      this.fase = "final";
      this.ganador = this.turno;
    }
  }

  abandonarPartida(jugador) {
    if (!jugador || this.esFinal()) return;
    this.fase = "final";
    this.ganador = this.obtenerRival(jugador.nick) || null;
  }
}

// ---------------------------------------------------------------- Tablero

export class Casilla {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.contiene = new Agua();
  }
}

export class Tablero {
  constructor(size = TAM_TABLERO) {
    this.size = size;
    this.crearTablero(size);
  }

  crearTablero(tam) {
    this.casillas = Array.from({ length: tam }, (_, x) =>
      Array.from({ length: tam }, (_, y) => new Casilla(x, y))
    );
    // Marcas de disparos: en el tablero rival son mis disparos; en el propio, los que recibo.
    this.marcas = Array.from({ length: tam }, () => Array(tam).fill(null));
  }

  dentro(x, y) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  vecinos(x, y) {
    const lista = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if ((dx || dy) && this.dentro(x + dx, y + dy)) lista.push([x + dx, y + dy]);
      }
    }
    return lista;
  }

  alrededorDe(posiciones) {
    const propias = new Set(posiciones.map(([x, y]) => clave(x, y)));
    const vistos = new Set();
    const lista = [];
    for (const [x, y] of posiciones) {
      for (const [vx, vy] of this.vecinos(x, y)) {
        const k = clave(vx, vy);
        if (!propias.has(k) && !vistos.has(k)) {
          vistos.add(k);
          lista.push([vx, vy]);
        }
      }
    }
    return lista;
  }

  libre(x, y, ignorar) {
    const c = this.casillas[x][y].contiene;
    return c.esAgua() || c === ignorar;
  }

  comprobarLimites(tam, x, y, orientacion = new Horizontal()) {
    return orientacion.posiciones(tam, x, y).every(([px, py]) => this.dentro(px, py));
  }

  puedeColocar(barco, x, y, orientacion = barco.orientacion) {
    const posiciones = orientacion.posiciones(barco.tam, x, y);
    return posiciones.every(
      ([px, py]) =>
        this.dentro(px, py) &&
        this.libre(px, py, barco) &&
        this.vecinos(px, py).every(([vx, vy]) => this.libre(vx, vy, barco))
    );
  }

  colocarBarco(barco, x, y, orientacion = barco.orientacion) {
    if (!this.puedeColocar(barco, x, y, orientacion)) return false;
    this.quitarBarco(barco);
    const posiciones = orientacion.posiciones(barco.tam, x, y);
    for (const [px, py] of posiciones) this.casillas[px][py].contiene = barco;
    barco.orientacion = orientacion;
    barco.posicion(x, y, posiciones);
    return true;
  }

  quitarBarco(barco) {
    if (!barco.desplegado) return;
    for (const [px, py] of barco.obtenerPosiciones()) {
      if (this.casillas[px][py].contiene === barco) this.casillas[px][py].contiene = new Agua();
    }
    barco.desplegado = false;
    barco.casillas = new Map();
  }

  meDisparan(x, y) {
    return this.casillas[x][y].contiene.meDisparan(x, y);
  }

  obtenerEstado(x, y) {
    return this.casillas[x][y].contiene.obtenerEstado();
  }

  marcarEstado(estado, x, y) {
    this.marcas[x][y] = estado;
  }

  obtenerMarca(x, y) {
    return this.marcas[x][y];
  }
}

// ---------------------------------------------------------------- Barcos

export class Barco {
  constructor(nombre, tam, orientacion = new Horizontal()) {
    this.nombre = nombre;
    this.tam = tam;
    this.orientacion = orientacion;
    this.desplegado = false;
    this.estado = "intacto";
    this.casillas = new Map(); // "x,y" -> "intacto" | "tocado"
  }

  esAgua() {
    return false;
  }

  posicion(x, y, posiciones) {
    this.x = x;
    this.y = y;
    this.desplegado = true;
    this.estado = "intacto";
    this.casillas = new Map(posiciones.map(([px, py]) => [clave(px, py), "intacto"]));
  }

  obtenerPosiciones() {
    return [...this.casillas.keys()].map((k) => k.split(",").map(Number));
  }

  meDisparan(x, y) {
    const k = clave(x, y);
    if (!this.casillas.has(k)) return this.estado;
    this.casillas.set(k, "tocado");
    this.estado = this.comprobarCasillas() ? "hundido" : "tocado";
    return this.estado;
  }

  comprobarCasillas() {
    for (const v of this.casillas.values()) if (v === "intacto") return false;
    return true;
  }

  estadoCasilla(x, y) {
    return this.casillas.get(clave(x, y));
  }

  obtenerEstado() {
    return this.estado;
  }
}

export class Horizontal {
  constructor() {
    this.nombre = "horizontal";
  }
  esHorizontal() { return true; }
  esVertical() { return false; }
  posiciones(tam, x, y) {
    return Array.from({ length: tam }, (_, i) => [x + i, y]);
  }
  girar() { return new Vertical(); }
}

export class Vertical {
  constructor() {
    this.nombre = "vertical";
  }
  esHorizontal() { return false; }
  esVertical() { return true; }
  posiciones(tam, x, y) {
    return Array.from({ length: tam }, (_, i) => [x, y + i]);
  }
  girar() { return new Horizontal(); }
}

export class Agua {
  constructor() {
    this.nombre = "agua";
  }
  esAgua() { return true; }
  meDisparan() { return "agua"; }
  obtenerEstado() { return "agua"; }
}
