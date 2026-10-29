import { formatHex, interpolate } from "culori";

export const STOPS = [
  [1885, "#30fbff"],
  [1920, "#74d5fe"],
  [1940, "#8eabff"],
  [1955, "#b986fa"],
  [1965, "#ed7cfa"],
  [1975, "#fd29ec"],
  [1995, "#ff8cf4"],
  [2010, "#ffc8fb"],
  [2025, "#fff4fe"],
] as const;
export interface Selection {
  building: string;
  year: number | null;
  lat: number;
  lng: number;
}
export function parseSelection(url: URL): Selection | null {
  const q = url.searchParams;
  if (["building", "year", "lat", "lng"].some((k) => q.getAll(k).length !== 1)) return null;
  const building = q.get("building")!;
  const raw = q.get("year")!;
  const year = raw === "unknown" ? null : /^\d{4}$/.test(raw) ? Number(raw) : NaN;
  const lat = Number(q.get("lat"));
  const lng = Number(q.get("lng"));
  if (
    !/^[A-Za-z0-9-]{1,128}$/.test(building) ||
    (year !== null && (!Number.isInteger(year) || year < 1700 || year > 2100)) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < 45.35 ||
    lat > 45.72 ||
    lng < -122.95 ||
    lng > -122.25
  )
    return null;
  return { building, year, lat, lng };
}
export function yearColor(year: number | null): string {
  if (year === null || !Number.isFinite(year) || year <= 0) return "#3a3a3d";
  if (year <= 1885) return STOPS[0][1];
  if (year >= 2025) return STOPS.at(-1)![1];
  const i = STOPS.findIndex(([y]) => y >= year);
  const a = STOPS[i - 1],
    b = STOPS[i];
  return formatHex(interpolate([a[1], b[1]], "lab")((year - a[0]) / (b[0] - a[0])))!;
}
export function tilePoint(lat: number, lng: number, z: number) {
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * 2 ** z,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z,
  };
}
export function metadata(url: URL, version: string, epoch: number) {
  const s = url.pathname === "/" ? parseSelection(url) : null;
  if (!s) return null;
  const image = new URL("/og/building.png", url.origin);
  for (const [k, v] of Object.entries(s))
    image.searchParams.set(k, v === null ? "unknown" : String(v));
  image.searchParams.set("v", version);
  image.searchParams.set("asof", String(epoch));
  const title = `${s.year === null ? "Year built unknown" : `Built in ${s.year}`} — New Age of the City`;
  return {
    title,
    image: image.href,
    description: `Explore this Portland building and its neighbors, colored by year built. Location: ${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}.`,
  };
}
export interface Shape {
  id: string;
  year: number | null;
  rings: { x: number; y: number }[][];
}
export function cardSvg(s: Selection, shapes: Shape[], epoch: number): string {
  let chosen = shapes.find((f) => f.id === s.building);
  if (!chosen) {
    let best = Infinity;
    for (const f of shapes)
      for (const ring of f.rings) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i],
            b = ring[j];
          if (a.y > 315 !== b.y > 315 && 880 < ((b.x - a.x) * (315 - a.y)) / (b.y - a.y) + a.x)
            inside = !inside;
        }
        const distance = inside
          ? 0
          : Math.min(...ring.map((p) => (p.x - 880) ** 2 + (p.y - 315) ** 2));
        if (distance < best) {
          best = distance;
          chosen = f;
        }
      }
  }
  const paths = shapes
    .map(
      (f) =>
        `<path d="${f.rings.map((r) => r.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("") + "Z").join("")}" fill="${yearColor(f.year)}" fill-rule="evenodd" stroke="${f === chosen ? "#ffffff" : "#050506"}" stroke-width="${f === chosen ? 3 : 0.6}" opacity="${f === chosen ? 1 : 0.7}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><clipPath id="map"><rect x="570" y="0" width="630" height="630"/></clipPath></defs><rect width="1200" height="630" fill="#050506"/><g clip-path="url(#map)">${paths}</g><g font-family="Anton" fill="#fff4fe"><text x="48" y="80" font-size="30">New Age of the City</text><text x="48" y="220" font-size="40">${s.year === null ? "Year built" : "Built in"}</text><text x="48" y="345" font-size="116" fill="${yearColor(s.year)}">${s.year ?? "unknown"}</text><text x="48" y="410" font-size="28">${s.year === null ? "Year built unknown" : s.year > epoch ? `As of ${epoch}` : `${epoch - s.year} years old · ${epoch}`}</text><text x="48" y="535" font-size="22">${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}</text><text x="48" y="580" font-size="22">ageofthe.city · Portland, Oregon</text></g></svg>`;
}
