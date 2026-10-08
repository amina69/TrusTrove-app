import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * Stellar address returned by the mocked Freighter wallet.
 *
 * It is a checksum-valid Ed25519 `G...` address (raw 32 bytes of 0x07) —
 * required because the SDK calls `new Address(...)`/`StrKey.decode...` on it
 * when building transactions, which would throw on a synthetic placeholder.
 * The app only string-compares addresses, so the value itself is irrelevant.
 */
export const MOCK_WALLET =
  "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";

/**
 * Message types spoken by the freighter-api v2 `postMessage` transport.
 * Requests carry `source: "FREIGHTER_EXTERNAL_MSG_REQUEST"` with a
 * `messageId` (correctly spelled); the extension must answer with a
 * `FREIGHTER_EXTERNAL_MSG_RESPONSE` whose `messagedId` matches it —
 * the misspelled field name is the library's own matcher, so the mock
 * translates between the two spellings below.
 */
const REQUEST_SOURCE = "FREIGHTER_EXTERNAL_MSG_REQUEST";
const RESPONSE_SOURCE = "FREIGHTER_EXTERNAL_MSG_RESPONSE";

/** `store/onboarding.ts` localStorage flag that suppresses the auto tour. */
const ONBOARDING_SEEN_KEY = "trusttrove:onboarding-tour-seen";

/**
 * Static response payloads per request type (the wallet address and the
 * signed transaction are overridden dynamically inside the page listener).
 */
const RESPONSES_BY_TYPE: Record<string, unknown> = {
  REQUEST_CONNECTION_STATUS: { isConnected: true },
  REQUEST_PUBLIC_KEY: { publicKey: MOCK_WALLET },
  REQUEST_ACCESS: { publicKey: MOCK_WALLET },
  REQUEST_ALLOWED_STATUS: { isAllowed: true },
  REQUEST_NETWORK: { network: "TESTNET" },
  REQUEST_NETWORK_DETAILS: {
    networkDetails: {
      network: "TESTNET",
      networkName: "Test Net",
      networkUrl: "https://horizon-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    },
  },
  SUBMIT_TRANSACTION: { signedTransaction: "" },
  SUBMIT_AUTH_ENTRY: { signedAuthEntry: "signed-auth-mock" },
  SUBMIT_BLOB: { signedBlob: "signed-blob-mock" },
};

/**
 * The address each page's mock currently reports, so `connectedAddressText`
 * waits for the chip of whichever wallet the test installed (the default
 * fixture wallet or a per-test override via `installFreighter`).
 */
const installedAddressByPage = new WeakMap<Page, string>();

/**
 * Installs a working Freighter extension mock into the page before any app
 * code runs. The freighter-api v2 module ships as a UMD bundle that ignores
 * `window.freighter` and talks to the extension exclusively via
 * `window.postMessage`, so the mock answers those messages directly — the
 * same surface the real Freighter extension implements.
 *
 * The listener is installed at most once per page; calling this again with a
 * different `address` (or using `setMockWallet`) just swaps the address the
 * mock reports, without stacking duplicate listeners.
 *
 * `signTransaction` echoes back the transaction XDR it was handed, so the
 * SDK's `TransactionBuilder.fromXDR(signed)` round-trip succeeds. Tests can
 * simulate a user rejecting the signature in Freighter via
 * `setMockSignError`.
 */
export async function installFreighter(
  page: Page,
  address: string = MOCK_WALLET,
): Promise<void> {
  installedAddressByPage.set(page, address);
  await page.addInitScript(
    ({ addr, requestSource, responseSource, responsesByType, seenKey }) => {
      // The first-connect onboarding tour would otherwise open over the app
      // as soon as a wallet connects and swallow every later click.
      try {
        window.localStorage.setItem(seenKey, "true");
      } catch {
        // Storage disabled — nothing to do.
      }

      const state = ((window as unknown as Record<string, unknown>)[
        "__freighterMock"
      ] ??= { address: addr, signError: null, installed: false }) as {
        address: string;
        signError: string | null;
        installed: boolean;
      };
      state.address = addr;

      if (state.installed) return;
      state.installed = true;

      window.addEventListener("message", (event) => {
        const data = event.data as
          { source?: string; messageId?: unknown; type?: string } | undefined;
        if (!data || data.source !== requestSource) return;

        const mock = (
          window as unknown as Record<
            string,
            { address: string; signError: string | null }
          >
        ).__freighterMock;

        // Payload for this request type, with the address overridden so a
        // per-test wallet keeps flowing through every method.
        const base =
          (responsesByType[data.type ?? ""] as Record<string, unknown>) ?? {};
        const payload: Record<string, unknown> = { ...base };
        if ("publicKey" in payload) payload.publicKey = mock.address;

        if (data.type === "SUBMIT_TRANSACTION") {
          if (mock.signError) {
            payload.signedTransaction = "";
            payload.error = mock.signError;
          } else {
            // Echo the unsigned XDR so `TransactionBuilder.fromXDR` in the
            // SDK can re-parse it; submission is mocked at the RPC layer.
            const xdr = (data as { transactionXdr?: string }).transactionXdr;
            if (typeof xdr === "string") payload.signedTransaction = xdr;
          }
        }

        // The library sends `messageId` but matches the response's
        // `messagedId` (its own typo) — mirror the request id into it.
        window.postMessage(
          {
            source: responseSource,
            messagedId: data.messageId,
            ...payload,
          },
          window.location.origin,
        );
      });
    },
    {
      addr: address,
      requestSource: REQUEST_SOURCE,
      responseSource: RESPONSE_SOURCE,
      responsesByType: RESPONSES_BY_TYPE,
      seenKey: ONBOARDING_SEEN_KEY,
    },
  );
}

/**
 * Shared fixture: every test gets a page with the Freighter mock installed
 * for the default mock wallet. Use `installFreighter(page, otherAddress)`
 * inside a test to override the wallet for that test instead.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await installFreighter(page);
    await use(page);
  },
});

export { expect };

/**
 * Swaps the address the installed mock reports without a reload — used to
 * simulate connecting a different wallet in the same page session.
 */
export async function setMockWallet(
  page: Page,
  address: string,
): Promise<void> {
  installedAddressByPage.set(page, address);
  await page.evaluate((addr) => {
    const w = window as unknown as Record<
      string,
      { address?: string; signError?: string | null; installed?: boolean }
    >;
    w.__freighterMock ??= {};
    w.__freighterMock.address = addr;
  }, address);
}

/**
 * Makes the next `signTransaction` calls fail with `message` (the
 * freighter-api throws the raw error string), simulating a user rejecting
 * the signature request. Pass `null` to restore normal signing.
 */
export async function setMockSignError(
  page: Page,
  message: string | null,
): Promise<void> {
  await page.evaluate((err) => {
    const w = window as unknown as Record<
      string,
      { address?: string; signError?: string | null; installed?: boolean }
    >;
    w.__freighterMock ??= {};
    w.__freighterMock.signError = err;
  }, message);
}

/**
 * The wallet UI (Navbar) button that starts the Freighter connection.
 * Scoped to the navigation bar because pages like /dashboard also render a
 * full-page connect CTA with the same accessible name.
 */
export function connectWalletButton(page: Page): Locator {
  return page
    .getByRole("navigation")
    .getByRole("button", { name: /Connect Wallet/i });
}

/** Mirrors lib/format.ts truncateAddress (6 leading + 4 trailing chars). */
function truncateForDisplay(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** The connected-wallet chip shown in the Navbar (truncated address). */
export function connectedAddressText(page: Page): Locator {
  const address = installedAddressByPage.get(page) ?? MOCK_WALLET;
  return page.getByText(truncateForDisplay(address), { exact: true }).first();
}

/**
 * Opens the site at `path` and connects the mocked Freighter wallet through
 * the real Navbar UI, then waits for the connected-address chip. Pass `role`
 * to switch the active role via the Navbar select (persisted in localStorage,
 * so it also applies after reloads).
 */
export async function connectWallet(
  page: Page,
  path: string,
  role?: "issuer" | "buyer" | "lp",
): Promise<void> {
  await page.goto(path);

  const address = connectedAddressText(page);
  if (!(await address.isVisible().catch(() => false))) {
    const connectBtn = connectWalletButton(page);
    await expect(connectBtn).toBeVisible({ timeout: 15_000 });
    await connectBtn.click();
  }
  await expect(address).toBeVisible({ timeout: 15_000 });

  if (role) {
    await page
      .getByRole("combobox", { name: /Active role/i })
      .selectOption(role);
  }
}
