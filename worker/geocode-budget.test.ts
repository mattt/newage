import { expect, it } from "vite-plus/test";
import { GeocodeBudget } from "./geocode-budget";

it("refills at 20/minute and releases failed work", async () => {
  let now = 0;
  const budget = new GeocodeBudget(() => now);
  for (let i = 0; i < 20; i++) await budget.run(String(i), async () => "ok");
  expect(budget.run("empty", async () => "no")).toBeNull();
  now = 3000;
  await expect(budget.run("refilled", async () => { throw new Error("failure"); })).rejects.toThrow("failure");
  now = 6000;
  expect(await budget.run("refilled", async () => "retry")).toBe("retry");
});
