import { describe, expect, it } from "vite-plus/test";
import { encodeIco, pngSize } from "./ico";

/** The PNG signature and an IHDR chunk with the given size, then filler bytes. */
function png(width: number, height: number, extra = 0) {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.fill(7, 33);
  return bytes;
}

describe("pngSize", () => {
  it("reads the size from the IHDR chunk", () => {
    expect(pngSize(png(48, 32))).toEqual({ width: 48, height: 32 });
  });

  it("rejects bytes that are not a PNG", () => {
    expect(() => pngSize(new Uint8Array(40))).toThrow("Not a PNG file");
  });
});

describe("encodeIco", () => {
  it("writes a header, one entry per image, and the images in order", () => {
    const images = [png(16, 16), png(32, 32, 5), png(48, 48, 2)];
    const ico = encodeIco(images);
    const view = new DataView(ico.buffer);
    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([
      0, 1, 3,
    ]);

    let offset = 6 + 16 * 3;
    images.forEach((image, i) => {
      const entry = 6 + 16 * i;
      const side = [16, 32, 48][i];
      expect(ico[entry]).toBe(side);
      expect(ico[entry + 1]).toBe(side);
      expect(view.getUint16(entry + 4, true)).toBe(1);
      expect(view.getUint16(entry + 6, true)).toBe(32);
      expect(view.getUint32(entry + 8, true)).toBe(image.length);
      expect(view.getUint32(entry + 12, true)).toBe(offset);
      expect(ico.slice(offset, offset + image.length)).toEqual(image);
      offset += image.length;
    });
    expect(ico.length).toBe(offset);
  });

  it("stores a 256-pixel side as 0", () => {
    const ico = encodeIco([png(256, 256)]);
    expect([ico[6], ico[7]]).toEqual([0, 0]);
  });

  it("rejects an image larger than 256 pixels", () => {
    expect(() => encodeIco([png(512, 512)])).toThrow("256 at most");
  });
});
