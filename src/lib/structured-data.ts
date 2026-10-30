import stats from "../data/building-stats.json";
import { DATA_LICENSE, DATA_SOURCE, DESCRIPTION, SITE_NAME } from "./site";

export function structuredData(site: URL) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": new URL("/#website", site).href,
        name: SITE_NAME,
        description: DESCRIPTION,
        url: site.href,
        inLanguage: "en",
      },
      {
        "@type": "Dataset",
        "@id": new URL("/#dataset", site).href,
        name: "Portland Building Footprints by year built",
        description: DESCRIPTION,
        url: site.href,
        sameAs: DATA_SOURCE,
        creator: {
          "@type": "Organization",
          name: "City of Portland Bureau of Planning and Sustainability",
        },
        license: DATA_LICENSE,
        spatialCoverage: {
          "@type": "Place",
          name: "Portland, Oregon region",
          geo: {
            "@type": "GeoShape",
            // GeoShape uses south west north east order.
            box: [stats.bounds[1], stats.bounds[0], stats.bounds[3], stats.bounds[2]].join(" "),
          },
        },
        temporalCoverage: `${stats.earliestYear}/${stats.latestYear}`,
        variableMeasured: [{ "@type": "PropertyValue", name: "Year built" }],
        isAccessibleForFree: true,
      },
    ],
  };
}

/** Keep JSON safe inside an HTML script data block. */
export function serializeStructuredData(site: URL) {
  return JSON.stringify(structuredData(site)).replaceAll("<", "\\u003c");
}
