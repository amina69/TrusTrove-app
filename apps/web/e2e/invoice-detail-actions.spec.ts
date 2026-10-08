import { expect, type Page } from "@playwright/test";
import { connectWallet, setMockSignError, test } from "./fixtures/freighter";
import {
  dueDateInDays,
  MOCK_INVOICE_ID,
  setupInvoiceApiMocks,
  setupStellarNetworkMocks,
  type InvoiceApiMocks,
  type MockInvoiceState,
  type StellarNetworkMocks,
} from "./mocks";

// Invoice detail buyer actions (#892): CONFIRM DELIVERY / REPAY / DEFAULT on
// /invoice/[invoiceId]. Every locator targets copy rendered by
// InvoiceDetailClient, ConfirmationDialog and TransactionPending.

const INVOICE_PATH = `/invoice/${MOCK_INVOICE_ID}`;

/** Mocks the invoice + chain and connects the wallet as the given role. */
async function openInvoice(
  page: Page,
  state: MockInvoiceState,
  role: "issuer" | "buyer" | "lp",
): Promise<{ stellar: StellarNetworkMocks; invoice: InvoiceApiMocks }> {
  const stellar = await setupStellarNetworkMocks(page);
  const invoice = await setupInvoiceApiMocks(page, state);
  await connectWallet(page, INVOICE_PATH, role);
  await expect(
    page.getByRole("status", { name: `Invoice status: ${state.status}` }),
  ).toBeVisible();
  return { stellar, invoice };
}

function statusBadge(page: Page, status: string) {
  return page.getByRole("status", { name: `Invoice status: ${status}` });
}

function pendingDialog(page: Page) {
  return page.getByRole("dialog", { name: "Transaction Pending" });
}

/**
 * Success toast for a mutation (`showSuccessToast` renders through sonner).
 * Scoped to the toast portal because the same copy also appears in page
 * copy such as the status timeline.
 */
function successToast(page: Page, text: string) {
  return page.locator("[data-sonner-toast]").getByText(text);
}

test.describe("Invoice detail buyer actions", () => {
  test("buyer confirms delivery: dialog → pending modal → Confirmed badge", async ({
    page,
  }) => {
    const { stellar, invoice } = await openInvoice(
      page,
      {
        status: "Active",
        discountBps: 200,
        dueDate: dueDateInDays(30).timestamp,
      },
      "buyer",
    );

    await page.getByRole("button", { name: "CONFIRM DELIVERY" }).click();

    const dialog = page.getByRole("dialog", {
      name: "Confirm Confirm Delivery",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Action:")).toBeVisible();

    await dialog.getByRole("button", { name: "CONFIRM", exact: true }).click();
    // The refetch after the mocked transaction must see the new state.
    invoice.state.status = "Confirmed";

    // Pending modal appears immediately with the real status copy.
    await expect(pendingDialog(page)).toBeVisible();
    await expect(
      pendingDialog(page).getByText("Confirming delivery..."),
    ).toBeVisible();

    // The action resolves to a boolean (no tx hash reaches the UI), so
    // success surfaces as the mutation's toast while the modal stays open.
    await expect(successToast(page, "Delivery Confirmed")).toBeVisible({
      timeout: 20_000,
    });
    await expect.poll(() => stellar.sendCount(), { timeout: 20_000 }).toBe(1);

    await pendingDialog(page)
      .getByRole("button", { name: "Close Dialog", exact: true })
      .click();
    await expect(pendingDialog(page)).toHaveCount(0);

    // Badge flipped to Confirmed and the buyer can now repay.
    await expect(statusBadge(page, "Confirmed")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "REPAY INVOICE" }),
    ).toBeVisible();
  });

  test("cancelling the confirmation dialog submits nothing", async ({
    page,
  }) => {
    const { stellar } = await openInvoice(
      page,
      {
        status: "Active",
        discountBps: 200,
        dueDate: dueDateInDays(30).timestamp,
      },
      "buyer",
    );

    await page.getByRole("button", { name: "CONFIRM DELIVERY" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Confirm Confirm Delivery",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // No pending modal, no transaction, no status change.
    await page.waitForTimeout(1000);
    await expect(pendingDialog(page)).toHaveCount(0);
    expect(stellar.sendCount()).toBe(0);
    await expect(statusBadge(page, "Active")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "CONFIRM DELIVERY" }),
    ).toBeVisible();
  });

  test("a rejected signature surfaces an alert and closes the pending modal", async ({
    page,
  }) => {
    const { stellar } = await openInvoice(
      page,
      {
        status: "Active",
        discountBps: 200,
        dueDate: dueDateInDays(30).timestamp,
      },
      "buyer",
    );
    await setMockSignError(page, "User declined the transaction in Freighter");

    await page.getByRole("button", { name: "CONFIRM DELIVERY" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Confirm Confirm Delivery",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "CONFIRM", exact: true }).click();

    // The pending modal opens while the signature is being requested…
    await expect(pendingDialog(page)).toBeVisible();
    // …and is torn down again when the submission fails, with the error
    // rendered in the action card's `role="alert"` paragraph.
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toHaveText(
      /User declined the transaction in Freighter/i,
    );
    await expect(pendingDialog(page)).toHaveCount(0);

    // Nothing reached the chain and the invoice stays Active.
    expect(stellar.sendCount()).toBe(0);
    await expect(statusBadge(page, "Active")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "CONFIRM DELIVERY" }),
    ).toBeVisible();
  });

  test("buyer repays a confirmed invoice: dialog → pending modal → Repaid badge", async ({
    page,
  }) => {
    const { stellar, invoice } = await openInvoice(
      page,
      {
        status: "Confirmed",
        discountBps: 200,
        dueDate: dueDateInDays(30).timestamp,
      },
      "buyer",
    );

    await page.getByRole("button", { name: "REPAY INVOICE" }).click();

    const dialog = page.getByRole("dialog", {
      name: "Confirm Repay Invoice",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "CONFIRM", exact: true }).click();
    invoice.state.status = "Repaid";

    await expect(pendingDialog(page)).toBeVisible();
    await expect(
      pendingDialog(page).getByText("Repaying invoice..."),
    ).toBeVisible();

    // Repay goes through the allowance check (mocked as already approved)
    // plus the repay write — exactly one transaction.
    await expect(successToast(page, "Invoice Repaid")).toBeVisible({
      timeout: 20_000,
    });
    await expect.poll(() => stellar.sendCount(), { timeout: 20_000 }).toBe(1);

    await pendingDialog(page)
      .getByRole("button", { name: "Close Dialog", exact: true })
      .click();
    await expect(statusBadge(page, "Repaid")).toBeVisible();
  });

  test("a not-yet-due confirmed invoice offers REPAY but no DEFAULT", async ({
    page,
  }) => {
    await openInvoice(
      page,
      {
        status: "Confirmed",
        discountBps: 200,
        dueDate: dueDateInDays(30).timestamp,
      },
      "buyer",
    );

    await expect(
      page.getByRole("button", { name: "REPAY INVOICE" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "DEFAULT INVOICE" }),
    ).toHaveCount(0);
  });

  test("an overdue confirmed invoice offers DEFAULT and submits on-chain", async ({
    page,
  }) => {
    const { stellar, invoice } = await openInvoice(
      page,
      {
        status: "Confirmed",
        discountBps: 200,
        dueDate: dueDateInDays(-3).timestamp,
      },
      "buyer",
    );

    const defaultBtn = page.getByRole("button", { name: "DEFAULT INVOICE" });
    await expect(defaultBtn).toBeVisible();
    await defaultBtn.click();

    const dialog = page.getByRole("dialog", {
      name: "Confirm Default Invoice",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "CONFIRM", exact: true }).click();
    invoice.state.status = "Defaulted";

    await expect(pendingDialog(page)).toBeVisible();
    await expect(
      pendingDialog(page).getByText("Defaulting invoice..."),
    ).toBeVisible();
    await expect(successToast(page, "Invoice Defaulted")).toBeVisible({
      timeout: 20_000,
    });
    await expect.poll(() => stellar.sendCount(), { timeout: 20_000 }).toBe(1);

    await pendingDialog(page)
      .getByRole("button", { name: "Close Dialog", exact: true })
      .click();
    await expect(statusBadge(page, "Defaulted")).toBeVisible();
  });

  test("the issuer sees no buyer action buttons on an active invoice", async ({
    page,
  }) => {
    await openInvoice(
      page,
      {
        status: "Active",
        discountBps: 200,
        dueDate: dueDateInDays(30).timestamp,
      },
      "issuer",
    );

    await expect(
      page.getByRole("heading", { name: "Available Action" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "CONFIRM DELIVERY" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "REPAY INVOICE" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "DEFAULT INVOICE" }),
    ).toHaveCount(0);
    await expect(statusBadge(page, "Active")).toBeVisible();
  });
});
