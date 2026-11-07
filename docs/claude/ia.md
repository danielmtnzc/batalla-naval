# IA

`js/ia.js` — clase `Almirante(tam, dificultad, rnd)`. Dificultades `facil` (azar y remate alrededor del impacto), `normal` (damero y remate en línea) y `dificil` (calcula dónde caben los barcos que quedan y dispara a la casilla más probable). Mantiene su propio estado (casillas descartadas, impactos sin hundir, tamaños restantes) y no lee el tablero rival directamente. `rnd` es inyectable para tests deterministas; los tests usan `semilla(s)` para partidas reproducibles.
