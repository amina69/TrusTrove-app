import { expect, type Page } from "@playwright/test";
import { connectWallet, test } from "./fixtures/freighter";
import { setupStellarNetworkMocks } from "./mocks";

async function setupDashboardApiMocks(page: Page) {
  // Mock the invoices list endpoint
  await page.route("**/invoices**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      }),
    });
  });

  // Mock the recent events endpoint
  await page.route("**/events**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

test.describe("Dashboard Smoke Test", () => {
  test("Dashboard renders key protocol stats and recent activity", async ({
    page,
  }) => {
    await setupStellarNetworkMocks(page);
    await setupDashboardApiMocks(page);
    await connectWallet(page, "/dashboard", "issuer");

    // Assert key protocol stats render
    await expect(page.getByText("Created")).toBeVisible();
    await expect(page.getByText("Currently Listed")).toBeVisible();
    await expect(page.getByText("Funded & Active")).toBeVisible();
    await expect(page.getByText("Total Repaid")).toBeVisible();
    await expect(page.getByText("Total Financed")).toBeVisible();

    // Assert recent activity section renders
    await expect(
      page.getByRole("heading", { name: /On-Chain Activity Logs/i }),
    ).toBeVisible();
    await expect(page.getByText(/No events recorded yet/i)).toBeVisible();

    // Assert issued invoices section renders
    await expect(
      page.getByRole("heading", { name: /Issued Invoices/i }),
    ).toBeVisible();
    await expect(page.getByText(/No invoices yet/i)).toBeVisible();

    // Assert management console renders
    await expect(
      page.getByRole("heading", { name: /Management console/i }),
    ).toBeVisible();
  });
});
