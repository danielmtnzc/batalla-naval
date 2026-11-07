# Arquitectura

Dependencias en una sola dirección: `app` → `online`/`ia`/`modelo`; `online` → `protocolo`/`sala-remota`/`modelo`; `red-firebase` → `sala-remota`/`firebase-config`.

- `js/modelo.js` — reglas del juego, sin DOM. `Juego` → `Partida` (fases `inicial` → `desplegando` → `jugando` → `final`) → `Usuario` (dos `Tablero`, flota, contadores) → `Tablero`/`Barco`. Es la base heredada de una práctica multijugador. El disparo está partido en `resolverEn(atacado, x, y)` (lado defensor) y `aplicarResultado(atacante, x, y, res)` (lado atacante); `Partida.disparar` llama a las dos, así el modo contra el ordenador no cambia.
- `js/ia.js` — ver [ia.md](ia.md).
- `js/protocolo.js`, `js/online.js`, `js/sala-remota.js`, `js/red-firebase.js` — modo online, ver [online.md](online.md).
- `js/app.js` — interfaz: DOM por id, estado de la partida en la variable de módulo `e` (`e.modo` = `"ia"` | `"online"`), pinta tableros y orquesta turnos. Carga `red-firebase.js` con import dinámico solo al pulsar Crear sala/Unirse, para que el modo IA no dependa del SDK. Persiste nick, dificultad y modo en `localStorage` (siempre en try/catch).

Reglas del juego: tablero 10×10, flota estándar de 5 barcos (`FLOTA_ESTANDAR`), los barcos no pueden tocarse ni en diagonal, al hundir un barco el agua alrededor se marca sola, quien acierta repite turno, no se puede disparar dos veces a la misma casilla.
