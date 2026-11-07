# Arquitectura

Dependencias en una sola dirección: `app` → `online`/`ia`/`modelo`; `online` → `protocolo`/`sala-remota`/`modelo`; `red-firebase` → `sala-remota`/`firebase-config`.

- `js/modelo.js` — reglas del juego, sin DOM. `Juego` → `Partida` (fases `inicial` → `desplegando` → `jugando` → `final`) → `Usuario` (dos `Tablero`, flota, contadores) → `Tablero`/`Barco`. Es la base heredada de una práctica multijugador. El disparo está partido en `resolverEn(atacado, x, y)` (lado defensor) y `aplicarResultado(atacante, x, y, res)` (lado atacante); `Partida.disparar` llama a las dos, así el modo contra el ordenador no cambia.
- `js/ia.js` — ver [ia.md](ia.md).
- `js/protocolo.js`, `js/online.js`, `js/sala-remota.js`, `js/red-firebase.js` — modo online, ver [online.md](online.md).
- `js/app.js` — interfaz: DOM por id, estado de la partida en la variable de módulo `e` (`e.modo` = `"ia"` | `"online"`), pinta tableros y orquesta turnos. Carga `red-firebase.js` con import dinámico solo al pulsar Crear sala/Unirse, para que el modo IA no dependa del SDK. Persiste nick, dificultad y modo en `localStorage` (siempre en try/catch).

Colocación (fase `desplegando`): se pulsa un barco de la lista y luego una casilla del tablero propio, que es el inicio del barco con la orientación elegida (fila "Orientación": Horizontal/Vertical, atajo `R`). Sin barco seleccionado, pulsar un barco colocado lo levanta para moverlo. Debajo van "Colocar al azar" y "Quitar todos".

Reglas del juego: tablero 10×10, flota estándar de 5 barcos (`FLOTA_ESTANDAR`), los barcos pueden ir pegados (también en diagonal) pero no solapados ni fuera del tablero, al hundir un barco no se marca agua alrededor, quien acierta repite turno, no se puede disparar dos veces a la misma casilla.
