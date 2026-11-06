# Batalla naval

El clásico juego de barcos (tocado y hundido) para jugar en el navegador contra el ordenador.

**Jugar:** https://danielmtnzc.github.io/batalla-naval/

## Cómo se juega

1. Coloca tu flota: elige un barco, gíralo con <kbd>R</kbd> y pulsa en tu tablero. También puedes colocarla al azar.
2. Pulsa **¡A la batalla!** y dispara en las aguas enemigas.
3. Si aciertas, vuelves a disparar; si das en el agua, le toca al rival.
4. Gana quien hunda primero toda la flota contraria.

Reglas:

- Tablero de 10 × 10.
- Flota: portaaviones (5), acorazado (4), crucero (3), submarino (3) y destructor (2).
- Los barcos no pueden tocarse, ni siquiera en diagonal. Cuando hundes uno, el agua de alrededor se marca sola.

El ordenador tiene tres niveles:

| Nivel | Cómo juega | Media de disparos para ganar |
|---|---|---|
| Fácil | Dispara al azar y remata lo que toca | ~56 |
| Normal | Busca en damero y remata en línea | ~43 |
| Difícil | Calcula dónde caben los barcos que quedan | ~39 |

## Estructura

```
index.html        página del juego
css/estilos.css   estilos
js/modelo.js      reglas: Juego, Usuario, Partida, Tablero, Barco, Horizontal, Vertical, Agua
js/ia.js          el rival controlado por el ordenador
js/app.js         interfaz: dibuja los tableros y gestiona los clics
test/             pruebas del modelo y de la IA
```

No necesita compilación ni dependencias: es HTML, CSS y JavaScript puro, publicado con GitHub Pages.

## Origen

Es una reconstrucción de una práctica de la universidad (diciembre de 2022). Aquella versión era multijugador, con servidor Node.js y registros en MongoDB Atlas. De ella solo se conservaba el `modelo.js`, que sirve de base para este.

Diferencias con el modelo original:

- Funciona sin servidor; se juega contra el ordenador.
- Flota completa de cinco barcos en lugar de solo dos (`b2` y `b4`).
- Corrige algunos fallos del original:
  - Los barcos verticales no se podían hundir.
  - La comprobación de casillas libres no recorría todo el barco.
  - Se podía disparar dos veces a la misma casilla.

## Probar en local

```bash
npm test                     # pruebas (Node 18 o superior)
python3 -m http.server 8000  # y abrir http://localhost:8000
```
