import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Generous per-test budget: in dev the first hit on a route includes
  // Next's on-demand compile.
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.CI
    ? {
        command: "pnpm run start",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          // Must match the contract IDs injected into the CI `pnpm build`
          // step, or the inlined client bundle would be built from different
          // values than the server.
          NEXT_PUBLIC_REGISTRY_CONTRACT_ID:
            process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID ?? "",
          NEXT_PUBLIC_INVOICE_CONTRACT_ID:
            process.env.NEXT_PUBLIC_INVOICE_CONTRACT_ID ?? "",
          NEXT_PUBLIC_POOL_CONTRACT_ID:
            process.env.NEXT_PUBLIC_POOL_CONTRACT_ID ?? "",
          NEXT_PUBLIC_ESCROW_CONTRACT_ID:
            process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID ?? "",
        },
      }
    : {
        command: "pnpm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
