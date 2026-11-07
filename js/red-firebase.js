// Implementación real de la interfaz `Red` del modo online con Firebase
// (Authentication anónima + Realtime Database). Misma interfaz y misma forma de sala que
// test/red-memoria.mjs, para que la interfaz pueda usar una u otra sin cambios:
//
//   entrar() -> uid
//   crearSala(nick) -> codigo
//   unirse(codigo, nick)
//   guardarFlota(barcos)            flota serializada, privada (flotas/{codigo}/{uid})
//   marcarListo()
//   disparar(x, y)                  escribe `pendiente`
//   responder(res, cambios)         el defensor escribe historial[n], n+1, pendiente=null, turno...
//   revelar(flota)                  al acabar, publica la flota en revelada/{uid}
//   abandonar()
//   escuchar(cb) -> desuscribir     cb(sala | null) con la sala normalizada
//
// Extras de esta versión (para recargar la página a mitad de partida):
//   retomar(codigo) -> sala         vuelve a una sala en la que ya se es jugador
//   leerFlota() -> flota | null     recupera la flota privada propia
//   uid, codigo                     getters
//
// La seguridad la ponen las reglas de database.rules.json; las comprobaciones de aquí son las
// mismas que hace la red en memoria y sirven para dar mensajes claros antes de escribir.
// No se importa en los tests (usa URLs de CDN): la parte pura está en js/sala-remota.js.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  onValue,
  onDisconnect,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { generarCodigo, normalizarCodigo } from "./protocolo.js";
import {
  normalizarSala,
  salaNueva,
  limpiarNick,
  entradaHistorial,
  mismaFlota,
  mensajeError,
  esPermisoDenegado,
} from "./sala-remota.js";

const INTENTOS_CODIGO = 8;

function app(config) {
  return getApps()[0] ?? initializeApp(config);
}

export function crearRedFirebase({ config = firebaseConfig, rnd = Math.random } = {}) {
  const fbApp = app(config);
  const auth = getAuth(fbApp);
  const db = getDatabase(fbApp);

  let uid = null;
  let codigo = null;
  let ultima; // última sala normalizada recibida (undefined = aún nada)
  let dejarDeOirSala = null;
  let dejarDeOirConexion = null;
  let conectada = false;
  let modoPresencia = null; // "borrar" | "presencia" | null (lo registrado en el servidor)
  let presenciaEnCurso = Promise.resolve();
  let intentandoEmpezar = false;
  const oyentes = new Set();

  const rutaSala = (c = codigo) => ref(db, `salas/${c}`);
  const rutaFlota = () => ref(db, `flotas/${codigo}/${uid}`);
  const rivalDe = (sala) => (sala.creador === uid ? sala.invitado : sala.creador);

  // Ejecuta una operación de Firebase y traduce sus errores; `siDenegado` permite dar un
  // mensaje más concreto cuando lo que falla es una regla.
  async function op(promesa, siDenegado) {
    try {
      return await promesa;
    } catch (err) {
      if (esPermisoDenegado(err) && siDenegado) {
        const motivo = await siDenegado().catch(() => null);
        if (motivo) throw new Error(motivo);
      }
      throw new Error(mensajeError(err));
    }
  }

  async function leerSala(c = codigo) {
    const snap = await op(get(rutaSala(c)));
    return normalizarSala(snap.val());
  }

  const exigirUid = () => {
    if (!uid) throw new Error("Primero hay que entrar.");
  };

  async function exigirSala() {
    if (!uid || !codigo) throw new Error("No estás en ninguna sala.");
    const sala = await leerSala();
    if (!sala) throw new Error("No estás en ninguna sala.");
    return sala;
  }

  // ------------------------------------------------------------ Escucha de la sala

  function entregar(sala) {
    for (const cb of [...oyentes]) {
      try {
        cb(sala);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function oirSala() {
    dejarDeOirSala?.();
    ultima = undefined;
    const c = codigo;
    dejarDeOirSala = onValue(
      rutaSala(c),
      (snap) => {
        if (c !== codigo) return;
        ultima = normalizarSala(snap.val());
        alCambiarSala(ultima);
        entregar(ultima);
      },
      (err) => console.error("No se puede escuchar la sala:", mensajeError(err))
    );
  }

  function alCambiarSala(sala) {
    actualizarPresencia(sala);
    // Si los dos han marcado listo a la vez, ninguno vio al otro y nadie empezó la partida:
    // lo hace quien lo vea (las reglas solo dejan pasar la primera escritura).
    if (
      sala &&
      sala.fase === "desplegando" &&
      sala.invitado &&
      sala.jugadores[sala.creador]?.listo &&
      sala.jugadores[sala.invitado]?.listo &&
      !intentandoEmpezar
    ) {
      intentandoEmpezar = true;
      update(rutaSala(), { fase: "jugando", turno: sala.creador })
        .catch(() => {})
        .finally(() => (intentandoEmpezar = false));
    }
  }

  function fijarSala(c) {
    if (codigo === c && dejarDeOirSala) return;
    codigo = c;
    modoPresencia = null;
    oirSala();
  }

  // ------------------------------------------------------------ Presencia

  // Mientras la sala espera rival, si el creador se desconecta la sala se borra.
  // Con dos jugadores, al desconectarse se marca jugadores/{uid}/conectado = false.
  function modoDeseado(sala) {
    if (!sala || !sala.jugadores[uid]) return null;
    if (sala.fase === "esperando" && !sala.invitado && sala.creador === uid) return "borrar";
    if (sala.fase === "final") return null;
    return "presencia";
  }

  function actualizarPresencia(sala) {
    presenciaEnCurso = presenciaEnCurso.then(() => aplicarPresencia(sala)).catch((err) => {
      console.warn("Presencia:", mensajeError(err));
    });
  }

  async function aplicarPresencia(sala) {
    if (!conectada || !codigo) return;
    const deseado = modoDeseado(sala);
    const rutaConectado = ref(db, `salas/${codigo}/jugadores/${uid}/conectado`);
    if (deseado === modoPresencia) {
      if (deseado === "presencia" && sala.jugadores[uid].conectado === false) await set(rutaConectado, true);
      return;
    }
    // cancel() en la sala anula también lo registrado en sus hijos.
    if (modoPresencia) await onDisconnect(rutaSala()).cancel();
    modoPresencia = null;
    if (deseado === "borrar") {
      await onDisconnect(rutaSala()).remove();
    } else if (deseado === "presencia") {
      await onDisconnect(rutaConectado).set(false);
      if (!sala.jugadores[uid].conectado) await set(rutaConectado, true);
    }
    modoPresencia = deseado;
  }

  function oirConexion() {
    if (dejarDeOirConexion) return;
    dejarDeOirConexion = onValue(ref(db, ".info/connected"), (snap) => {
      conectada = snap.val() === true;
      // Al reconectar, el servidor ya ejecutó (o descartó) lo registrado con onDisconnect.
      if (!conectada) modoPresencia = null;
      else if (ultima !== undefined) actualizarPresencia(ultima);
    });
  }

  // ------------------------------------------------------------ Interfaz Red

  return {
    get uid() {
      return uid;
    },
    get codigo() {
      return codigo;
    },

    async entrar() {
      if (uid) return uid;
      await op(auth.authStateReady());
      const usuario = auth.currentUser ?? (await op(signInAnonymously(auth))).user;
      uid = usuario.uid;
      oirConexion();
      return uid;
    },

    async crearSala(nick) {
      exigirUid();
      const datos = salaNueva(uid, nick);
      for (let i = 0; i < INTENTOS_CODIGO; i++) {
        const nuevo = generarCodigo(rnd);
        // La transacción solo escribe si el código está libre: si otro cliente lo ha cogido,
        // el servidor devuelve el valor real y la función aborta (devuelve undefined).
        const r = await op(
          runTransaction(rutaSala(nuevo), (actual) => (actual === null ? datos : undefined), { applyLocally: false })
        );
        if (r.committed) {
          fijarSala(nuevo);
          return nuevo;
        }
      }
      throw new Error("No se ha podido crear la sala; inténtalo de nuevo.");
    },

    async unirse(cod, nick) {
      exigirUid();
      const c = normalizarCodigo(cod);
      if (!c) throw new Error("La sala no existe.");
      const sala = await leerSala(c);
      if (!sala) throw new Error("La sala no existe.");
      if (sala.invitado || sala.fase !== "esperando") throw new Error("La sala está llena.");
      if (sala.creador === uid) throw new Error("Ya eres el creador de la sala.");
      // Escritura multi-ruta atómica; si otro se ha unido antes, las reglas la rechazan.
      await op(
        update(rutaSala(c), {
          invitado: uid,
          fase: "desplegando",
          [`jugadores/${uid}`]: { nick: limpiarNick(nick), listo: false, conectado: true },
        }),
        async () => ((await leerSala(c)) ? "La sala está llena." : "La sala no existe.")
      );
      fijarSala(c);
    },

    async retomar(cod) {
      exigirUid();
      const c = normalizarCodigo(cod);
      const sala = c ? await leerSala(c) : null;
      if (!sala) throw new Error("La sala no existe.");
      if (sala.creador !== uid && sala.invitado !== uid) throw new Error("No eres jugador de esta sala.");
      fijarSala(c);
      return sala;
    },

    async leerFlota() {
      if (!uid || !codigo) throw new Error("No estás en ninguna sala.");
      const snap = await op(get(rutaFlota()));
      return snap.val();
    },

    async guardarFlota(barcos) {
      const sala = await exigirSala();
      if (sala.fase !== "desplegando") throw new Error("No se puede guardar la flota ahora.");
      await op(set(rutaFlota(), barcos), async () => {
        const s = await leerSala();
        if (s?.jugadores[uid]?.listo) return "La flota ya está confirmada y no se puede cambiar.";
        if (s?.fase !== "desplegando") return "No se puede guardar la flota ahora.";
        return "La flota no es válida.";
      });
    },

    async marcarListo() {
      const sala = await exigirSala();
      if (sala.fase !== "desplegando") throw new Error("No se puede marcar listo ahora.");
      const flota = await op(get(rutaFlota()));
      if (!flota.exists()) throw new Error("Falta guardar la flota.");
      const cambios = { [`jugadores/${uid}/listo`]: true };
      const rival = rivalDe(sala);
      // Si el rival ya estaba listo, se empieza en la misma escritura. Si los dos marcan a la
      // vez sin verse, lo arregla alCambiarSala.
      if (rival && sala.jugadores[rival]?.listo) {
        cambios.fase = "jugando";
        cambios.turno = sala.creador;
      }
      try {
        await update(rutaSala(), cambios);
      } catch (err) {
        if (!cambios.fase || !esPermisoDenegado(err)) throw new Error(mensajeError(err));
        // Otro cliente ya empezó la partida entre la lectura y la escritura.
        const s = await leerSala();
        if (s?.fase === "jugando" && s.jugadores[uid]?.listo) return;
        throw new Error(s?.fase === "desplegando" ? mensajeError(err) : "No se puede marcar listo ahora.");
      }
    },

    async disparar(x, y) {
      const sala = await exigirSala();
      if (sala.fase !== "jugando") throw new Error("La partida no está en juego.");
      if (sala.turno !== uid) throw new Error("No es tu turno.");
      if (sala.pendiente) throw new Error("Hay un disparo pendiente de respuesta.");
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 9 || y > 9) {
        throw new Error("Disparo fuera del tablero.");
      }
      // Las reglas no pueden recorrer el historial: esto solo lo comprueba el cliente
      // (y verificarHistorial al final de la partida).
      if (sala.historial.some((e) => e.de === uid && e.x === x && e.y === y)) {
        throw new Error("Ya has disparado ahí.");
      }
      await op(set(ref(db, `salas/${codigo}/pendiente`), { de: uid, x, y }), async () => {
        const s = await leerSala();
        if (s?.fase !== "jugando") return "La partida no está en juego.";
        if (s.turno !== uid) return "No es tu turno.";
        if (s.pendiente) return "Hay un disparo pendiente de respuesta.";
        return null;
      });
    },

    async responder(res, cambios) {
      const sala = await exigirSala();
      if (sala.fase !== "jugando") throw new Error("La partida no está en juego.");
      const p = sala.pendiente;
      if (!p) throw new Error("No hay disparo pendiente.");
      if (p.de === uid) throw new Error("No puedes responder a tu propio disparo.");
      if (![sala.creador, sala.invitado].includes(cambios.turno)) throw new Error("Turno inválido.");
      if (!["agua", "tocado", "hundido"].includes(res.estado)) throw new Error("Estado inválido.");
      const n = sala.n;
      // Todo en una única actualización multi-ruta: o se aplica entera o no se aplica.
      const escritura = {
        [`historial/${n}`]: entradaHistorial(p, res),
        n: n + 1,
        pendiente: null,
        turno: cambios.turno,
      };
      if (cambios.fase === "final") {
        escritura.fase = "final";
        escritura.ganador = cambios.ganador ?? p.de;
        escritura.motivo = "flota hundida";
      }
      await op(update(rutaSala(), escritura), async () => {
        const s = await leerSala();
        if (s?.fase !== "jugando") return "La partida no está en juego.";
        if (!s.pendiente) return "No hay disparo pendiente.";
        return null;
      });
    },

    async revelar(flota) {
      const sala = await exigirSala();
      if (sala.fase !== "final") throw new Error("Solo se revela al terminar.");
      const guardada = (await op(get(rutaFlota()))).val();
      if (!mismaFlota(guardada, flota)) throw new Error("La flota revelada no coincide con la guardada.");
      if (sala.revelada[uid]) return; // ya revelada (las reglas no dejan reescribirla)
      await op(set(ref(db, `salas/${codigo}/revelada/${uid}`), guardada));
    },

    async abandonar() {
      const sala = await exigirSala();
      if (sala.fase === "final") return;
      const escritura = { fase: "final", motivo: "abandono" };
      const rival = rivalDe(sala);
      if (rival) escritura.ganador = rival;
      if (sala.pendiente) escritura.pendiente = null;
      await op(update(rutaSala(), escritura), async () => {
        const s = await leerSala();
        return s?.fase === "final" ? "La partida ya ha terminado." : null;
      });
    },

    escuchar(cb) {
      oyentes.add(cb);
      if (ultima !== undefined) {
        const sala = ultima;
        queueMicrotask(() => {
          if (oyentes.has(cb) && codigo) cb(sala);
        });
      }
      return () => oyentes.delete(cb);
    },
  };
}
