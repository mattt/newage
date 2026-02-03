export const pmtiles_path = (name: string, setting?: string): string => {
  if (setting && setting.includes("{name}")) {
    return setting.replaceAll("{name}", name);
  }
  return `${name}.pmtiles`;
};

export const tile_path = (
  path: string
): {
  ok: boolean;
  name: string;
  tile?: [number, number, number];
  ext: string;
} => {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  if (!clean) return { ok: false, name: "", ext: "" };

  if (clean.endsWith(".json") && !clean.includes("/")) {
    return { ok: true, name: clean.slice(0, -5), ext: "json" };
  }

  const parts = clean.split("/");
  if (parts.length < 4) return { ok: false, name: "", ext: "" };

  const zStr = parts[parts.length - 3];
  const xStr = parts[parts.length - 2];
  const yExt = parts[parts.length - 1];
  const dot = yExt.lastIndexOf(".");
  if (dot === -1) return { ok: false, name: "", ext: "" };

  const yStr = yExt.slice(0, dot);
  const ext = yExt.slice(dot + 1);
  if (!/^[a-z]+$/.test(ext)) return { ok: false, name: "", ext: "" };

  const z = Number(zStr);
  const x = Number(xStr);
  const y = Number(yStr);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return { ok: false, name: "", ext: "" };
  }

  const name = parts.slice(0, parts.length - 3).join("/");
  return { ok: true, name, tile: [z, x, y], ext };
};
