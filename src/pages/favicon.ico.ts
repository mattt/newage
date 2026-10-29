import type { APIRoute } from "astro";
import mark from "../../public/favicon.svg?raw";
import { encodeIco } from "../lib/ico";
import { iconSvg } from "../lib/icons";
import { imageResponse, transformImage } from "../lib/raster";

// Browsers, feed readers, and crawlers request /favicon.ico without reading
// the page's icon links.
export const GET: APIRoute = async ({ logger }) => {
  const pngs = await Promise.all(
    [16, 32, 48].map((size) => transformImage(iconSvg(mark, size), { format: "png" }, logger)),
  );
  return imageResponse(encodeIco(pngs), "image/x-icon");
};
