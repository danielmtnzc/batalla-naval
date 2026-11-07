# Firebase

- Proyecto: `batalla-naval-dmc26`, de la cuenta `danimc1079@gmail.com` (separada de los demás proyectos del usuario). Usa `--account danimc1079@gmail.com` en la CLI.
- App web registrada; su configuración pública está en `js/firebase-config.js` (no es un secreto, la seguridad la dan las reglas). `.firebaserc` y `firebase.json` apuntan a este proyecto y a `database.rules.json`.
- Base de datos: Realtime Database en `europe-west1`, URL `https://batalla-naval-dmc26-default-rtdb.europe-west1.firebasedatabase.app`.
- Pasos de consola que no se pueden hacer con la CLI sin modo interactivo: crear la Realtime Database (modo bloqueado), activar Authentication → Anónimo, y comprobar los dominios autorizados (`danielmtnzc.github.io`).
- App Check (reCAPTCHA) para que solo la web publicada pueda usar Database y Auth:
  - Código: `appCheckConfig` en `js/firebase-config.js` (`siteKey`, pública, y `enterprise`: `true` para reCAPTCHA Enterprise/Fraud Defense, `false` para reCAPTCHA v3). `js/red-firebase.js` llama a `initializeAppCheck` antes de `getAuth`/`getDatabase`. Con `siteKey` vacía no se activa y todo funciona como sin App Check.
  - En `localhost`/`127.0.0.1` activa el token de depuración (`FIREBASE_APPCHECK_DEBUG_TOKEN = true`): el navegador lo imprime en la consola y hay que darlo de alta en App Check → Apps → menú de la app → Administrar tokens de depuración para que el desarrollo local funcione con la aplicación obligatoria activada.
  - Estado actual: `siteKey` vacía; la app web **no está registrada** en App Check y la API de reCAPTCHA Enterprise **no está habilitada** en Google Cloud. Aplicación obligatoria (enforcement) **desactivada** en Realtime Database y Authentication.
  - Opción prevista: reCAPTCHA Enterprise en el nivel gratuito Essentials (sin facturación, hasta 10.000 evaluaciones/mes). reCAPTCHA v3 clásico exige pegar la clave secreta en la consola de Firebase.
  - Para activarla: habilitar la API de reCAPTCHA Enterprise en el proyecto, crear una clave web con dominios `danielmtnzc.github.io` (y `localhost` si se quiere), registrar la app en App Check con esa clave, ponerla en `siteKey` con `enterprise: true`, publicar en GitHub Pages, esperar a que las métricas de App Check muestren casi todo como solicitudes verificadas y solo entonces activar la aplicación obligatoria en Realtime Database y en Authentication.
- Reglas: se publican con `firebase deploy --only database` (ver [comandos.md](comandos.md)).
