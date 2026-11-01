import { Buffer } from "node:buffer";
import type { APIContext } from "astro";
import { pngSize } from "./ico";
import { transformImage } from "./raster";

/** The size most platforms show in a link preview. Keep each file well under 1 MB. */
export const SHARE_IMAGE = { width: 1200, height: 630, type: "image/png" } as const;

/**
 * Contains a PNG on a solid background at the share size, without enlarging
 * it. getImage() cannot pad an image to a size, so this resizes the source,
 * draws it centered in an SVG of the share size, and renders that SVG.
 */
export async function renderShareImage(
  source: Uint8Array,
  background: string,
  logger: APIContext["logger"],
) {
  const { width, height } = pngSize(source);
  const scale = Math.min(SHARE_IMAGE.width / width, SHARE_IMAGE.height / height, 1);
  const resized = await transformImage(
    source,
    { format: "png", width: Math.round(width * scale) },
    logger,
  );
  const size = pngSize(resized);
  const x = Math.round((SHARE_IMAGE.width - size.width) / 2);
  const y = Math.round((SHARE_IMAGE.height - size.height) / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_IMAGE.width}" height="${SHARE_IMAGE.height}">
<image href="data:image/png;base64,${Buffer.from(resized).toString("base64")}" x="${x}" y="${y}" width="${size.width}" height="${size.height}"/>
</svg>`;
  return transformImage(svg, { format: "png", background, quality: 85 }, logger);
}
