import { expect, it } from "vite-plus/test";
import { OgBudget } from "./og-budget";

it("refills at six per minute and releases failed work", async () => {
  let now = 0;
  const budget = new OgBudget(() => now);
  for (let i = 0; i < 6; i++) await budget.run(String(i), async () => new Uint8Array([i]));
  expect(budget.run("empty", async () => new Uint8Array())).toBeNull();
  now = 10000;
  await expect(budget.run("retry", async () => { throw new Error("failure"); })).rejects.toThrow("failure");
  now = 20000;
  expect(await budget.run("retry", async () => new Uint8Array([1]))).toEqual(new Uint8Array([1]));
});
