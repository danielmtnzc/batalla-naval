// Implementación en memoria de la interfaz `Red` del modo online (solo para tests).
// Imita a Firebase: un único "servidor" compartido por todos los clientes, entrega de cambios
// asíncrona (microtareas) y las mismas comprobaciones que harían las reglas de la base de datos.
//
// Interfaz Red (todos los métodos son async salvo escuchar):
//   entrar() -> uid
//   crearSala(nick) -> codigo
//   unirse(codigo, nick)
//   guardarFlota(barcos)            flota serializada, privada (flotas/{codigo}/{uid})
//   marcarListo()
//   disparar(x, y)                  escribe `pendiente`
//   responder(res, cambios)         el defensor escribe historial[n], n+1, pendiente=null, turno...
//   revelar(flota)                  al acabar, publica la flota en revelada/{uid}
//   abandonar()
//   escuchar(cb) -> desuscribir     cb(sala | null) con una copia de la sala
// Como la red de Firebase: retomar(codigo), leerFlota(), getters uid y codigo.
// Extras de la versión en memoria: desconectar(), reconectar(), servidor.crearRed(uid) (recarga).

import { generarCodigo } from "../js/protocolo.js";

const copia = (v) => (v === undefined ? undefined : structuredClone(v));

export function crearServidorMemoria({ rnd = Math.random } = {}) {
  const salas = new Map();
  const flotas = new Map(); // codigo -> { uid: flota }
  const clientes = new Set();
  const sucias = new Set();
  let programado = false;
  let siguienteUid = 1;

  function marcarSucia(codigo) {
    sucias.add(codigo);
    if (programado) return;
    programado = true;
    queueMicrotask(() => {
      programado = false;
      const lote = [...sucias];
      sucias.clear();
      for (const c of [...clientes]) if (lote.includes(c.codigo)) c.entregar();
    });
  }

  const servidor = {
    // Espera a que se hayan entregado todos los cambios pendientes.
    reposo: () => new Promise((r) => setImmediate(r)),
    sala: (codigo) => copia(salas.get(codigo)),
    flotaPrivada: (codigo, uid) => copia(flotas.get(codigo)?.[uid]),
    // Con `uidExistente` se simula un navegador recargado: mismo usuario, cliente nuevo.
    crearRed: (uidExistente = null) => crearRed(servidor, internos, uidExistente),
  };

  const internos = { salas, flotas, clientes, marcarSucia, rnd, nuevoUid: () => `uid${siguienteUid++}` };
  return servidor;
}

function crearRed(servidor, { salas, flotas, clientes, marcarSucia, rnd, nuevoUid }, uidInicial = null) {
  let uid = uidInicial;
  let codigo = null;
  let conectada = true;
  const oyentes = new Set();

  const cliente = {
    get codigo() {
      return codigo;
    },
    entregar() {
      if (!conectada) return;
      const sala = copia(salas.get(codigo)) ?? null;
      for (const cb of [...oyentes]) cb(sala);
    },
  };
  clientes.add(cliente);

  const exigirConexion = () => {
    if (!conectada) throw new Error("Sin conexión.");
  };
  const exigirSala = () => {
    exigirConexion();
    const sala = salas.get(codigo);
    if (!uid || !sala) throw new Error("No estás en ninguna sala.");
    return sala;
  };
  const rivalDeSala = (sala) => (sala.creador === uid ? sala.invitado : sala.creador);

  return {
    get uid() {
      return uid;
    },
    get codigo() {
      return codigo;
    },

    async entrar() {
      exigirConexion();
      if (!uid) uid = nuevoUid();
      return uid;
    },

    async crearSala(nick) {
      exigirConexion();
      if (!uid) throw new Error("Primero hay que entrar.");
      let nuevo;
      do nuevo = generarCodigo(rnd);
      while (salas.has(nuevo));
      salas.set(nuevo, {
        creador: uid,
        invitado: null,
        fase: "esperando",
        turno: null,
        ganador: null,
        motivo: null,
        n: 0,
        jugadores: { [uid]: { nick, listo: false, conectado: true } },
        pendiente: null,
        historial: [],
        revelada: {},
      });
      flotas.set(nuevo, {});
      codigo = nuevo;
      marcarSucia(codigo);
      return codigo;
    },

    async unirse(cod, nick) {
      exigirConexion();
      if (!uid) throw new Error("Primero hay que entrar.");
      const sala = salas.get(cod);
      if (!sala) throw new Error("La sala no existe.");
      if (sala.invitado || sala.fase !== "esperando") throw new Error("La sala está llena.");
      if (sala.creador === uid) throw new Error("Ya eres el creador de la sala.");
      sala.invitado = uid;
      sala.fase = "desplegando";
      sala.jugadores[uid] = { nick, listo: false, conectado: true };
      codigo = cod;
      marcarSucia(cod);
    },

    // Vuelve a una sala en la que ya se es jugador (recarga de la página).
    async retomar(cod) {
      exigirConexion();
      if (!uid) throw new Error("Primero hay que entrar.");
      const sala = salas.get(cod);
      if (!sala) throw new Error("La sala no existe.");
      if (sala.creador !== uid && sala.invitado !== uid) throw new Error("No eres jugador de esta sala.");
      codigo = cod;
      marcarSucia(cod);
      return copia(sala);
    },

    async leerFlota() {
      exigirConexion();
      if (!uid || !codigo) throw new Error("No estás en ninguna sala.");
      return copia(flotas.get(codigo)?.[uid]) ?? null;
    },

    async guardarFlota(barcos) {
      const sala = exigirSala();
      if (sala.fase !== "desplegando") throw new Error("No se puede guardar la flota ahora.");
      flotas.get(codigo)[uid] = copia(barcos);
    },

    async marcarListo() {
      const sala = exigirSala();
      if (sala.fase !== "desplegando") throw new Error("No se puede marcar listo ahora.");
      if (!flotas.get(codigo)[uid]) throw new Error("Falta guardar la flota.");
      sala.jugadores[uid].listo = true;
      // En Firebase lo hace en transacción quien marca listo en segundo lugar.
      if (Object.values(sala.jugadores).length === 2 && Object.values(sala.jugadores).every((j) => j.listo)) {
        sala.fase = "jugando";
        sala.turno = sala.creador;
      }
      marcarSucia(codigo);
    },

    async disparar(x, y) {
      const sala = exigirSala();
      if (sala.fase !== "jugando") throw new Error("La partida no está en juego.");
      if (sala.turno !== uid) throw new Error("No es tu turno.");
      if (sala.pendiente) throw new Error("Hay un disparo pendiente de respuesta.");
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 9 || y > 9) {
        throw new Error("Disparo fuera del tablero.");
      }
      if (sala.historial.some((e) => e.de === uid && e.x === x && e.y === y)) {
        throw new Error("Ya has disparado ahí.");
      }
      sala.pendiente = { de: uid, x, y };
      marcarSucia(codigo);
    },

    async responder(res, cambios) {
      const sala = exigirSala();
      if (sala.fase !== "jugando") throw new Error("La partida no está en juego.");
      const p = sala.pendiente;
      if (!p) throw new Error("No hay disparo pendiente.");
      if (p.de === uid) throw new Error("No puedes responder a tu propio disparo.");
      if (![sala.creador, sala.invitado].includes(cambios.turno)) throw new Error("Turno inválido.");
      if (!["agua", "tocado", "hundido"].includes(res.estado)) throw new Error("Estado inválido.");
      const entrada = { de: p.de, x: p.x, y: p.y, estado: res.estado };
      if (res.barco) entrada.barco = copia(res.barco);
      if (res.alrededor) entrada.alrededor = copia(res.alrededor);
      sala.historial.push(entrada);
      sala.n = sala.historial.length;
      sala.pendiente = null;
      sala.turno = cambios.turno;
      if (cambios.fase === "final") {
        sala.fase = "final";
        sala.ganador = cambios.ganador ?? null;
        sala.motivo = "flota hundida";
      }
      marcarSucia(codigo);
    },

    async revelar(flota) {
      const sala = exigirSala();
      if (sala.fase !== "final") throw new Error("Solo se revela al terminar.");
      // Las reglas de Firebase pueden comparar con flotas/{codigo}/{uid}.
      if (JSON.stringify(flotas.get(codigo)[uid]) !== JSON.stringify(flota)) {
        throw new Error("La flota revelada no coincide con la guardada.");
      }
      sala.revelada[uid] = copia(flota);
      marcarSucia(codigo);
    },

    async abandonar() {
      const sala = exigirSala();
      if (sala.fase === "final") return;
      sala.fase = "final";
      sala.ganador = rivalDeSala(sala) ?? null;
      sala.motivo = "abandono";
      sala.pendiente = null;
      marcarSucia(codigo);
    },

    escuchar(cb) {
      oyentes.add(cb);
      queueMicrotask(() => {
        if (oyentes.has(cb) && conectada && codigo) cb(copia(salas.get(codigo)) ?? null);
      });
      return () => oyentes.delete(cb);
    },

    // --- Solo en la versión en memoria
    desconectar() {
      if (!conectada) return;
      conectada = false;
      const sala = salas.get(codigo);
      if (sala?.jugadores[uid]) {
        sala.jugadores[uid].conectado = false;
        marcarSucia(codigo);
      }
    },

    reconectar() {
      if (conectada) return;
      conectada = true;
      const sala = salas.get(codigo);
      if (sala?.jugadores[uid]) sala.jugadores[uid].conectado = true;
      if (codigo) marcarSucia(codigo);
    },
  };
}
