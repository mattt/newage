import type { APIRoute } from "astro";
import mark from "../../public/favicon.svg?raw";
import { iconSvg } from "../lib/icons";
import { imageResponse, transformImage } from "../lib/raster";

// iOS fills transparent pixels with black and rounds the corners, so the mark
// sits on an opaque background. Use the page background color; the mark
// itself is already a full square in that color, so it needs no margin.
export const GET: APIRoute = async ({ logger }) =>
  imageResponse(
    await transformImage(iconSvg(mark, 180), { format: "png", background: "#050506" }, logger),
    "image/png",
  );
