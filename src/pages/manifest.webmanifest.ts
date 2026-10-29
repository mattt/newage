import type { APIRoute } from "astro";
import { DESCRIPTION, SITE_NAME } from "../lib/site";

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: SITE_NAME,
      short_name: "New Age",
      description: DESCRIPTION,
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#050506",
      theme_color: "#050506",
      icons: [
        { src: "/favicon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/favicon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    }),
    { headers: { "Content-Type": "application/manifest+json" } },
  );
