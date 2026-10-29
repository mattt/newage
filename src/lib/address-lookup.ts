// Decides when a reverse geocoded address can go into the building popup.
// The lookup takes a moment, and in that time the user can select another
// building or close the popup, so the answer must still belong to the
// selection that asked for it.

export interface SelectionKey {
  bldgId: string;
  lat: number;
  lng: number;
}

export function sameSelection(a: SelectionKey | null, b: SelectionKey | null): boolean {
  return a !== null && b !== null && a.bldgId === b.bldgId && a.lat === b.lat && a.lng === b.lng;
}

/** True when the tile already gives the building an address. */
export function hasAddress(properties: Record<string, unknown> | undefined): boolean {
  const value = properties?.address;
  return (typeof value === "string" || typeof value === "number") && String(value).trim() !== "";
}

/**
 * True when a lookup for `captured` can fill `target`:
 * the label is not empty, `captured` is still the latest selection,
 * and `target`, the address element of its popup, is still on the page and empty.
 */
export function canFillAddress(
  label: string | null,
  captured: SelectionKey,
  latest: SelectionKey | null,
  target: { isConnected: boolean; textContent: string | null } | null,
): boolean {
  return (
    label !== null &&
    label.trim() !== "" &&
    sameSelection(captured, latest) &&
    target !== null &&
    target.isConnected &&
    (target.textContent ?? "") === ""
  );
}
