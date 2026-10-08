import { expect, type Locator, type Page } from "@playwright/test";
import { connectWallet, MOCK_WALLET, test } from "./fixtures/freighter";
import { setupStellarNetworkMocks, type StellarNetworkMocks } from "./mocks";

// Profile registration & verification (#891): every locator below targets
// copy that actually renders in apps/web/app/profile + RegistrationModal.
// The modal's submit is currently gated by a company-name check with no
// matching input (documented by RegistrationModal.test.tsx), so a filled
// form surfaces that validation error instead of a transaction — the specs
// assert exactly that, and the verified view is exercised by seeding the
// exposed React Query client the way the app's own tests do.

async function openRegistration(page: Page) {
  await page.getByRole("button", { name: /Register profile/i }).click();
  const dialog = page.getByRole("dialog", {
    name: /Register Business Metadata/i,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  return dialog;
}

async function fillMetadata(
  dialog: Locator,
  fields: { taxId: string; country: string; website: string },
) {
  await dialog.getByPlaceholder("e.g. EU123456789").fill(fields.taxId);
  await dialog.getByPlaceholder("e.g. Germany").fill(fields.country);
  await dialog.getByPlaceholder("e.g. https://acme.corp").fill(fields.website);
}

test.describe("Profile Registration & Verification", () => {
  let stellar: StellarNetworkMocks;

  test.beforeEach(async ({ page }) => {
    stellar = await setupStellarNetworkMocks(page);
    await connectWallet(page, "/profile");
  });

  test("shows unverified state and opens the registration modal", async ({
    page,
  }) => {
    // Unverified banner should be visible (the registry queries settle
    // against the mocked RPC; allow for React Query's initial retries).
    await expect(page.getByText(/UNVERIFIED \/ UNREGISTERED/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Profile Verification Required/i)).toBeVisible({
      timeout: 15_000,
    });

    // Open the registration modal
    const dialog = await openRegistration(page);
    await expect(
      dialog.getByText(/Select On-Chain Business Role/i),
    ).toBeVisible();
  });

  test("blocks an issuer submission with the company-name validation", async ({
    page,
  }) => {
    const dialog = await openRegistration(page);
    await fillMetadata(dialog, {
      taxId: "EU123456789",
      country: "Germany",
      website: "https://acme.corp",
    });

    // Submit the registration form (default role is issuer)
    await dialog.getByRole("button", { name: "Register Profile" }).click();

    // The dead company-name check blocks the submission client-side.
    await expect(page.getByText(/Company name is required/i)).toBeVisible();

    // Nothing was submitted: modal stays open, no pending dialog, no
    // transaction ever reached the RPC.
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Transaction Pending" }),
    ).toHaveCount(0);
    expect(stellar.sendCount()).toBe(0);
  });

  test("blocks a buyer submission the same way after selecting the buyer role", async ({
    page,
  }) => {
    const dialog = await openRegistration(page);

    // Select the buyer role
    await dialog.getByRole("button", { name: "Obligor / Buyer" }).click();

    await fillMetadata(dialog, {
      taxId: "EU987654321",
      country: "France",
      website: "https://buyer.corp",
    });
    await dialog.getByRole("button", { name: "Register Profile" }).click();

    await expect(page.getByText(/Company name is required/i)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Transaction Pending" }),
    ).toHaveCount(0);
    expect(stellar.sendCount()).toBe(0);
  });

  test("keeps the modal open when submitting with empty required fields", async ({
    page,
  }) => {
    const dialog = await openRegistration(page);

    // Native constraint validation (Tax ID / Country are `required`)
    // prevents the form from submitting at all.
    await dialog.getByRole("button", { name: "Register Profile" }).click();

    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Transaction Pending" }),
    ).toHaveCount(0);
    expect(stellar.sendCount()).toBe(0);
  });

  test("reflects the verified issuer state once the registry reports a profile", async ({
    page,
  }) => {
    const dialog = await openRegistration(page);
    await fillMetadata(dialog, {
      taxId: "EU123456789",
      country: "Germany",
      website: "https://acme.corp",
    });
    await dialog.getByRole("button", { name: "Register Profile" }).click();
    await expect(page.getByText(/Company name is required/i)).toBeVisible();

    // Seed the React Query cache to simulate the registry returning a
    // verified profile, then assert the verified view renders.
    await page.evaluate((address) => {
      const queryClient = (
        window as unknown as {
          __reactQueryClient?: {
            setQueryData: (key: unknown[], value: unknown) => void;
          };
        }
      ).__reactQueryClient;
      queryClient?.setQueryData(["profile", address], {
        address,
        role: "issuer",
        registeredAt: Math.floor(Date.now() / 1000),
        metadata: {
          companyName: "",
          taxId: "EU123456789",
          country: "Germany",
          website: "https://acme.corp",
          email: "",
        },
      });
    }, MOCK_WALLET);

    await expect(page.getByText(/VERIFIED ON-CHAIN/i)).toBeVisible();
    await expect(page.getByText(/ROLE: ISSUER/i)).toBeVisible();
    await expect(
      page.getByText(/Decentralized Identity Active/i),
    ).toBeVisible();
  });

  test("reflects the verified buyer state after selecting the buyer role", async ({
    page,
  }) => {
    const dialog = await openRegistration(page);
    await dialog.getByRole("button", { name: "Obligor / Buyer" }).click();
    await fillMetadata(dialog, {
      taxId: "EU987654321",
      country: "France",
      website: "https://buyer.corp",
    });
    await dialog.getByRole("button", { name: "Register Profile" }).click();
    await expect(page.getByText(/Company name is required/i)).toBeVisible();

    await page.evaluate((address) => {
      const queryClient = (
        window as unknown as {
          __reactQueryClient?: {
            setQueryData: (key: unknown[], value: unknown) => void;
          };
        }
      ).__reactQueryClient;
      queryClient?.setQueryData(["profile", address], {
        address,
        role: "buyer",
        registeredAt: Math.floor(Date.now() / 1000),
        metadata: {
          companyName: "",
          taxId: "EU987654321",
          country: "France",
          website: "https://buyer.corp",
          email: "",
        },
      });
    }, MOCK_WALLET);

    await expect(page.getByText(/VERIFIED ON-CHAIN/i)).toBeVisible();
    await expect(page.getByText(/ROLE: BUYER/i)).toBeVisible();
    await expect(
      page.getByText(/Decentralized Identity Active/i),
    ).toBeVisible();
  });
});
