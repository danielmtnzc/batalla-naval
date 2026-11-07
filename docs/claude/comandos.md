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
