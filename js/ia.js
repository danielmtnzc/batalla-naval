// El rival controlado por el ordenador.
//  - fácil:   dispara al azar y, cuando toca algo, prueba las casillas de alrededor.
//  - normal:  busca en damero (no hace falta mirar todas las casillas) y remata en línea.
//  - difícil: calcula dónde caben aún los barcos que quedan y dispara a la casilla más probable.

import { FLOTA_ESTANDAR } from "./modelo.js";

const clave = (x, y) => `${x},${y}`;
const ORTOGONALES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Almirante {
  constructor(tam = 10, dificultad = "normal", rnd = Math.random) {
    this.tam = tam;
    this.dificultad = dificultad;
    this.rnd = rnd;
    this.descartadas = new Set(); // casillas ya disparadas
    this.impactos = []; // tocados de barcos aún sin hundir
    this.restantes = FLOTA_ESTANDAR.map((b) => b.tam);
  }

  libre(x, y) {
    return x >= 0 && y >= 0 && x < this.tam && y < this.tam && !this.descartadas.has(clave(x, y));
  }

  azar(lista) {
    return lista[Math.floor(this.rnd() * lista.length)];
  }

  elegirDisparo() {
    return this.rematar() || this.buscar();
  }

  rematar() {
    if (!this.impactos.length) return null;
    let candidatos = [];

    if (this.dificultad !== "facil" && this.impactos.length >= 2) {
      const [x0, y0] = this.impactos[0];
      if (this.impactos.every(([, y]) => y === y0)) {
        const xs = this.impactos.map(([x]) => x);
        candidatos = [[Math.min(...xs) - 1, y0], [Math.max(...xs) + 1, y0]];
      } else if (this.impactos.every(([x]) => x === x0)) {
        const ys = this.impactos.map(([, y]) => y);
        candidatos = [[x0, Math.min(...ys) - 1], [x0, Math.max(...ys) + 1]];
      }
      candidatos = candidatos.filter(([x, y]) => this.libre(x, y));
    }

    if (!candidatos.length) {
      for (const [x, y] of this.impactos) {
        for (const [dx, dy] of ORTOGONALES) {
          if (this.libre(x + dx, y + dy)) candidatos.push([x + dx, y + dy]);
        }
      }
    }
    return candidatos.length ? this.azar(candidatos) : null;
  }

  buscar() {
    const libres = [];
    for (let x = 0; x < this.tam; x++) {
      for (let y = 0; y < this.tam; y++) if (this.libre(x, y)) libres.push([x, y]);
    }
    if (!libres.length) return null;
    if (this.dificultad === "facil") return this.azar(libres);

    if (this.dificultad === "normal") {
      const paso = Math.min(...this.restantes, 2);
      const damero = libres.filter(([x, y]) => (x + y) % paso === 0);
      return this.azar(damero.length ? damero : libres);
    }

    // difícil: mapa de probabilidad
    const peso = new Map();
    for (const tam of this.restantes) {
      for (let x = 0; x < this.tam; x++) {
        for (let y = 0; y < this.tam; y++) {
          for (const [dx, dy] of [[1, 0], [0, 1]]) {
            let cabe = true;
            for (let i = 0; i < tam && cabe; i++) cabe = this.libre(x + dx * i, y + dy * i);
            if (!cabe) continue;
            for (let i = 0; i < tam; i++) {
              const k = clave(x + dx * i, y + dy * i);
              peso.set(k, (peso.get(k) || 0) + 1);
            }
          }
        }
      }
    }
    let max = -1;
    let mejores = [];
    for (const [x, y] of libres) {
      const w = peso.get(clave(x, y)) || 0;
      if (w > max) {
        max = w;
        mejores = [[x, y]];
      } else if (w === max) {
        mejores.push([x, y]);
      }
    }
    return this.azar(mejores);
  }

  registrar(resultado) {
    if (!resultado || resultado.error) return;
    this.descartadas.add(clave(resultado.x, resultado.y));
    if (resultado.estado === "tocado") {
      this.impactos.push([resultado.x, resultado.y]);
    } else if (resultado.estado === "hundido") {
      const hundidas = new Set(resultado.barco.posiciones.map(([x, y]) => clave(x, y)));
      this.impactos = this.impactos.filter(([x, y]) => !hundidas.has(clave(x, y)));
      for (const k of hundidas) this.descartadas.add(k);
      const i = this.restantes.indexOf(resultado.barco.tam);
      if (i >= 0) this.restantes.splice(i, 1);
    }
  }
}
