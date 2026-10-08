import { expect, type Page } from "@playwright/test";
import { connectWallet, test } from "./fixtures/freighter";
import {
  setupPoolApiMocks,
  setupStellarNetworkMocks,
  type StellarNetworkMocks,
} from "./mocks";

// LP lifecycle (#891): every locator targets copy rendered by
// apps/web/app/lp/page.tsx (Pool Overview / My Position / Deposit / Withdraw)
// plus the shared ConfirmationDialog and SimulationPreview components.

async function connectAsLp(page: Page) {
  await connectWallet(page, "/lp", "lp");
  await expect(
    page.getByRole("heading", { name: /Liquidity Provider Portal/i }),
  ).toBeVisible();
}

function depositAmount(page: Page) {
  return page.getByLabel("Deposit amount");
}

function withdrawShares(page: Page) {
  return page.getByLabel("Shares to redeem");
}

test.describe("LP Lifecycle - Pool Deposit & Redeem", () => {
  let stellar: StellarNetworkMocks;

  test.beforeEach(async ({ page }) => {
    stellar = await setupStellarNetworkMocks(page);
    await setupPoolApiMocks(page);
    await connectAsLp(page);
  });

  test("displays the LP dashboard with all key sections", async ({ page }) => {
    // Header + pool overview
    await expect(page.getByText(/Pool Overview/i)).toBeVisible();
    await expect(page.getByText(/Utilization/i)).toBeVisible();
    // Mocked utilization is 4500 bps → 45.0%
    await expect(page.getByText("45.0%")).toBeVisible();
    await expect(page.getByText(/Total Deposits/i)).toBeVisible();
    await expect(page.getByText(/Available Liquidity/i)).toBeVisible();
    await expect(page.getByText(/Yield Distributed/i)).toBeVisible();
    await expect(page.getByText(/Active Invoices/i)).toBeVisible();

    // My Position card
    await expect(page.getByText(/My Position/i)).toBeVisible();
    await expect(page.getByText(/Active LP Position/i)).toBeVisible();
    await expect(page.getByText(/Current USDC Value/i)).toBeVisible();
    await expect(page.getByText(/Redeemable Shares/i)).toBeVisible();
    await expect(page.getByText(/Accrued Yield/i)).toBeVisible();

    // Deposit & Withdraw forms
    await expect(
      page.getByRole("heading", { name: /Deposit USDC/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Withdraw Liquidity/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Withdraw Shares" }),
    ).toBeEnabled();
  });

  test("shows a transaction preview while typing a deposit amount", async ({
    page,
  }) => {
    await depositAmount(page).fill("5000");

    // The debounced simulation resolves against the mocked Soroban RPC and
    // renders the shared SimulationPreview with the invoked method.
    await expect(page.getByText(/Transaction Preview/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("deposit", { exact: true })).toBeVisible();
    await expect(page.getByText(/Ready to Sign/i)).toBeVisible();
    await expect(page.getByText(/Estimated network fee/i)).toBeVisible();
  });

  test("submits a deposit on-chain and confirms success", async ({ page }) => {
    await depositAmount(page).fill("5000");
    await page.getByRole("button", { name: "Deposit USDC" }).click();

    await expect(page.getByText(/Deposit Complete/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect.poll(() => stellar.sendCount(), { timeout: 20_000 }).toBe(1);
  });

  test("cancelling the withdraw confirmation submits nothing", async ({
    page,
  }) => {
    await withdrawShares(page).fill("2500");
    await page.getByRole("button", { name: "Withdraw Shares" }).click();

    const dialog = page.getByRole("dialog", {
      name: /Confirm Withdraw LP liquidity/i,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // No withdrawal transaction ever reached the RPC.
    expect(stellar.sendCount()).toBe(0);
  });

  test("confirming the withdraw dialog submits on-chain", async ({ page }) => {
    await withdrawShares(page).fill("2500");
    await page.getByRole("button", { name: "Withdraw Shares" }).click();

    const dialog = page.getByRole("dialog", {
      name: /Confirm Withdraw LP liquidity/i,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "CONFIRM", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(/Withdrawal Complete/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect.poll(() => stellar.sendCount(), { timeout: 20_000 }).toBe(1);
  });

  test("empty deposit and withdraw submissions do nothing", async ({
    page,
  }) => {
    // Empty deposit: handleDeposit bails out before any mutation.
    await page.getByRole("button", { name: "Deposit USDC" }).click();
    // Empty withdraw: handleWithdraw bails out before the confirm dialog.
    await page.getByRole("button", { name: "Withdraw Shares" }).click();

    await page.waitForTimeout(1000);
    await expect(page.getByRole("dialog", { name: /Confirm/i })).toHaveCount(0);
    expect(stellar.sendCount()).toBe(0);
  });
});
