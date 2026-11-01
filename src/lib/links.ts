// Links from a selected building to other map services.
// Each takes coordinates already rounded for display, such as by formatCoordinate.

export function googleMapsUrl(lat: string, lng: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function streetViewUrl(lat: string, lng: string): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

export function appleMapsUrl(lat: string, lng: string, label: string): string {
  return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(label)}`;
}

/**
 * PortlandMaps has no link by coordinates, so search for the address,
 * using the search URL from https://www.portlandmaps.com/opensearch.xml.
 * Without an address, link to the home page.
 */
export function portlandMapsUrl(address?: string | null): string {
  const query = address?.trim();
  if (!query) return "https://www.portlandmaps.com/";
  return `https://www.portlandmaps.com/search/?query=${encodeURIComponent(query)}`;
}
