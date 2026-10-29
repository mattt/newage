const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER = 6;
const ENTRY = 16;

/** The width and height in a PNG's IHDR chunk, which always comes first. */
export function pngSize(png: Uint8Array) {
  if (png.length < 24 || PNG_SIGNATURE.some((byte, i) => png[i] !== byte)) {
    throw new Error("Not a PNG file");
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Packs PNG images into one ICO file: a 6-byte header, a 16-byte entry per
 * image, then the PNG files as they are. An entry stores 256 pixels as 0.
 */
export function encodeIco(pngs: Uint8Array[]) {
  const size = HEADER + ENTRY * pngs.length + pngs.reduce((sum, png) => sum + png.length, 0);
  const ico = new Uint8Array(size);
  const view = new DataView(ico.buffer);
  view.setUint16(2, 1, true); // Type 1 is an icon; bytes 0 and 1 are reserved.
  view.setUint16(4, pngs.length, true);
  let offset = HEADER + ENTRY * pngs.length;
  pngs.forEach((png, i) => {
    const { width, height } = pngSize(png);
    if (width > 256 || height > 256)
      throw new Error(`An icon image is ${width}×${height}; ICO allows 256 at most`);
    const entry = HEADER + ENTRY * i;
    view.setUint8(entry, width % 256);
    view.setUint8(entry + 1, height % 256);
    view.setUint16(entry + 4, 1, true); // Color planes
    view.setUint16(entry + 6, 32, true); // Bits per pixel
    view.setUint32(entry + 8, png.length, true);
    view.setUint32(entry + 12, offset, true);
    ico.set(png, offset);
    offset += png.length;
  });
  return ico;
}
