import { test, expect, Page, ConsoleMessage } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Smoke tests against the production build (`yarn build` first). They use
// the live WWT data servers, as the real client does.

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") { return; }
    const text = msg.text();
    if (/Failed to load resource|net::ERR_|status of 404/.test(text)) { return; }
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function boot(page: Page, query = ""): Promise<void> {
  await page.goto(`./?debug=1${query}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => (window as any).wwtNext?.result.value, null, { timeout: 90_000 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mixerState = (page: Page) => page.evaluate(() => (window as any).wwtNext.mixer.layers.map((l: any) => ({ id: l.place.id, pct: l.pct, pinned: l.pinned })));

test("boots, lists images in view and keeps the view in the URL", async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  const rows = page.locator(".rail .iv-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(5);
  await expect(page.locator(".rail-where")).toContainText("Orion");
  await expect.poll(() => new URL(page.url()).searchParams.get("fov")).not.toBeNull();
  expect(errors).toEqual([]);
});

test("In view searches every constellation, not just the one at the centre", async ({ page }) => {
  // Centre in Orion, next to the Monoceros border (Rosette Nebula on screen).
  await boot(page, "&ra=93.75&dec=4&fov=10");
  await page.waitForTimeout(1500);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cons = await page.evaluate(() => { const r = (window as any).wwtNext.result.value; return Array.from(new Set([...r.fit, ...r.wide, ...r.small].map((i: any) => i.place.constellation))); });
  expect(cons).toContain("ORI");
  expect(cons).toContain("MON");
});

test("search by name opens the image card and previews the image in the mixer", async ({ page }) => {
  await boot(page);
  const box = page.getByRole("combobox");
  await box.fill("NIRCam Orion");
  await expect(page.locator(".search-results [role=option]").first()).toBeVisible();
  await box.press("Enter");
  await expect(page.locator(".card-title")).toContainText("NIRCam");
  await expect.poll(async () => (await mixerState(page)).length).toBe(1);
  expect((await mixerState(page))[0].pinned).toBe(false);
  await page.getByRole("button", { name: "Keep in mix" }).click();
  expect((await mixerState(page))[0].pinned).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".card-title")).toHaveCount(0);
});

test("search understands coordinates", async ({ page }) => {
  await boot(page);
  const box = page.getByRole("combobox");
  await box.fill("10h45m03s -59d41m04s");
  await expect(page.locator(".search-results .sr-kind.coords")).toBeVisible();
  await box.press("Enter");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await expect.poll(() => page.evaluate(() => Math.round((window as any).wwtNext.engine.decRad * 180 / Math.PI)), { timeout: 20_000 }).toBe(-60);
});

test("mixer: add images, sweep, solo, and share the mix in the URL", async ({ page }) => {
  await boot(page, "&ra=83.8221&dec=-5.3911&fov=0.25");
  await page.waitForTimeout(1500);
  const adds = page.locator(".rail .iv-add");
  await adds.nth(0).click();
  await adds.nth(1).click();
  await adds.nth(2).click();
  await expect.poll(async () => (await mixerState(page)).length).toBe(3);
  await page.locator(".dock-head .ib").click();
  const sweep = page.locator("#mx-sweep");
  await sweep.fill("100");
  const s = await mixerState(page);
  expect(s.map((l: { pct: number }) => l.pct)).toEqual([100, 100, 0]);
  await page.locator(".mx-layer").first().getByRole("button", { name: /Show only/ }).click();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on = await page.evaluate(() => (window as any).wwtNext.mixer.layers.map((l: any) => l.on));
  expect(on).toEqual([false, false, true]);
  await expect.poll(() => new URL(page.url()).searchParams.get("layers")?.split(",").length).toBe(3);
});

test("a shared URL restores the view, the mix and the selected image", async ({ page }) => {
  await boot(page, "&ra=83.8085&dec=-5.3873&fov=0.21&layers=orion-nebula-m42-1rxae:100,orion-nebula-1brgf:40,long-wavelength-nircam-orion-neb-17ybe:100&place=long-wavelength-nircam-orion-neb-17ybe&mode=swipe");
  await expect.poll(async () => (await mixerState(page)).length).toBe(3);
  expect((await mixerState(page)).map((l: { pct: number }) => l.pct)).toEqual([100, 40, 100]);
  await expect(page.locator(".card-title")).toContainText("Long-wavelength NIRCam");
  await expect(page.locator(".swipe-line")).toBeVisible();
});

test("Explore lists the collections and opens one", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Explore collections and tours" }).click();
  await page.locator(".ex-card", { hasText: "JWST" }).first().click();
  await expect(page.locator(".ex-crumbs")).toContainText("JWST");
  expect(await page.locator(".ex-card").count()).toBeGreaterThan(20);
  await page.getByRole("tab", { name: "Tours" }).click();
  await expect(page.locator(".ex-tour").first()).toBeVisible();
});

test("shows an error card, not a spinner, when the image index can't load", async ({ page }) => {
  await page.route("**/searchdata_v2.min.js", (r) => r.abort());
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "WorldWide Telescope couldn't start" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("no serious accessibility violations", async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(1000);
  const results = await new AxeBuilder({ page }).exclude("canvas").analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("telescope filter chips narrow the In view list", async ({ page }) => {
  await boot(page, "&ra=83.8221&dec=-5.3911&fov=0.4");
  await page.waitForTimeout(1500);
  const chip = page.locator(".rail .iv-filters .chip", { hasText: "JWST" });
  await chip.click();
  const tags = await page.locator(".rail .iv-row .iv-meta").allInnerTexts();
  expect(tags.length).toBeGreaterThan(0);
  for (const t of tags) { expect(t).toContain("JWST"); }
  await chip.click();
  expect(await page.locator(".rail .iv-row").count()).toBeGreaterThan(tags.length);
});

test("right-click on the sky says what's there", async ({ page }) => {
  await boot(page, "&ra=83.8221&dec=-5.3911&fov=0.4");
  await page.waitForTimeout(1500);
  const vw = page.viewportSize()!;
  // Centre of the sky area (left of the In view panel).
  await page.mouse.click((vw.width - 360) / 2, vw.height / 2, { button: "right" });
  await expect(page.locator(".card-title")).toBeVisible();
});

test("Scrub all puts every image in view in the mixer and steps through them", async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page, "&ra=83.8221&dec=-5.3911&fov=0.4");
  await page.waitForTimeout(1500);
  await page.locator(".rail .iv-scrub").click();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reelLen = () => page.evaluate(() => (window as any).wwtNext.mixer.reel.length);
  await expect.poll(reelLen).toBeGreaterThan(5);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect(await page.evaluate(() => (window as any).wwtNext.mixer.mode)).toBe("scrub");
  await expect(page.locator(".mx-now").first()).toContainText(`1/${await reelLen()}`);

  // Only the shown image and its neighbours are enabled, however long the reel.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const states = () => page.evaluate(() => (window as any).wwtNext.engineLayerStates() as { enabled: boolean; opacity: number }[]);
  let s = await states();
  expect(s.filter((l) => l.enabled).length).toBeLessThanOrEqual(4);
  expect(s.filter((l) => l.opacity > 0).length).toBe(1);

  // Halfway between images 3 and 4, both are fully opaque (no dip to the background).
  await page.locator("#mx-scrub").fill("250");
  s = await states();
  expect(s.filter((l) => l.opacity > 0.99).length).toBe(2);
  expect(s.filter((l) => l.enabled).length).toBeLessThanOrEqual(4);

  await page.getByRole("button", { name: "Next image" }).click();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await expect.poll(() => page.evaluate(() => (window as any).wwtNext.mixer.scrubPos)).toBe(3);
  await expect.poll(() => new URL(page.url()).searchParams.get("mode")).toBe("scrub");
  expect(new URL(page.url()).searchParams.get("pos")).toBe("3");

  await page.getByRole("button", { name: "Play through the images" }).click();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await expect.poll(() => page.evaluate(() => (window as any).wwtNext.mixer.scrubIndex), { timeout: 10_000 }).toBeGreaterThan(3);
  await page.getByRole("button", { name: "Pause" }).click();
  expect(errors).toEqual([]);
});
