import type { APIContext } from "astro";
import { getConfiguredImageService, imageConfig } from "astro:assets";

type Transform = {
  format: "png";
  width?: number;
  /** For PNG, any quality turns on sharp's palette mode. */
  quality?: number;
  /** Fills transparent pixels, for a platform that shows them as black. */
  background?: string;
};

/**
 * Runs Astro's image service (sharp) on image bytes, for endpoints that need
 * the bytes; getImage() returns only a URL. An SVG renders at its own width and
 * height. Astro renders SVG only with dangerouslyProcessSVG, because a crafted
 * SVG can be costly to render; these calls render only the site's own files,
 * so they set it and the rest of the site does not.
 */
export async function transformImage(
  input: Uint8Array | string,
  transform: Transform,
  logger: APIContext["logger"],
) {
  const service = await getConfiguredImageService();
  if (!("transform" in service))
    throw new Error("The image service cannot transform images at build time");
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  // astro:assets resolves `service` to this environment's entry point and
  // config, the shape transform() takes, but types it as the config file's.
  const config = { ...imageConfig, dangerouslyProcessSVG: true } as Parameters<
    typeof service.transform
  >[2];
  const { data } = await service.transform(
    bytes,
    { src: typeof input === "string" ? "inline.svg" : "inline", ...transform },
    config,
    logger,
  );
  return data;
}

/** A response with an endpoint's image bytes and their Content-Type. */
export function imageResponse(data: Uint8Array, type: string) {
  return new Response(data as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": type } });
}
