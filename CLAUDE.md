# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

"Batalla naval" (hundir la flota) en el navegador contra el ordenador. HTML, CSS y JavaScript puros con módulos ES: sin build, sin dependencias, sin bundler. Se publica con GitHub Pages (`.nojekyll`). Todo el texto, nombres de clases y comentarios están en español; mantenlo así.

## Comandos

```bash
npm test                                              # node --test test/*.test.mjs (Node 18+)
node --test --test-name-pattern="texto" test/*.test.mjs   # un solo test, por nombre
python3 -m http.server 8000                           # servir en local (los módulos ES no funcionan con file://)
```

No hay linter ni paso de compilación.

## Arquitectura

Tres módulos con dependencias en una sola dirección (`app` → `ia`/`modelo`, `ia` → `modelo`):

- `js/modelo.js` — reglas del juego, sin DOM. Jerarquía `Juego` (usuarios y partidas por código) → `Partida` (fases `inicial` → `desplegando` → `jugando` → `final`, turno, historial) → `Usuario` (dos `Tablero`, flota, contadores) → `Tablero`/`Barco`. `Horizontal`/`Vertical`/`Agua` son los estados de casilla/orientación. Es la base heredada de una práctica multijugador (servidor Node + MongoDB, ya eliminado); por eso conserva la noción de usuarios, códigos de partida y dos jugadores aunque aquí uno sea la IA. La IA juega como un `Usuario` más ("Almirante IA").
- `js/ia.js` — clase `Almirante`: elige disparos según la dificultad (`facil`/`normal`/`dificil`). Mantiene su propio estado (casillas descartadas, impactos sin hundir, tamaños de barco restantes) y no lee el tablero rival directamente. Acepta un `rnd` inyectable para tests deterministas.
- `js/app.js` — interfaz: obtiene los elementos del DOM por id, mantiene el estado de la partida en curso en una variable de módulo `e`, dibuja los tableros y orquesta el turno de la IA con un retardo (`RETARDO_IA`). Persiste nick y dificultad en `localStorage` (siempre dentro de try/catch).

Reglas que el modelo debe respetar: tablero 10×10, flota estándar de 5 barcos (`FLOTA_ESTANDAR`), los barcos no pueden tocarse ni en diagonal, al hundir un barco el agua alrededor se marca sola, quien acierta repite turno, no se puede disparar dos veces a la misma casilla.

## Tests

`test/modelo.test.mjs` cubre modelo e IA con `node:test`. Usa un generador pseudoaleatorio con semilla (`semilla(s)`) para que las partidas simuladas sean reproducibles; sigue ese patrón al probar la IA.
