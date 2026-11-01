import type { APIRoute } from "astro";
import mark from "../../public/favicon.svg?raw";
import { iconSvg } from "../lib/icons";
import { imageResponse, transformImage } from "../lib/raster";

// A 30% margin keeps the entire square mark inside the maskable safe circle.
export const GET: APIRoute = async ({ logger }) =>
  imageResponse(
    await transformImage(iconSvg(mark, 512, 0.3), { format: "png", background: "#050506" }, logger),
    "image/png",
  );
