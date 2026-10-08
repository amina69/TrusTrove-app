import type { Page } from "@playwright/test";
import { xdr } from "@stellar/stellar-sdk";
import { MOCK_WALLET } from "./fixtures/freighter";

/**
 * Shared E2E network mocks.
 *
 * Every spec runs the real Next.js app in a browser, but the app must never
 * reach the real Stellar testnet or indexer during a test. These helpers
 * intercept the three outbound surfaces (`page.route`):
 *
 * 1. Horizon (`horizon-testnet.stellar.org`) — account lookups / balances.
 * 2. Soroban RPC (`soroban-testnet.stellar.org`) — contract simulations,
 *    transaction submission and polling (the SDK write path).
 * 3. The indexer API (`/invoices`, `/events`, ...) — invoice state.
 *
 * The Soroban responses carry real, parseable XDR: the SDK's
 * `rpc.Server`/`TransactionBuilder` pipeline (getAccount → simulate →
 * prepare → sign → send → poll) rejects anything it cannot decode, so these
 * fixtures are generated with `@stellar/stellar-sdk` once and embedded
 * below.
 */

/** Realistic 56-character mock addresses (the app only string-compares them). */
export const MOCK_BUYER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** 64-char hex invoice id, as produced by the contract's BytesN<32> ids. */
export const MOCK_INVOICE_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/* ------------------------------------------------------------------ *
 * Pre-generated XDR constants (built with @stellar/stellar-sdk)       *
 * ------------------------------------------------------------------ */

/** Empty `LedgerEntryChanges` — valid `SorobanDataBuilder` input. */
const XDR_EMPTY_SOROBAN_DATA = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/** `LedgerKey` for the mock wallet's account. */
const XDR_ACCOUNT_KEY =
  "AAAAAAAAAAAHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw==";

/** `LedgerEntryData` (account) with seqNum 123456789 for the mock wallet. */
const XDR_ACCOUNT_ENTRY =
  "AAAAAAAAAAAHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwAACRhOcqAAAAAAAAdbzRUAAAAAAAAAAAAAAAAAAAAAAQEBAQAAAAAAAAAA";

/** ScVal::U128 with value 2^128-1 — allowance large enough for any repay. */
const XDR_U128_MAX = "AAAACf////////////////////8=";

/** ScVal::Bool(true) — used for `is_verified` reads. */
const XDR_BOOL_TRUE = "AAAAAAAAAAE=";

/** A minimal valid `TransactionEnvelopeXDR` (bump-sequence tx). */
const XDR_ENVELOPE =
  "AAAAAgAAAAAHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwAAAGQAAAAAB1vNFgAAAAEAAAAAAAAAAAAAAABqxPoaAAAAAAAAAAEAAAAAAAAACwAAAAAHW80WAAAAAAAAAAA=";

/** A minimal valid success `TransactionResultXDR`. */
const XDR_RESULT = "AAAAAAAAAGQAAAAAAAAAAAAAAAA=";

/** A minimal valid failed `TransactionResultXDR` (for ERROR sends). */
const XDR_FAILED_RESULT = "AAAAAAAAAGT/////AAAAAAAAAAA=";

/** A minimal valid `TransactionMetaXDR` (v3 with a void Soroban return). */
const XDR_META = "AAAAAwAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAABAAAAAA==";

/**
 * ScVal map: a full invoice struct, returned for on-chain `get` reads
 * (the repay flow fetches the invoice from the contract before building
 * the repayment). Validated against the SDK's `invoiceSchema`.
 */
const XDR_INVOICE_SCVAL =
  "AAAAEQAAAAEAAAAPAAAADwAAAAJpZAAAAAAADgAAAEBhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhAAAADwAAAAZpc3N1ZXIAAAAAAA4AAAA4R0FEUU9CWUhBNERRT0JZSEE0RFFPQllIQTREUU9CWUhBNERRT0JZSEE0RFFPQllIQTREUU9aUEkAAAAPAAAABWJ1eWVyAAAAAAAADgAAADhHQkJENDdJRjZMV0s3UDdNREVWU0NXUjdEUFVXVjNOWTNEVFFFVkZMNE5BVDRBUUgzWkxMRkxBNQAAAA8AAAAKZmFjZV92YWx1ZQAAAAAACgAAAAAAAAAAAAAAAlQL5AAAAAAPAAAABWFzc2V0AAAAAAAADgAAAARVU0RDAAAADwAAAAxkaXNjb3VudF9icHMAAAADAAAAyAAAAA8AAAANZnVuZGVkX2Ftb3VudAAAAAAAAAoAAAAAAAAAAAAAAAI2Pn8AAAAADwAAAAhkdWVfZGF0ZQAAAAYAAAAAcNvYgAAAAA8AAAAGc3RhdHVzAAAAAAAOAAAACUNvbmZpcm1lZAAAAAAAAA8AAAAKY3JlYXRlZF9hdAAAAAAABgAAAABlU/EAAAAADwAAAAlmdW5kZWRfYXQAAAAAAAABAAAADwAAAApzaGlwcGVkX2F0AAAAAAABAAAADwAAABBpc3N1ZXJfY29uZmlybWVkAAAAAAAAAAAAAAAPAAAAD2J1eWVyX2NvbmZpcm1lZAAAAAAAAAAAAAAAAA8AAAAJcmVwYWlkX2F0AAAAAAAAAQ==";

/**
 * Decodes the invoked Soroban contract method from a base64 transaction
 * envelope (`InvokeHostFunction` → `invokeContract` → function name).
 * Returns `""` for anything that is not a contract call.
 */
function invokedContractMethod(txB64: string | undefined): string {
  if (!txB64) return "";
  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(txB64, "base64");
    if (envelope.switch().name !== "envelopeTypeTx") return "";
    const operations = envelope.v1().tx().operations();
    if (operations.length === 0) return "";
    const body = operations[0].body();
    if (body.switch().name !== "invokeHostFunction") return "";
    const hostFunction = body.invokeHostFunctionOp().hostFunction();
    if (hostFunction.switch().name !== "hostFunctionTypeInvokeContract") {
      return "";
    }
    return hostFunction.invokeContract().functionName().toString();
  } catch {
    return "";
  }
}

export type MockInvoiceStatus =
  | "Created"
  | "Listed"
  | "Funded"
  | "Active"
  | "Confirmed"
  | "Repaid"
  | "Defaulted";

export interface MockInvoiceState {
  status: MockInvoiceStatus;
  discountBps: number;
  dueDate: number;
}

/** Raw snake_case wire shape returned by the indexer API. */
export interface RawMockInvoice {
  id: string;
  issuer: string;
  buyer: string;
  face_value: string;
  asset: string;
  discount_bps: number;
  funded_amount: string;
  due_date: number;
  status: MockInvoiceStatus;
  created_at: number;
  funded_at: number | null;
  shipped_at: number | null;
  issuer_confirmed: boolean;
  buyer_confirmed: boolean;
  repaid_at: number | null;
  listed_at?: number | null;
  issuer_confirmed_at?: number | null;
  buyer_confirmed_at?: number | null;
  defaulted_at?: number | null;
}

/**
 * Builds a raw indexer-API invoice payload for the given state.
 * Face value is 1000 USDC (1e10 stroops); funded amount 950 USDC.
 */
export function buildRawInvoice(
  state: MockInvoiceState,
  overrides: Partial<RawMockInvoice> = {},
): RawMockInvoice {
  const now = Math.floor(Date.now() / 1000);
  const isFinanced =
    state.status === "Funded" ||
    state.status === "Active" ||
    state.status === "Confirmed" ||
    state.status === "Repaid" ||
    state.status === "Defaulted";

  return {
    id: MOCK_INVOICE_ID,
    issuer: MOCK_WALLET,
    buyer: MOCK_BUYER,
    face_value: "10000000000",
    asset: "USDC",
    discount_bps: state.discountBps,
    funded_amount: isFinanced ? "9500000000" : "0",
    due_date: state.dueDate,
    status: state.status,
    created_at: now,
    funded_at: isFinanced ? now : null,
    shipped_at:
      state.status === "Active" ||
      state.status === "Confirmed" ||
      state.status === "Repaid"
        ? now
        : null,
    issuer_confirmed: false,
    buyer_confirmed: false,
    repaid_at: state.status === "Repaid" ? now : null,
    defaulted_at: state.status === "Defaulted" ? now : null,
    ...overrides,
  };
}

/**
 * Returns a due date `daysFromNow` days in the future, as both the ISO date
 * string the date-picker needs and the Unix-seconds timestamp the API uses.
 */
export function dueDateInDays(daysFromNow: number): {
  input: string;
  timestamp: number;
} {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(12, 0, 0, 0);
  return {
    input: date.toISOString().split("T")[0],
    timestamp: Math.floor(date.getTime() / 1000),
  };
}

export interface StellarNetworkMocks {
  /**
   * Number of transactions the app submitted to the RPC so far — used to
   * assert that a cancelled/failed flow never reached the chain.
   */
  sendCount: () => number;
}

/**
 * Intercepts Horizon and Soroban RPC.
 *
 * Horizon returns a funded mock account (so balance fetches resolve).
 * Soroban RPC handles the SDK read *and* write paths end-to-end:
 * - `getLedgerEntries` — returns a valid account entry, so `getAccount`
 *   resolves and every read/write can build its transaction,
 * - `simulateTransaction` — succeeds; `allowance` reads return u128 max
 *   (so no approval transaction is ever needed) and `is_verified` reads
 *   return true, while other reads return no value (the SDK surfaces that
 *   as its normal "no return value" error, matching unseeded state),
 * - `prepareTransaction` — echoes the incoming transaction back,
 * - `sendTransaction` — returns PENDING for `mock-onchain-tx-hash`,
 * - `getTransaction` — immediately reports SUCCESS with parseable
 *   envelope/result/meta XDR.
 *
 * Pass `failSendTransaction: true` to make `sendTransaction` return an ERROR
 * result, which the SDK surfaces as a thrown `TransactionSendError` — used to
 * exercise the UI error path without touching real infrastructure.
 */
export async function setupStellarNetworkMocks(
  page: Page,
  { failSendTransaction = false }: { failSendTransaction?: boolean } = {},
): Promise<StellarNetworkMocks> {
  let sends = 0;

  await page.route("**horizon-testnet.stellar.org**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: MOCK_WALLET,
        account_id: MOCK_WALLET,
        sequence: "123456789",
        subentry_count: 0,
        balances: [],
      }),
    });
  });

  await page.route("**soroban-testnet.stellar.org**", async (route) => {
    const body = route.request().postDataJSON() as {
      id?: number;
      method?: string;
      params?: { transaction?: string; keys?: string[] };
    };
    const id = body?.id ?? 1;
    const method = body?.method ?? "";

    // Contract method name, decoded from the simulated transaction's XDR.
    const methodFromTx = (): string =>
      invokedContractMethod(body?.params?.transaction);

    if (method === "getTransaction") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            status: "SUCCESS",
            txHash: "mock-onchain-tx-hash",
            ledger: 12345,
            createdAt: 1700000000,
            applicationOrder: 1,
            feeBump: false,
            envelopeXdr: XDR_ENVELOPE,
            resultXdr: XDR_RESULT,
            resultMetaXdr: XDR_META,
          },
        }),
      });
      return;
    }

    if (method === "sendTransaction") {
      sends += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: failSendTransaction
            ? {
                status: "ERROR",
                hash: "mock-onchain-tx-hash",
                errorResultXdr: XDR_FAILED_RESULT,
              }
            : {
                status: "PENDING",
                hash: "mock-onchain-tx-hash",
              },
        }),
      });
      return;
    }

    if (method === "getLedgerEntries") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            latestLedger: 12345,
            entries: [
              {
                key: XDR_ACCOUNT_KEY,
                xdr: XDR_ACCOUNT_ENTRY,
                lastModifiedLedgerSeq: 12344,
                liveUntilLedgerSeq: 1000000,
              },
            ],
          },
        }),
      });
      return;
    }

    if (method === "prepareTransaction") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            transaction: body?.params?.transaction ?? "",
            minResourceFee: "100",
          },
        }),
      });
      return;
    }

    if (method === "simulateTransaction") {
      const called = methodFromTx();

      // `get_profile` on an unregistered wallet: a simulation error whose
      // message matches the app's "profile not found" handling, so the
      // profile query settles immediately instead of retrying.
      if (called === "get_profile") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { id, latestLedger: 12345, error: "profile not found" },
          }),
        });
        return;
      }

      const retval =
        called === "allowance"
          ? XDR_U128_MAX
          : called === "is_verified"
            ? XDR_BOOL_TRUE
            : called === "get"
              ? XDR_INVOICE_SCVAL
              : "";

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            id,
            latestLedger: 12345,
            transactionData: XDR_EMPTY_SOROBAN_DATA,
            minResourceFee: "100",
            events: [],
            // `auth` must always be present: `assembleTransaction` reads
            // `results[0].auth` when preparing any write for signing. An
            // empty `xdr` decodes as a void return value for writes and
            // for reads without a fixture (which then fail to parse —
            // matching the app's unseeded error handling).
            results: [{ auth: [], xdr: retval }],
          },
        }),
      });
      return;
    }

    if (method === "getLatestLedger") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            id: "mock-ledger-hash",
            protocolVersion: 22,
            sequence: 12345,
          },
        }),
      });
      return;
    }

    if (method === "getHealth") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { status: "OK", latestLedger: 12345 },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {},
      }),
    });
  });

  return { sendCount: () => sends };
}

export interface PoolApiMocks {
  /** Mutable `GET /pool/position/:address` payload the mock serves. */
  position: {
    shares: string;
    usdc_value: string;
    yield_earned: string;
    deposit_count: number;
  };
}

/**
 * Mocks the indexer's pool endpoints used by the LP portal:
 * `GET /pool/stats` (utilization donut + stat grid),
 * `GET /pool/position/:address` (the "Withdraw Shares" button stays
 * disabled until this reports a non-zero `shares`), and
 * `GET /pool/snapshots` (chart data).
 */
export async function setupPoolApiMocks(page: Page): Promise<PoolApiMocks> {
  const position: PoolApiMocks["position"] = {
    shares: "5000000000",
    usdc_value: "5000000000",
    yield_earned: "10000000",
    deposit_count: 2,
  };

  await page.route("**/pool/stats**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total_deposits: "25000000000",
        total_funded: "18000000000",
        available_liquidity: "7000000000",
        utilization_rate_bps: 4500,
        total_yield_distributed: "25000000",
        active_invoice_count: 3,
        total_shares: "25000000000",
      }),
    });
  });

  await page.route("**/pool/position**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(position),
    });
  });

  await page.route("**/pool/snapshots**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  return { position };
}

export interface InvoiceApiMocks {
  /** The mutable invoice state the API mock serves. */
  state: MockInvoiceState;
  /** How many invoices the GET /invoices list returns (0 or 1). */
  listInvoice: () => void;
  hideInvoice: () => void;
}

/**
 * Mocks the indexer API (`/invoices`, `/events`) for a single-invoice world.
 *
 * GET `/invoices/:id` always serves `state`; GET `/invoices` serves the
 * invoice in the list only after `listInvoice()` has been called (the SME
 * dashboard is empty until the issuer creates an invoice). Pass
 * `listedFromStart: true` to serve the invoice immediately.
 */
export async function setupInvoiceApiMocks(
  page: Page,
  initialState: MockInvoiceState,
  { listedFromStart = false }: { listedFromStart?: boolean } = {},
): Promise<InvoiceApiMocks> {
  const state: MockInvoiceState = { ...initialState };
  let invoiceCreated = listedFromStart;

  await page.route("**/events**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/invoices**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "POST" && url.pathname.endsWith("/invoices")) {
      invoiceCreated = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          invoice_id: MOCK_INVOICE_ID,
          transaction_hash: "mock-create-tx-hash",
          status: "Created",
        }),
      });
      return;
    }

    if (request.method() === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (url.pathname.endsWith(`/invoices/${MOCK_INVOICE_ID}`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildRawInvoice(state)),
      });
      return;
    }

    if (url.pathname.endsWith("/invoices")) {
      const data = invoiceCreated ? [buildRawInvoice(state)] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data,
          total: data.length,
          page: 1,
          limit: 20,
          totalPages: data.length > 0 ? 1 : 0,
        }),
      });
      return;
    }

    await route.continue();
  });

  return {
    state,
    listInvoice: () => {
      invoiceCreated = true;
    },
    hideInvoice: () => {
      invoiceCreated = false;
    },
  };
}
