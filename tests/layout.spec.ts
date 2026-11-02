import { test, expect, Page } from "@playwright/test";

// Overlap check: on every screen size and in every UI state, the visible
// panels must not overlap each other or run off screen. Popovers that are
// meant to cover other panels (Explore, settings, search results) are only
// checked against the top bar and the screen edges.

const SIZES: [string, number, number][] = [
  ["desktop", 1440, 900],
  ["laptop", 1280, 720],
  ["tablet", 1024, 768],
  ["tablet-portrait", 768, 1024],
  ["phone", 390, 844],
  ["phone-landscape", 844, 390],
];

const PANELS = [".brand", ".search", ".top-actions", ".status-chip", ".rail", ".rail-tab", ".dock", ".card-wrap", ".sheet", ".phone-mixbar", ".edge"];
const OVERLAYS = [".settings", ".explore-wrap"];

interface Box { sel: string; x: number; y: number; w: number; h: number }

async function boxes(page: Page, sels: string[]): Promise<Box[]> {
  return page.evaluate((sels) => {
    const out: Box[] = [];
    for (const sel of sels) {
      document.querySelectorAll(sel).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none") { return; }
        out.push({ sel: `${sel}#${i}`, x: r.left, y: r.top, w: r.width, h: r.height });
      });
    }
    return out;
  }, sels);
}

function overlaps(a: Box, b: Box): boolean {
  const pad = 1;
  return a.x + pad < b.x + b.w && b.x + pad < a.x + a.w && a.y + pad < b.y + b.h && b.y + pad < a.y + a.h;
}

async function check(page: Page, label: string): Promise<string[]> {
  const vw = page.viewportSize()?.width ?? 0, vh = page.viewportSize()?.height ?? 0;
  const panels = await boxes(page, PANELS);
  const overlays = await boxes(page, OVERLAYS);
  const top = panels.filter((b) => /brand|search|top-actions/.test(b.sel));
  const problems: string[] = [];
  for (const b of [...panels, ...overlays]) {
    if (b.x < -1 || b.y < -1 || b.x + b.w > vw + 1 || b.y + b.h > vh + 1) { problems.push(`${label}: ${b.sel} off screen`); }
  }
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      if (overlaps(panels[i], panels[j])) { problems.push(`${label}: ${panels[i].sel} overlaps ${panels[j].sel}`); }
    }
  }
  for (const o of overlays) { for (const t of top) { if (overlaps(o, t)) { problems.push(`${label}: ${o.sel} overlaps ${t.sel}`); } } }
  return problems;
}

for (const [name, w, h] of SIZES) {
  test(`no overlaps: ${name} ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("./?debug=1&ra=83.8221&dec=-5.3911&fov=0.4");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.waitForFunction(() => (window as any).wwtNext?.result.value, null, { timeout: 90_000 });
    await page.waitForTimeout(800);
    const problems: string[] = [];
    problems.push(...await check(page, "start"));

    // Open an image (card) and put two images in the mix.
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = (window as any).wwtNext;
      const r = a.result.value;
      const items = [...r.fit, ...r.small];
      await a.mixer.add(items[1].place);
      a.openPlace(items[0].place);
    });
    await page.waitForTimeout(1200);
    problems.push(...await check(page, "card+mix"));

    // Expand the mixer (desktop dock or phone sheet tab).
    const dockToggle = page.locator(".dock-head .ib");
    if (await dockToggle.count()) { await dockToggle.click(); } else { await page.getByRole("tab", { name: /Mixer/ }).click(); }
    await page.waitForTimeout(600);
    problems.push(...await check(page, "mixer open"));

    await page.getByRole("button", { name: "Explore collections and tours" }).click();
    await page.waitForTimeout(600);
    problems.push(...await check(page, "explore"));
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "View settings" }).click();
    await page.waitForTimeout(300);
    problems.push(...await check(page, "settings"));

    expect(problems).toEqual([]);
  });
}
