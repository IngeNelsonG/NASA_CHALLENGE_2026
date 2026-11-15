export const isMobile = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 768px)').matches;
export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** WebGL2 present and the device is not obviously low-end; otherwise the app uses the 2D map. */
export function canUse3D(): boolean {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    if ((nav.deviceMemory ?? 8) <= 2 || (nav.hardwareConcurrency ?? 8) <= 2) return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** GPUs that struggle with a full-screen globe at high pixel density (integrated or software). */
const WEAK_GPU = /Intel.*(HD|UHD) Graphics|Mali|Adreno \(TM\) [1-6]\d\d|PowerVR|SwiftShader|llvmpipe|Basic Render/i;

/**
 * First guess of whether this device should start the globe in light mode: few cores or little
 * memory, the browser's data saver, or a weak GPU. The frame-time monitor can still switch later.
 */
export function detectLowTier(): boolean {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    if ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData) return true;
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpu = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return WEAK_GPU.test(gpu);
  } catch {
    return false;
  }
}
