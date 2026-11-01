import { describe, expect, it } from "vite-plus/test";
import { canFillAddress, hasAddress, sameSelection } from "./address-lookup";

const a = { bldgId: "101", lat: 45.52333, lng: -122.68164 };
const target = { isConnected: true, textContent: "" };

describe("sameSelection", () => {
  it("compares the building and its point", () => {
    expect(sameSelection(a, { ...a })).toBe(true);
    expect(sameSelection(a, { ...a, bldgId: "102" })).toBe(false);
    expect(sameSelection(a, { ...a, lat: 45.5 })).toBe(false);
    expect(sameSelection(a, null)).toBe(false);
  });
});

describe("hasAddress", () => {
  it("reads a non-blank address property", () => {
    expect(hasAddress({ address: "1005 W BURNSIDE ST" })).toBe(true);
    expect(hasAddress({ address: "  " })).toBe(false);
    expect(hasAddress({ address: null })).toBe(false);
    expect(hasAddress({})).toBe(false);
    expect(hasAddress(undefined)).toBe(false);
  });
});

describe("canFillAddress", () => {
  it("fills the popup of the selection that asked", () => {
    expect(canFillAddress("1005 West Burnside Street", a, { ...a }, target)).toBe(true);
  });

  it("skips an empty label", () => {
    expect(canFillAddress(null, a, a, target)).toBe(false);
    expect(canFillAddress(" ", a, a, target)).toBe(false);
  });

  it("skips a lookup that a later selection replaced", () => {
    expect(canFillAddress("1 Main St", a, { ...a, bldgId: "102" }, target)).toBe(false);
  });

  it("skips a closed popup or an address that is already there", () => {
    expect(canFillAddress("1 Main St", a, a, null)).toBe(false);
    expect(canFillAddress("1 Main St", a, a, { isConnected: false, textContent: "" })).toBe(false);
    expect(canFillAddress("1 Main St", a, a, { isConnected: true, textContent: "2 Oak St" })).toBe(
      false,
    );
  });
});
