# Contributing to TrusTrove

Thank you for your interest in contributing to TrusTrove! To maintain code quality, security, and developer alignment across the monorepo, please adhere to the guidelines documented below.

---

## Code of Conduct & Standards

1. **No Placeholders or Stubs**: Do not submit code containing `TODO` comments, stub methods, or mock data (unless isolated to dedicated unit test fixtures). Every PR must contain fully functional, production-ready logic.
2. **Type Safety**:
   - **TypeScript**: Enforce strict typing. Do not use `any` unless absolutely necessary and documented.
   - **Go**: Write clean, idiomatically structured Go code. Use `gofmt` and address all compiler/lint warnings before committing.
3. **Security First**: Validate all user inputs on both the frontend (via Zod schemas) and backend (via parameter validation). Sign all write operations on-chain using the Freighter wallet API wrapper.

## Pull Request Checklist

Before opening or requesting review of a pull request, confirm the following:

- [ ] Code compiles without errors (`pnpm build` / `go build -v .`)
- [ ] TypeScript type-checking passes with no errors (`pnpm typecheck`)
- [ ] Linting passes (`pnpm --filter web lint` / `go vet ./...`)
- [ ] All existing and new tests pass (`pnpm test` / `go test ./...`)
- [ ] No `TODO`, stub, or placeholder code is present
- [ ] TypeScript changes use strict types (no `any`)
- [ ] New Go code is formatted with `gofmt`
- [ ] Commit messages follow Conventional Commits format
- [ ] PR description explains the change, why it is needed, and how it was tested

---

## Git Workflow Guidelines

We follow a strict, linear git history workflow to ensure codebase traceability.

1. **Atomic Commits**: Create one commit per logical unit of work. Do not bundle multiple unrelated changes (e.g. database schema changes and frontend styling updates) into a single commit.
2. **Never Use `git add .` or `git add -A`**: Proactively review and add files individually using:
   ```bash
   git add path/to/file.ext
   ```
3. **Commit & Push Early**: Push to your branch immediately after every local commit. This keeps remote builds in sync and facilitates continuous review.

### Commit Messages

Follow Conventional Commits format:

- `feat(web): add invoice listing cards`
- `fix(indexer): resolve database connection timeout`
- `docs: update setup documentation`
- `test(sdk): add registry client mock tests`

---

## Development Lifecycle

### 1. Build and Compile Verification

Verify compilation across all monorepo packages before submitting code:

```bash
# Compile SDK and Next.js frontend
pnpm install
pnpm build

# Compile Go Indexer
cd indexer
go build -v .
```

### 2. Type-Checking

Run the TypeScript compiler in check-only mode across all packages:

```bash
pnpm typecheck
```

This runs `tsc --noEmit` recursively over every TypeScript package in the monorepo and reports type errors without emitting any output files. Fix all errors before opening a PR.

### 3. Linting & Code Quality

Run linters on edited workspace directories:

```bash
# Web application lint
pnpm --filter web lint

# Go linter
cd indexer
go vet ./...
```

### 4. Testing

The test suite is split across two runtimes. Both must pass before opening a PR.

**TypeScript tests** (SDK, CLI and web, run from the repo root):

```bash
# Run all TypeScript workspace tests (includes @trusttrove/cli)
pnpm test

# Run frontend tests only
pnpm --filter web test

# Run SDK tests only
pnpm --filter @trusttrove/sdk test
```

> **Note:** `pnpm test` only covers the TypeScript packages (`@trusttrove/sdk`,
> `@trusttrove/sdk-react`, `@trusttrove/cli` and `web`). It does **not** run
> the Go indexer tests, and the Playwright E2E specs are run separately —
> see [E2E tests](#5-e2e-tests-playwright) below.

Example output (all passing):

```text
> pnpm test
...
Test Suites: 12 passed, 12 total
Tests:       47 passed, 47 total
Time:        2.34 s
```

### 5. E2E tests (Playwright)

The `apps/web/e2e` directory contains Playwright specs that run the real Next.js
app in Chromium against a fully mocked network layer (Horizon, Soroban RPC and
the indexer API are intercepted with `page.route`, so no testnet access is
required).

Prerequisites (first run only):

```bash
# From the repository root
pnpm install

# Install the Chromium browser (add --with-deps on CI/Linux for system libs)
pnpm --filter web exec playwright install chromium
```

Run the suite locally:

```bash
# From the repository root
pnpm --filter web test:e2e

# Or, with the Playwright UI runner for debugging:
pnpm --filter web exec playwright test --ui

# Filter by file or test name
pnpm --filter web exec playwright test e2e/sme-issuer-flow.spec.ts
pnpm --filter web exec playwright test -g "CONFIRM DELIVERY"
```

By default the dev server is reused if it is already running on port 3000.
When `CI=1` is set, Playwright starts a production server instead
(`pnpm build && pnpm start`) — the same behavior as the CI workflow.

Reports: an HTML report is written to `apps/web/playwright-report/` (open it
with `pnpm --filter web exec playwright show-report`). Traces for retried
failures land in `apps/web/test-results/`. All three output directories
(`playwright-report/`, `test-results/`, `blob-report/`) are gitignored.

CI runs the suite in a dedicated `verify-e2e` job on every push/PR to `main`
and uploads `playwright-report/` as an artifact when the job fails.

**Go tests** (indexer, run from the `indexer/` directory):

```bash
cd indexer && go test ./...
```

Example output (all passing):

```text
ok  	github.com/trusttrove/indexer	0.876s
```

---
