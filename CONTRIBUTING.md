# Contributing

## Code of Conduct

We are committed to providing a welcoming and inclusive community. Please review our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing. All contributors are expected to uphold this code of conduct.

## Prerequisites

- **Node.js** 22+
- **pnpm 9** — `npm install -g pnpm@9` (CI and the lockfile use pnpm 9; newer majors may rewrite `pnpm-lock.yaml`)
- **Rust** — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Stellar CLI** — `cargo install stellar-cli --features opt`
- **Freighter** browser extension set to Testnet

## Setup

```bash
git clone https://github.com/StellarLock/StellarLock.git
cd StellarLock
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

## Build

### Frontend

```bash
pnpm build
```

### Contracts

```bash
cd contracts
stellar contract build
```

Compiled WASM files land in `contracts/target/wasm32v1-none/release/`.

## Deploy to Testnet

```bash
stellar keys generate myaccount --network testnet
stellar keys fund myaccount --network testnet
cd contracts
./deploy.sh myaccount
```

Paste the printed contract IDs into `src/lib/stellar.ts`.

## Code Style

- TypeScript strict mode is enabled — avoid `any` where possible
- Format Rust code with `cargo fmt` and check with `cargo clippy`
- Follow existing patterns in the codebase (component structure, hooks, contract layout)

## Pull Requests

- Use conventional commits — see [Commit messages](#commit-messages) for allowed types and scopes
- Fill in the pull request template, including the `Closes #N` line and checklist
- Keep PRs focused on a single concern
- Reference the issue in the PR body with `Closes #N`
- Squash merge when ready

## Branch Protection

The `main` branch is protected. Direct pushes are blocked. All changes must go through a pull request.

**Rules enforced on `main`:**

| Rule | Setting |
|---|---|
| Required approving reviews | 1 (code-owner review required for contract/CI changes) |
| Dismiss stale reviews on new push | Enabled |
| Status checks must pass | Required (linting, build, tests) |
| Branch must be up to date before merge | Enabled |
| Force pushes | Disabled |
| Branch deletion | Disabled |
| Conversation resolution | Required before merge |
| Rule applies to admins | Enabled |

**Required Status Checks:**

Before a PR can be merged to `main`, these CI jobs from `.github/workflows/ci.yml` must pass:

- **Frontend Checks** — ESLint, TypeScript type checking, unit/component tests, Storybook build, Vite build
- **Smart Contract Checks** — Rust build, `cargo fmt`, `cargo test`, `cargo clippy`
- **End-to-End and Visual Regression** — Playwright e2e and visual snapshot tests
- **Commit Message Lint** — Conventional commit format enforcement (PR-only)

**Maintaining Branch Protection:**

Branch protection is configured via `.github/scripts/apply-branch-protection.sh`. To update:

1. If you rename, add, or remove a CI job in `ci.yml`, update the `contexts` array in `apply-branch-protection.sh` to match the exact job name as it appears on GitHub PR checks.
2. Run the script as a repository admin:
   ```bash
   gh auth login  # if not already authenticated as admin
   bash .github/scripts/apply-branch-protection.sh
   ```
3. Verify at: https://github.com/StellarLock/StellarLock/settings/branch_protection_rules

**CODEOWNERS** (`.github/CODEOWNERS`) maps directories to reviewer groups:

| Path | Required reviewer |
|---|---|
| `/contracts/` | `@StellarLock/core-team` |
| `/src/lib/` | `@StellarLock/core-team` |
| `/src/` | `@StellarLock/frontend-team` |
| `/.github/` | `@StellarLock/lead` |
| `/vercel.json` | `@StellarLock/lead` |
| `package.json`, `pnpm-lock.yaml`, `contracts/Cargo.toml`, `contracts/Cargo.lock` | `@StellarLock/core-team` |
| Everything else (catch-all) | `@StellarLock/core-team` |

To update protection rules, a repository admin must use the GitHub UI (**Settings → Branches**) or the GitHub API. Do not bypass reviews with admin overrides on contract-touching PRs.


## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/), enforced by `commitlint.config.js`. The husky `commit-msg` hook rejects non-conforming messages locally, and the **Commit Message Lint** CI job checks every commit in a PR.

Format: `type(scope): description` — the scope is optional, but if you give one it must be from the list below.

**Allowed types** (from `@commitlint/config-conventional`): `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Allowed scopes** — only these four:

| Scope | Use for | Example |
|---|---|---|
| `contract` | Soroban contracts in `contracts/` | `fix(contract): prevent overflow in extend lock duration` |
| `frontend` | Anything under `src/`, plus `api/` and `indexer/` | `feat(frontend): add export button to My Locks page` |
| `ci` | GitHub Actions, husky hooks, repo tooling | `chore(ci): cache pnpm store in e2e job` |
| `docs` | `docs/`, README, CONTRIBUTING, ADRs | `docs(docs): add ADR for split lock allocation` |

Scopes like `i18n`, `deps`, `ui` or `api` are **rejected**. Use the closest allowed scope instead, or omit the scope:

- ❌ `fix(i18n): correct French translation` → ✅ `fix(frontend): correct French translation`
- ❌ `build(deps): bump stellar-sdk` → ✅ `build: bump stellar-sdk`

Run `pnpm changelog` to generate CHANGELOG.md, or `pnpm changelog:release` when cutting a tagged release.
