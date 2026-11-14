// Simulated UTC clock shared by the 3D scene and the 2D map. Starts at "now" and can run accelerated.
let base = Date.now();
let wall = performance.now();
let scale = 1;

export const simClock = {
  now: () => base + (performance.now() - wall) * scale,
  get scale() {
    return scale;
  },
  setScale(s: number) {
    base = simClock.now();
    wall = performance.now();
    scale = s;
  },
  reset() {
    base = Date.now();
    wall = performance.now();
  },
};
