import { describe, expect, it } from "vite-plus/test";
import { parseShareParams, shareUrl } from "./share";

describe("shareUrl", () => {
  it("builds the share URL with rounded coordinates and the map fragment", () => {
    const url = shareUrl(
      "https://ageofthe.city/?building=old#map=13/45.5/-122.6",
      { bldgId: "12345", yearBuilt: 1923, lat: 45.523123456, lng: -122.6760004 },
      "#map=17.25/45.52312/-122.676",
    );
    expect(url).toBe(
      "https://ageofthe.city/?building=12345&year=1923&lat=45.523123&lng=-122.676000#map=17.25/45.52312/-122.676",
    );
  });

  it("writes unknown for a building without a year", () => {
    const url = shareUrl("http://localhost:8792/", {
      bldgId: "A 1",
      yearBuilt: null,
      lat: 45.5,
      lng: -122.6,
    });
    expect(url).toBe(
      "http://localhost:8792/?building=A+1&year=unknown&lat=45.500000&lng=-122.600000",
    );
  });
});

describe("parseShareParams", () => {
  it("reads a share URL back", () => {
    const url = new URL(
      shareUrl("https://ageofthe.city/", {
        bldgId: "A 1",
        yearBuilt: 1923,
        lat: 45.523123,
        lng: -122.676,
      }),
    );
    expect(parseShareParams(url.search)).toEqual({
      bldgId: "A 1",
      yearBuilt: 1923,
      lat: 45.523123,
      lng: -122.676,
    });
  });

  it("reads an unknown or missing year as null", () => {
    expect(parseShareParams("?building=1&year=unknown&lat=45.5&lng=-122.6")?.yearBuilt).toBeNull();
    expect(parseShareParams("?building=1&lat=45.5&lng=-122.6")?.yearBuilt).toBeNull();
  });

  it("requires a building and valid coordinates", () => {
    expect(parseShareParams("")).toBeNull();
    expect(parseShareParams("?lat=45.5&lng=-122.6")).toBeNull();
    expect(parseShareParams("?building=1&lat=45.5")).toBeNull();
    expect(parseShareParams("?building=1&lat=&lng=-122.6")).toBeNull();
    expect(parseShareParams("?building=1&lat=north&lng=-122.6")).toBeNull();
    expect(parseShareParams("?building=1&lat=95&lng=-122.6")).toBeNull();
  });
});
