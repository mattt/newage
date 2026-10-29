import { describe, expect, it } from "vite-plus/test";
import { iconSvg } from "./icons";

const mark =
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64" viewBox="0 0 128 64"><path d="M0 0h128v64H0z"/></svg>';

describe("iconSvg", () => {
  it("sets the size and centers the mark in a square viewBox", () => {
    expect(iconSvg(mark, 32)).toBe(
      '<svg width="32" height="32" viewBox="0 -32 128 128" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h128v64H0z"/></svg>',
    );
  });

  it("adds padding around the mark", () => {
    expect(iconSvg(mark, 180, 0.25)).toContain('viewBox="-64 -96 256 256"');
  });

  it("rejects a mark without a viewBox", () => {
    expect(() => iconSvg('<svg width="10" height="10"></svg>', 32)).toThrow("viewBox");
  });
});
