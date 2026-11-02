import { defineConfig } from "@playwright/test";

// Smoke tests run against the production build (`yarn build` first), served
// statically. 2D only: headless Chromium renders WWT through SwiftShader, which
// is fine for the sky view but too slow/black for a meaningful 3D check — keep
// the manual 3D checklist in README.md for that.
export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4180/",
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: "node tools/serve-dist.mjs 4180",
    url: "http://127.0.0.1:4180/",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
