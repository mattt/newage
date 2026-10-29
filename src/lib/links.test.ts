import { describe, expect, it } from "vite-plus/test";
import { appleMapsUrl, googleMapsUrl, portlandMapsUrl, streetViewUrl } from "./links";

describe("external links", () => {
  it("searches Google Maps for the point", () => {
    expect(googleMapsUrl("45.523100", "-122.676000")).toBe(
      "https://www.google.com/maps/search/?api=1&query=45.523100,-122.676000",
    );
  });

  it("opens Street View at the point", () => {
    expect(streetViewUrl("45.523100", "-122.676000")).toBe(
      "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=45.523100,-122.676000",
    );
  });

  it("encodes the Apple Maps label", () => {
    expect(appleMapsUrl("45.523100", "-122.676000", "1120 SW 5th Ave & Main")).toBe(
      "https://maps.apple.com/?ll=45.523100,-122.676000&q=1120%20SW%205th%20Ave%20%26%20Main",
    );
  });

  it("searches PortlandMaps for an address", () => {
    expect(portlandMapsUrl(" 1120 SW 5th Ave ")).toBe(
      "https://www.portlandmaps.com/search/?query=1120%20SW%205th%20Ave",
    );
  });

  it("links to the PortlandMaps home page without an address", () => {
    expect(portlandMapsUrl()).toBe("https://www.portlandmaps.com/");
    expect(portlandMapsUrl("  ")).toBe("https://www.portlandmaps.com/");
  });
});
