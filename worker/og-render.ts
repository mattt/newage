import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import font from "./fonts/Anton-subset.ttf";
let ready: Promise<void> | undefined;
export async function renderPng(svg: string): Promise<Uint8Array> {
  await (ready ??= initWasm(wasm));
  const renderer = new Resvg(svg, {
    font: { fontBuffers: [new Uint8Array(font)], defaultFontFamily: "Anton" },
  });
  try {
    const image = renderer.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    try {
      renderer.free();
    } catch {
      /* Preserve a render error if WASM trapped. */
    }
  }
}
