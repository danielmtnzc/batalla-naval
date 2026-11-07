// Controlador del modo online: une la red (interfaz `Red`), el protocolo y el modelo.
// No toca el DOM ni importa Firebase: la interfaz (app.js) le pasa callbacks y lee su estado,
// y los tests lo usan con la red en memoria (test/red-memoria.mjs).
//
// Callbacks (todos opcionales):
//   alCambiar()              algo ha cambiado: hay que volver a pintar
//   alDisparo(entrada, propio)  un disparo ya resuelto entra en el historial (propio = lo hice yo)
//   alFin(resultado)         la partida ha terminado: { gano, abandono, ganador, motivo }
//   alVerificar(v)           resultado de verificar al rival: { ok: true } | { ok: false, motivo }
//   alError(texto)           algo ha fallado (texto en español)
// Los métodos nunca lanzan: devuelven {} si va bien o { error } (y avisan por alError).

import { Usuario, TAM_TABLERO } from "./modelo.js";
import {
  crearUsuarioLocal,
  serializarFlota,
  deserializarFlota,
  crearEstadoLocal,
  validarDisparo,
  resolverDisparo,
  aplicarSala,
  verificarHistorial,
  normalizarCodigo,
  listaHistorial,
  rivalDe,
} from "./protocolo.js";

const CLAVE_SALA = "hlf-sala";

// Rival "fantasma": un Usuario con la flota sin desplegar, solo para que la interfaz pueda
// contar barcos a flote y dibujar su lista (los barcos se marcan hundidos desde el historial).
export function crearRivalFantasma(nick = "Rival") {
  const usr = new Usuario(nick, null);
  usr.inicializarTableros(TAM_TABLERO);
  usr.inicializarFlota();
  return usr;
}

// Guarda el código de sala para poder volver tras recargar. Todo dentro de try/catch:
// el almacenamiento puede no existir (Node) o estar bloqueado.
export function almacenSala(clave = CLAVE_SALA) {
  const nombres = ["sessionStorage", "localStorage"];
  return {
    leer() {
      for (const n of nombres) {
        try {
          const v = globalThis[n]?.getItem(clave);
          if (v) return v;
        } catch { /* sin almacenamiento */ }
      }
      return null;
    },
    guardar(codigo) {
      for (const n of nombres) {
        try { globalThis[n]?.setItem(clave, codigo); } catch { /* sin almacenamiento */ }
      }
    },
    borrar() {
      for (const n of nombres) {
        try { globalThis[n]?.removeItem(clave); } catch { /* sin almacenamiento */ }
      }
    },
  };
}

const textoError = (err) => String(err?.message ?? err ?? "Error desconocido.");

export function crearControlador({
  red,
  nick,
  usuario = crearUsuarioLocal(nick),
  almacen = almacenSala(),
  alCambiar = () => {},
  alDisparo = () => {},
  alFin = () => {},
  alVerificar = () => {},
  alError = () => {},
  esperaVerificacion = 15000, // ms que se espera la flota del rival antes de dar el resultado por no verificable
} = {}) {
  let uid = null;
  let codigo = null;
  let sala = null;
  let estado = null;
  let baja = null;
  let enVuelo = false; // disparo propio enviado y aún sin respuesta
  let respondiendo = null; // "x,y" del disparo rival que se está resolviendo
  let listo = false;
  let flotaGuardada = false;
  let terminado = false;
  let cerrado = false;
  let perdida = false; // la sala ha desaparecido
  let resultado = null;
  let verificacion = null; // null | { ok: true } | { ok: false, motivo }
  let rivalRevelado = null;
  let verificada = false;
  let temporizador = null;
  const hundidosRival = new Set();

  const fallo = (err) => {
    const error = textoError(err);
    alError(error);
    return { error };
  };

  async function iniciarSesion() {
    if (uid) return;
    uid = await red.entrar();
    estado = crearEstadoLocal(uid, usuario);
  }

  function suscribir() {
    baja?.();
    baja = red.escuchar(alSala);
  }

  function recordar(c) {
    codigo = c;
    almacen.guardar(c);
  }

  // ------------------------------------------------------------ entrar en una sala

  async function crearSala() {
    if (codigo) return fallo("Ya estás en una sala.");
    try {
      await iniciarSesion();
      const c = await red.crearSala(nick);
      recordar(c);
      suscribir();
      return { codigo: c };
    } catch (err) {
      return fallo(err);
    }
  }

  async function retomarInterno(c) {
    if (typeof red.retomar !== "function") throw new Error("No se puede volver a la partida.");
    await iniciarSesion();
    await red.retomar(c);
    try {
      const flota = await red.leerFlota?.();
      if (flota && deserializarFlota(flota, usuario)) flotaGuardada = true;
    } catch { /* si no se puede leer, se vuelve a colocar */ }
    recordar(c);
    suscribir();
  }

  async function retomar(texto) {
    const c = normalizarCodigo(texto);
    if (!c) return fallo("El código de sala no es válido.");
    if (codigo) return fallo("Ya estás en una sala.");
    try {
      await retomarInterno(c);
      return { codigo: c, retomada: true };
    } catch (err) {
      const msg = textoError(err);
      // La sala ya no existe (o ya no soy jugador): se olvida el código sin mostrar error.
      if (/no existe|no eres jugador/i.test(msg)) {
        almacen.borrar();
        return { error: msg, caducada: true };
      }
      return fallo(err);
    }
  }

  // Une a la sala `texto` (código o enlace ?sala=). Si ya soy jugador de esa sala, la retoma.
  async function unirse(texto) {
    const c = normalizarCodigo(texto);
    if (!c) return fallo("El código de sala no es válido: son 5 letras o cifras.");
    if (codigo) return fallo("Ya estás en una sala.");
    try {
      await iniciarSesion();
      if (almacen.leer() === c) {
        try {
          await retomarInterno(c);
          return { codigo: c, retomada: true };
        } catch { /* se intenta unirse normalmente */ }
      }
      try {
        await red.unirse(c, nick);
      } catch (err) {
        try {
          await retomarInterno(c); // quizá ya estaba dentro (p. ej. abre su propio enlace)
          return { codigo: c, retomada: true };
        } catch {
          throw err;
        }
      }
      recordar(c);
      suscribir();
      return { codigo: c };
    } catch (err) {
      return fallo(err);
    }
  }

  // ------------------------------------------------------------ acciones de la partida

  async function marcarListo() {
    if (!estado || !codigo) return fallo("Todavía no estás en una sala.");
    if (listo) return {};
    if (estado.fase !== "desplegando") return fallo("Espera a que se una tu rival.");
    let barcos;
    try {
      barcos = serializarFlota(usuario);
    } catch (err) {
      return fallo(err);
    }
    try {
      await red.guardarFlota(barcos);
      flotaGuardada = true;
      await red.marcarListo();
      listo = true;
    } catch (err) {
      return fallo(err);
    } finally {
      alCambiar();
    }
    return {};
  }

  async function disparar(x, y) {
    if (!estado || !codigo) return fallo("Todavía no estás en una sala.");
    if (enVuelo) return { error: "Espera la respuesta del rival." };
    const motivo = validarDisparo(estado, x, y, sala?.pendiente ?? null);
    if (motivo) return fallo(motivo);
    enVuelo = true;
    alCambiar();
    try {
      await red.disparar(x, y);
      return {};
    } catch (err) {
      enVuelo = false;
      return fallo(err);
    } finally {
      alCambiar();
    }
  }

  async function abandonar() {
    if (!estado || terminado) return {};
    try {
      await red.abandonar();
      return {};
    } catch (err) {
      return fallo(err);
    }
  }

  // Vuelve a resolver un disparo del rival que no llegó a responderse (p. ej. tras un corte de red).
  async function reintentar() {
    const p = sala?.pendiente;
    if (p && p.de !== uid) await responder(p);
  }

  function cerrar({ olvidar = true } = {}) {
    cerrado = true;
    baja?.();
    baja = null;
    clearTimeout(temporizador);
    if (olvidar) almacen.borrar();
  }

  // ------------------------------------------------------------ reacción a la sala

  async function responder(p) {
    if (estado.fase !== "jugando") return;
    const clave = `${p.x},${p.y}`;
    if (respondiendo === clave) return;
    respondiendo = clave;
    try {
      const r = resolverDisparo(usuario, p.x, p.y, uid, p.de);
      if (r.error) return void alError(r.error);
      await red.responder(r.res, r.cambios);
    } catch (err) {
      // Si la respuesta ya estaba escrita (evento duplicado o tardío) no es un error.
      const msg = textoError(err);
      if (!/No hay disparo pendiente/i.test(msg) && estado.fase === "jugando") alError(msg);
    } finally {
      respondiendo = null;
    }
  }

  async function alSala(nueva) {
    if (cerrado) return;
    if (!nueva) {
      // La sala se borra si su creador se desconecta mientras esperaba rival.
      if (codigo && !terminado) {
        perdida = true;
        sala = null;
        almacen.borrar();
        alError("La sala ya no existe.");
        alCambiar();
      }
      return;
    }
    sala = nueva;
    const { nuevas, pendiente } = aplicarSala(estado, nueva);
    if (nueva.jugadores?.[uid]?.listo) listo = true;
    for (const n of nuevas) {
      if (n.propio) {
        enVuelo = false;
        if (n.entrada.estado === "hundido") hundidosRival.add(n.entrada.barco.nombre);
      }
      alDisparo(n.entrada, n.propio);
    }
    if (nueva.fase === "final") enVuelo = false;
    alCambiar();
    if (pendiente) await responder(pendiente);
    if (nueva.fase === "final") await alFinal(nueva);
  }

  async function alFinal(s) {
    if (!terminado) {
      terminado = true;
      enVuelo = false;
      almacen.borrar();
      resultado = {
        gano: s.ganador === uid,
        abandono: s.motivo === "abandono",
        ganador: s.ganador,
        motivo: s.motivo,
      };
      alFin(resultado);
      alCambiar();
      // Sin disparos míos no hay respuestas del rival que comprobar.
      if (!listaHistorial(s.historial).some((h) => h.de === uid)) {
        verificada = true;
        verificacion = { ok: true, vacia: true };
        alVerificar(verificacion);
      } else {
        temporizador = setTimeout(() => {
          if (cerrado || verificada) return;
          verificacion = { ok: false, motivo: "el rival no ha revelado su flota" };
          alVerificar(verificacion);
          alCambiar();
        }, esperaVerificacion);
        temporizador.unref?.();
      }
      if (flotaGuardada) {
        try {
          await red.revelar(serializarFlota(usuario));
        } catch { /* no es crítico: solo impide que el rival me verifique */ }
      }
    }
    verificarRival(s);
  }

  function verificarRival(s) {
    if (verificada) return;
    const ruid = rivalDe(s, uid);
    const flota = ruid && s.revelada?.[ruid];
    if (!flota) return;
    verificada = true;
    clearTimeout(temporizador);
    const v = verificarHistorial(s.historial, flota, ruid);
    verificacion = v.ok ? { ok: true } : { ok: false, motivo: v.motivo, indice: v.indice };
    const revelado = crearUsuarioLocal("rival");
    if (deserializarFlota(flota, revelado)) rivalRevelado = revelado;
    alVerificar(verificacion);
    alCambiar();
  }

  // ------------------------------------------------------------ lectura del estado

  return {
    crearSala,
    unirse,
    retomar,
    marcarListo,
    disparar,
    abandonar,
    reintentar,
    cerrar,

    get uid() { return uid; },
    get codigo() { return codigo; },
    get usuario() { return usuario; },
    get estado() { return estado; },
    get sala() { return sala; },
    get listo() { return listo; },
    get terminado() { return terminado; },
    get perdida() { return perdida; },
    get resultado() { return resultado; },
    get verificacion() { return verificacion; },
    get rivalRevelado() { return rivalRevelado; },
    get hundidosRival() { return hundidosRival; },
    // Disparo propio enviado y sin respuesta todavía (también tras recargar con un disparo en el aire).
    get esperando() { return enVuelo || (sala?.pendiente != null && sala.pendiente.de === uid); },
    // Fase para la interfaz: desplegando (incluye esperar rival) | listo | jugando | final.
    get fase() {
      const f = estado?.fase ?? "esperando";
      if (f === "jugando" || f === "final") return f;
      return listo ? "listo" : "desplegando";
    },
    get historial() {
      return listaHistorial(sala?.historial).map((h) => ({ ...h, propio: h.de === uid }));
    },
    // { uid, nick, estado }: esperando | colocando | listo | jugando | desconectado | fin
    get rival() {
      if (!sala) return null;
      const ruid = rivalDe(sala, uid);
      if (!ruid) return { uid: null, nick: null, estado: "esperando" };
      const j = sala.jugadores?.[ruid];
      let est;
      if (j?.conectado === false) est = "desconectado";
      else if (sala.fase === "final") est = "fin";
      else if (sala.fase === "jugando") est = "jugando";
      else est = j?.listo ? "listo" : "colocando";
      return { uid: ruid, nick: j?.nick || "Rival", estado: est };
    },
  };
}
