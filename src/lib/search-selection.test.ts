import { expect, it } from "vite-plus/test";
import { canSelectSearch } from "./search-selection";

it("rejects stale and cleared answers, including during debounce", () => {
  expect(canSelectSearch("123 Main", "123 Main")).toBe(true);
  expect(canSelectSearch(" 123  Main ", "123 Main")).toBe(true);
  expect(canSelectSearch("456 Main", "123 Main")).toBe(false);
  expect(canSelectSearch("123 Main", "")).toBe(false);
  expect(canSelectSearch("", "")).toBe(false);
});
