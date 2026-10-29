import type { APIRoute } from "astro";
import mark from "../../public/favicon.svg?raw";
import { iconSvg } from "../lib/icons";
import { imageResponse, transformImage } from "../lib/raster";

// Google Search prefers favicons whose size is a multiple of 48 pixels.
export function getStaticPaths() {
  return [96, 192, 512].map((size) => ({ params: { size: String(size) } }));
}

export const GET: APIRoute = async ({ params, logger }) =>
  imageResponse(
    await transformImage(iconSvg(mark, Number(params.size)), { format: "png" }, logger),
    "image/png",
  );
