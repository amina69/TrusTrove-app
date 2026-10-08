import { expect, type Page } from "@playwright/test";
import { format, parse } from "date-fns";
import { connectWallet, test } from "./fixtures/freighter";
import {
  MOCK_BUYER,
  MOCK_INVOICE_ID,
  dueDateInDays,
  setupInvoiceApiMocks,
  setupStellarNetworkMocks,
} from "./mocks";

/** The dashboard table truncates ids as `first6...last4` (lib/format.ts). */
const invoiceRow = (page: Page) =>
  page.getByRole("row").filter({
    hasText: `${MOCK_INVOICE_ID.slice(0, 6)}...${MOCK_INVOICE_ID.slice(-4)}`,
  });

async function connectAsIssuer(page: Page) {
  await connectWallet(page, "/dashboard", "issuer");
  await expect(
    page.getByRole("heading", { name: /SME Financing Dashboard/i }),
  ).toBeVisible();
  await expect(page.getByText(/ROLE:\s*ISSUER/i)).toBeVisible();
}

async function selectDueDate(page: Page, isoDate: string) {
  // react-day-picker labels each day button with date-fns `PPPP`, e.g.
  // "Thursday, October 8th, 2026" — match on that full label rather than
  // the day number, which is only the button's text content.
  const dayLabel = format(parse(isoDate, "yyyy-MM-dd", new Date()), "PPPP");
  await page.getByRole("button", { name: /Select due date/i }).click();
  await page.getByRole("button", { name: dayLabel, exact: true }).click();
}

test.describe("SME Issuer Flow - Happy Path", () => {
  test("Connect, create, list, and ship an invoice", async ({ page }) => {
    await setupStellarNetworkMocks(page);
    // InvoiceForm rejects due dates sooner than 7 days out, so pick +8 days.
    const dueDate = dueDateInDays(8);
    const invoiceMocks = await setupInvoiceApiMocks(page, {
      status: "Created",
      discountBps: 0,
      dueDate: dueDate.timestamp,
    });
    await connectAsIssuer(page);

    await page.getByRole("button", { name: /Create Invoice/i }).click();
    await expect(
      page.getByRole("dialog", { name: /Create Invoice/i }),
    ).toBeVisible();

    await page.getByPlaceholder(/Stellar Public Key/i).fill(MOCK_BUYER);
    await page.getByPlaceholder(/50,000\.00/i).fill("1000");
    await selectDueDate(page, dueDate.input);

    await page
      .getByRole("checkbox", {
        name: /List for immediate LP financing at creation/i,
      })
      .uncheck();

    await page.getByRole("button", { name: /Review Financing Terms/i }).click();
    // Scope to the dialog: the dashboard behind it also has a "Create
    // Invoice" button, which would otherwise make the locator ambiguous.
    const createDialog = page.getByRole("dialog", { name: /Create Invoice/i });
    await createDialog.getByRole("button", { name: /Create Invoice/i }).click();

    await expect(page.getByText(/Invoice Created/i)).toBeVisible({
      timeout: 15000,
    });

    await invoiceRow(page).click();

    await page
      .getByRole("button", { name: /Configure financing terms/i })
      .click();
    await page.getByRole("button", { name: /List Terms/i }).click();

    invoiceMocks.state.status = "Listed";
    invoiceMocks.state.discountBps = 200;
    await expect(page.getByText(/Invoice Listed for Financing/i)).toBeVisible({
      timeout: 15000,
    });

    invoiceMocks.state.status = "Funded";
    await page.reload();
    await connectAsIssuer(page);
    await invoiceRow(page).click();

    await page.getByRole("button", { name: /Mark Goods Shipped/i }).click();

    invoiceMocks.state.status = "Active";
    await expect(page.getByText(/Invoice Shipped/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("status", { name: /Invoice status: Active/i }),
    ).toBeVisible();
  });
});
