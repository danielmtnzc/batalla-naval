# Firebase

- Proyecto: `batalla-naval-dmc26`, de la cuenta `danimc1079@gmail.com` (separada de los demás proyectos del usuario). Usa `--account danimc1079@gmail.com` en la CLI.
- App web registrada; su configuración pública está en `js/firebase-config.js` (no es un secreto, la seguridad la dan las reglas). `.firebaserc` y `firebase.json` apuntan a este proyecto y a `database.rules.json`.
- Base de datos: Realtime Database en `europe-west1`, URL `https://batalla-naval-dmc26-default-rtdb.europe-west1.firebasedatabase.app`.
- Pasos de consola que no se pueden hacer con la CLI sin modo interactivo: crear la Realtime Database (modo bloqueado), activar Authentication → Anónimo, y comprobar los dominios autorizados (`danielmtnzc.github.io`).
- Reglas: se publican con `firebase deploy --only database` (ver [comandos.md](comandos.md)).
