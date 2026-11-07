// Configuración web del proyecto de Firebase "batalla-naval-dmc26".
// No es un secreto: la seguridad la dan las reglas de database.rules.json.
export const firebaseConfig = {
  apiKey: "AIzaSyB7oSDnhXbFOKa_S5-plQh9rO8fvdgYYEE",
  authDomain: "batalla-naval-dmc26.firebaseapp.com",
  databaseURL: "https://batalla-naval-dmc26-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "batalla-naval-dmc26",
  storageBucket: "batalla-naval-dmc26.firebasestorage.app",
  messagingSenderId: "72826803809",
  appId: "1:72826803809:web:28c4cc50d743ab10df3c20",
};

// App Check (reCAPTCHA): solo la web publicada obtiene tokens válidos para usar la base de
// datos y Authentication. La site key es pública. Con `siteKey` vacía no se activa App Check
// y la app funciona igual (útil mientras no esté configurado en la consola).
// `enterprise: true` si la clave es de reCAPTCHA Enterprise; `false` si es reCAPTCHA v3.
export const appCheckConfig = {
  siteKey: "",
  enterprise: false,
};
