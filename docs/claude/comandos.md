# Comandos

```bash
npm test                                                  # node --test test/*.test.mjs (Node 18+)
node --test --test-name-pattern="texto" test/*.test.mjs   # un solo test, por nombre
python3 -m http.server 8000                               # servir en local (los módulos ES no funcionan con file://)
```

No hay linter ni paso de compilación. `test/red-memoria.mjs` no es un test (no termina en `.test.mjs`), es la red simulada que usan los tests online.

Firebase (la cuenta del proyecto es `danimc1079@gmail.com`; usa siempre `--account` para no depender de la cuenta activa):

```bash
firebase deploy --only database --project batalla-naval-dmc26 --account danimc1079@gmail.com
```

## Tests de las reglas (emulador)
`test-reglas/` tiene su propio `package.json` (la raíz sigue sin dependencias; `node_modules/` está ignorado). Prueba `database.rules.json` con `@firebase/rules-unit-testing` y `node:test` contra el emulador de Realtime Database, con el proyecto de demostración `demo-batalla-naval` (nunca toca el Firebase real).

```bash
cd test-reglas
npm install     # una sola vez
npm test        # firebase emulators:exec --only database --project demo-batalla-naval "node --test reglas.test.mjs"
```

Requisitos: Node 18+, `firebase-tools` global (`firebase`) y **JDK 21 o superior** (firebase-tools 15 rechaza Java anterior). La primera ejecución descarga el jar del emulador a `~/.cache/firebase/emulators`. `test-reglas/firebase.json` apunta a `../database.rules.json` y fija el puerto 9000.
