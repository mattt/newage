// Builds the contents of the popup for a selected building.
// Feature data goes in only as text, never as HTML.
import {
  ageLabel,
  decadeLabel,
  formatCoordinate,
  numberProperty,
  textProperty,
  type BuildingProperties,
} from "../lib/building";
import { appleMapsUrl, googleMapsUrl, portlandMapsUrl, streetViewUrl } from "../lib/links";

export interface Selection {
  bldgId: string;
  yearBuilt: number | null;
  lat: number;
  lng: number;
  properties: BuildingProperties;
}

const numbers = new Intl.NumberFormat("en-US");

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(text: string, href: string): HTMLLIElement {
  const item = element("li");
  const anchor = element("a", undefined, text);
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  item.append(anchor);
  return item;
}

/** A short description of the building, for the Apple Maps label and announcements. */
export function describe(selection: Selection): string {
  const address = textProperty(selection.properties, "address");
  if (address) return address;
  return selection.yearBuilt === null
    ? "Building of unknown year"
    : `Building built in ${selection.yearBuilt}`;
}

export function popupContent(selection: Selection, onShare: () => void): HTMLElement {
  const { properties, yearBuilt } = selection;
  const root = element("div", "building");

  root.append(
    element("p", "building-year", `Year built: ${yearBuilt === null ? "unknown" : yearBuilt}`),
  );

  // A later change looks up addresses and fills this in when the tiles have none.
  // CSS hides it while it is empty.
  const address = element("p", "building-address", textProperty(properties, "address") ?? "");
  address.id = "building-address";
  root.append(address);

  const details = element("dl");
  const row = (term: string, value: string | null) => {
    if (value === null) return;
    details.append(element("dt", undefined, term), element("dd", undefined, value));
  };
  if (yearBuilt !== null) {
    row("Age", ageLabel(yearBuilt, new Date().getFullYear()));
    row("Decade", decadeLabel(yearBuilt));
  }
  row("Neighborhood", textProperty(properties, "neighborhood"));
  row("Use", textProperty(properties, "bldg_use"));
  const sqft = numberProperty(properties, "bldg_sqft");
  row("Square feet", sqft === null ? null : numbers.format(Math.round(sqft)));
  const stories = numberProperty(properties, "num_story");
  row("Stories", stories === null ? null : numbers.format(stories));
  const lat = formatCoordinate(selection.lat);
  const lng = formatCoordinate(selection.lng);
  row("Coordinates", `${lat}, ${lng}`);
  root.append(details);

  const links = element("ul", "building-links");
  links.append(
    link("Google Maps", googleMapsUrl(lat, lng)),
    link("Street View", streetViewUrl(lat, lng)),
    link("Apple Maps", appleMapsUrl(lat, lng, describe(selection))),
    link("PortlandMaps", portlandMapsUrl(textProperty(properties, "address"))),
  );
  root.append(links);

  const share = element(
    "button",
    "share-link",
    typeof navigator.share === "function" ? "Share link" : "Copy link",
  );
  share.type = "button";
  share.addEventListener("click", onShare);
  root.append(share);

  return root;
}
