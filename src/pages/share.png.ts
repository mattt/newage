import { Buffer } from "node:buffer";
import type { APIRoute } from "astro";
// The share artwork as a data URL, inlined at build time.
import artwork from "../assets/new-age-of-the-city-screenshot.png?inline";
import { imageResponse } from "../lib/raster";
import { renderShareImage, SHARE_IMAGE } from "../lib/share-image";

// Check the rights to the artwork first: platforms keep their own copies of
// share images.
export const GET: APIRoute = async ({ logger }) => {
  const source = Buffer.from(artwork.slice(artwork.indexOf(",") + 1), "base64");
  return imageResponse(await renderShareImage(source, "#050506", logger), SHARE_IMAGE.type);
};
