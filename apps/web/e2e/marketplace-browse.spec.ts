import { expect } from "@playwright/test";
import { connectWallet, test } from "./fixtures/freighter";
import { setupStellarNetworkMocks } from "./mocks";

const MOCK_WALLET = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";

const MOCK_INVOICES = [
  {
    id: "inv-listed-001",
    issuer: MOCK_WALLET,
    buyer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    face_value: "10000000000",
    asset: "USDC",
    discount_bps: 200,
    funded_amount: "8000000000",
    due_date: 1735689600,
    status: "Listed",
    created_at: 1735603200,
    funded_at: null,
    shipped_at: null,
    issuer_confirmed: true,
    buyer_confirmed: false,
    repaid_at: null,
    listed_at: 1735603200,
    issuer_confirmed_at: null,
    buyer_confirmed_at: null,
    defaulted_at: null,
    transaction_hashes: ["hash1"],
    tx_hashes: ["txhash1"],
    created_tx_hash: "created_tx_hash_val",
    listed_tx_hash: "listed_tx_hash_val",
    funded_tx_hash: null,
    shipped_tx_hash: null,
    issuer_confirmed_tx_hash: null,
    buyer_confirmed_tx_hash: null,
    repaid_tx_hash: null,
    defaulted_tx_hash: null,
  },
  {
    id: "inv-funded-002",
    issuer: MOCK_WALLET,
    buyer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    face_value: "5000000000",
    asset: "USDC",
    discount_bps: 150,
    funded_amount: "4250000000",
    due_date: 1735689600,
    status: "Funded",
    created_at: 1735603200,
    funded_at: 1735603200,
    shipped_at: null,
    issuer_confirmed: true,
    buyer_confirmed: false,
    repaid_at: null,
    listed_at: 1735603200,
    issuer_confirmed_at: null,
    buyer_confirmed_at: null,
    defaulted_at: null,
    transaction_hashes: ["hash2"],
    tx_hashes: ["txhash2"],
    created_tx_hash: "created_tx_hash_val",
    listed_tx_hash: "listed_tx_hash_val",
    funded_tx_hash: "funded_tx_hash_val",
    shipped_tx_hash: null,
    issuer_confirmed_tx_hash: null,
    buyer_confirmed_tx_hash: null,
    repaid_tx_hash: null,
    defaulted_tx_hash: null,
  },
];

async function setupMarketplaceApiMocks(page) {
  // Mock the invoices list endpoint, filtering by status query param
  await page.route("**/invoices**", async (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status");
    const filtered = status
      ? MOCK_INVOICES.filter((inv) => inv.status === status)
      : MOCK_INVOICES;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: filtered,
        total: filtered.length,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
    });
  });

  // Mock the pool stats endpoint
  await page.route("**/pool**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        availableLiquidity: "10000000000",
        totalFunded: "5000000000",
        totalRepaid: "0",
      }),
    });
  });

  // Mock the profile endpoint
  await page.route("**/profile**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        address: MOCK_WALLET,
        verified: true,
        role: "lp",
      }),
    });
  });
}

test.describe("Marketplace Browse & Filter Flow", () => {
  test("loads marketplace, filters listed invoices by status, and views details", async ({
    page,
  }) => {
    await setupStellarNetworkMocks(page);
    await setupMarketplaceApiMocks(page);
    await connectWallet(page, "/marketplace");

    // Assert the marketplace page loads
    await expect(
      page.getByRole("heading", { name: /Invoice Marketplace/i }),
    ).toBeVisible();

    // Default filter is "Listed" — the listed invoice should be visible
    // (IDs are truncated in the table, e.g. "inv-li...-001")
    await expect(
      page.getByRole("gridcell", { name: "inv-li..." }),
    ).toBeVisible();
    await expect(
      page.getByRole("gridcell", { name: "inv-fu..." }),
    ).not.toBeVisible();

    // Filter by "Funded" status
    await page.locator("main select").first().selectOption("Funded");

    // The funded invoice should now be visible, and the listed one hidden
    await expect(
      page.getByRole("gridcell", { name: "inv-fu..." }),
    ).toBeVisible();
    await expect(
      page.getByRole("gridcell", { name: "inv-li..." }),
    ).not.toBeVisible();

    // Select the funded invoice to view its details in the Management Center
    // Rows are absolutely-positioned virtualized <tr> elements; click the row
    // that contains the funded invoice's id cell.
    await page.getByRole("row", { name: /inv-fu\.\.\.-002/i }).click();

    // Assert the management center shows the selected invoice details.
    // Scope to the Management Center column: the ledger table also renders a
    // hidden (md:hidden) mobile card per row, so unscoped getByText hits a
    // strict-mode violation on the duplicated labels.
    const managementCenter = page
      .getByRole("heading", { name: /Management Center/i })
      .locator("..");
    await expect(
      page.getByRole("heading", { name: /Management Center/i }),
    ).toBeVisible();
    await expect(
      managementCenter.getByText(/Invoice obligation/i),
    ).toBeVisible();
    await expect(managementCenter.getByText(/Funded liquidity/i)).toBeVisible();
  });
});
