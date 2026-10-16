# Architecture Decision Records

This directory contains ADRs for StellarLock.
An ADR documents a significant architectural choice made during development.

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](./ADR-001-soroban-smart-contracts.md) | Use Soroban for smart contracts | Accepted |
| [ADR-002](./ADR-002-separate-locker-contracts.md) | Separate token and LP locker contracts | Accepted |
| [ADR-003](./ADR-003-serverless-architecture.md) | Serverless — no backend, direct RPC | Accepted |
| [ADR-004](./ADR-004-freighter-wallet-strategy.md) | Freighter-first wallet strategy | Accepted |
| [ADR-005](./ADR-005-linear-vesting-only.md) | Linear vesting only | Accepted |
| [ADR-006](./ADR-006-immutable-locks.md) | Immutable locks — creator cannot withdraw | Accepted |
| [ADR-007](./ADR-007-frontend-stack.md) | React + Vite + Tailwind stack | Accepted |
| [ADR-008](./ADR-008-mock-data-testnet.md) | Mock data strategy for testnet | Accepted |
| [ADR-009](./ADR-009-lp-vesting.md) | LP Locker supports optional linear vesting | Accepted |
| [ADR-010](./ADR-010-rate-limit-via-temporary-storage.md) | Per-creator rate limiting via temporary storage | Accepted |
| [ADR-011](./ADR-011-split-lock-allocation.md) | Split-lock allocation model (BPS shares, dust assignment, group_id reuse) | Accepted |
| [ADR-012](./ADR-012-rpc-client-caching.md) | RpcClient: in-flight deduplication, response cache, concurrency queue, and retry | Accepted |

## Template
Use [ADR-TEMPLATE.md](./ADR-TEMPLATE.md) for new decisions.