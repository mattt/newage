/**
 * An SVG mark as a square SVG document `size` pixels wide, centered, with
 * `padding` (a share of the side) around the mark. The mark's root element
 * needs a viewBox. Look at the result at 16 and 32 pixels: a detailed mark may
 * need thicker strokes or fewer lines at small sizes.
 */
export function iconSvg(svg: string, size: number, padding = 0): string {
  const open = svg.match(/<svg\b[^>]*>/)?.[0];
  const box = open
    ?.match(/\bviewBox="([^"]+)"/)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!open || !box || box.length !== 4 || box.some(Number.isNaN))
    throw new Error("The icon SVG needs a viewBox on its root element");
  const [x, y, width, height] = box as [number, number, number, number];
  const side = Math.max(width, height) / (1 - 2 * padding);
  const viewBox = [x + width / 2 - side / 2, y + height / 2 - side / 2, side, side].join(" ");
  const root = open
    .replace(/\s(width|height|viewBox)="[^"]*"/g, "")
    .replace(/^<svg\b/, `<svg width="${size}" height="${size}" viewBox="${viewBox}"`);
  return svg.replace(open, root);
}
