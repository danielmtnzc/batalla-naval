# Modo online

Dos jugadores en navegadores distintos sincronizados por Firebase Realtime Database con acceso anónimo. Sin servidor propio.

## Módulos
- `js/protocolo.js` — lógica pura: códigos de sala (5 caracteres de `ABCDEFGHJKMNPQRSTUVWXYZ23456789`), (de)serializar flota, `resolverDisparo`, `aplicarSala`, `validarDisparo`, `verificarHistorial`.
- `js/online.js` — controlador sin DOM que une `Red` + protocolo + modelo (crear/unirse/retomar sala, disparar, responder, abandonar, revelar y verificar). Lo usa `app.js`.
- `js/sala-remota.js` — normaliza lo que devuelve Firebase (sin nulls, arrays como objetos) y traduce errores al español.
- `js/red-firebase.js` — implementación real de la interfaz `Red` (SDK 13.1.0 por CDN de gstatic, versión fija). Interfaz: `entrar`, `crearSala`, `unirse`, `guardarFlota`, `marcarListo`, `disparar`, `responder`, `revelar`, `abandonar`, `escuchar`, `retomar`, `leerFlota`.
- `test/red-memoria.mjs` — misma interfaz en memoria, para tests sin Firebase.

## Datos
`salas/{codigo}`: creador, invitado, fase (`esperando`/`desplegando`/`jugando`/`final`), turno, ganador, motivo, `n` (disparos resueltos), `jugadores/{uid}`, `pendiente`, `historial/{i}`, `revelada/{uid}`. Las flotas van aparte en `flotas/{codigo}/{uid}`, solo legibles por su dueño. Reglas en `database.rules.json`.

## Protocolo de un disparo
El atacante escribe `pendiente`; el defensor lo resuelve con su tablero local y escribe en una sola actualización multi-ruta `historial/{n}`, `n+1`, `pendiente=null`, `turno` y, si procede, `fase`/`ganador`.

## Límites (anti-trampas)
El defensor es la autoridad sobre su tablero y podría mentir. Al terminar los dos publican su flota (`revelada`) y cada cliente ejecuta `verificarHistorial`; si no cuadra se muestra "resultado no verificable". Detecta trampas, no las impide (haría falta Cloud Functions y plan de pago). Las salas terminadas no se limpian solas.

## Estado de las reglas
Las reglas se escribieron por razonamiento y no se han probado contra Firebase real ni el emulador; hay una lista de casos pendientes de probar.
