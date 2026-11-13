// Web Mercator framing that matches MapLibre's camera with 512-pixel tiles,
// so that the buildings counted for a frame are the buildings in the frame.

export interface Camera {
  center: [lng: number, lat: number];
  zoom: number;
}

/** A frame size in CSS pixels; the device pixel ratio scales it for output. */
export interface Viewport {
  width: number;
  height: number;
}

const TILE = 512;

function worldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * TILE * 2 ** zoom;
}

function worldY(lat: number, zoom: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** zoom;
}

/**
 * Returns a function that maps a longitude and latitude to the frame,
 * as fractions from 0 to 1 across and down, or null when the point is outside.
 */
export function projector(camera: Camera, viewport: Viewport) {
  const { zoom } = camera;
  const cx = worldX(camera.center[0], zoom);
  const cy = worldY(camera.center[1], zoom);
  const left = cx - viewport.width / 2;
  const top = cy - viewport.height / 2;
  return (lng: number, lat: number): [x: number, y: number] | null => {
    const x = (worldX(lng, zoom) - left) / viewport.width;
    const y = (worldY(lat, zoom) - top) / viewport.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [x, y] : null;
  };
}
