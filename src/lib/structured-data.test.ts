import { describe, expect, it } from "vite-plus/test";
import stats from "../data/building-stats.json";
import { serializeStructuredData } from "./structured-data";
import { DATA_LICENSE, DATA_SOURCE, DESCRIPTION, SITE_NAME } from "./site";

describe("home page structured data", () => {
  it("serializes the site and the source dataset with coverage and licensing", () => {
    const data = JSON.parse(serializeStructuredData(new URL("https://ageofthe.city/")));
    expect(data["@context"]).toBe("https://schema.org");
    const [site, dataset] = data["@graph"];
    expect(site).toMatchObject({
      "@type": "WebSite",
      name: SITE_NAME,
      description: DESCRIPTION,
      url: "https://ageofthe.city/",
      inLanguage: "en",
    });
    expect(dataset).toMatchObject({
      "@type": "Dataset",
      name: expect.any(String),
      description: DESCRIPTION,
      creator: {
        "@type": "Organization",
        name: "City of Portland Bureau of Planning and Sustainability",
      },
      license: DATA_LICENSE,
      sameAs: DATA_SOURCE,
      isAccessibleForFree: true,
      temporalCoverage: `${stats.earliestYear}/${stats.latestYear}`,
      spatialCoverage: { "@type": "Place", name: "Portland, Oregon region", geo: { "@type": "GeoShape" } },
      variableMeasured: [{ "@type": "PropertyValue", name: "Year built" }],
    });
    const [south, west, north, east] = dataset.spatialCoverage.geo.box.split(" ").map(Number);
    expect([west, south, east, north]).toEqual(stats.bounds);
    expect(south).toBeLessThan(north);
    expect(west).toBeLessThan(east);
  });
});
