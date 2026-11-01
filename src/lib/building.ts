// Reading and describing the properties of a building tile feature.
// Every property but bldg_id and year_built is optional,
// and the City's data leaves many of them empty.

export type BuildingProperties = Record<string, unknown>;

/** Returns the year built, or null when it is unknown (stored as -1). */
export function yearBuilt(properties: BuildingProperties): number | null {
  const value = Number(properties.year_built);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Returns a property as trimmed text, or null when it is missing or blank. */
export function textProperty(properties: BuildingProperties, name: string): string | null {
  const value = properties[name];
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** Returns a property as a positive number, or null. */
export function numberProperty(properties: BuildingProperties, name: string): number | null {
  const value = properties[name];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function decadeLabel(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}

export function ageLabel(year: number, currentYear: number): string {
  const age = currentYear - year;
  if (age < 1) return "less than a year";
  return age === 1 ? "1 year" : `${age} years`;
}

/** Formats a coordinate with six decimal places, about 10 centimeters. */
export function formatCoordinate(value: number): string {
  return value.toFixed(6);
}
