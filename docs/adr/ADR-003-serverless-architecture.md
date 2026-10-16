# ADR-003: Serverless — No Backend, Direct RPC

## Status
Accepted

## Context
StellarLock is a public explorer and lock-creation UI. It needs on-chain data
and transaction submission but does not require a custom API layer.

## Decision
Run as a static frontend with no backend server. All contract reads and writes
go directly from the browser to the Soroban RPC endpoint.

## Consequences
- Zero backend infrastructure cost or maintenance for core lock creation/viewing
- CSP and Vercel edge config manage the frontend deployment
- Frontend is deployed as a static site (Vercel SPA rewrite to `index.html`)
- Contract RPC calls are wrapped in `src/lib/stellar.ts` (`RpcClient` class)
- Local read caching and concurrency limits live in the frontend — see
  [ADR-012](./ADR-012-rpc-client-caching.md) for the full design of the cache-key
  scheme, TTL, in-flight deduplication map, concurrency queue, and retry policy
- No server-side rate limiting or auth — security is contract-enforced
- Local read caching and concurrency limits live in the frontend
- Security for direct contract interaction remains strictly contract-enforced

### Subsequent Evolution & Operational Backend Addition
While the core frontend operates directly against Soroban RPC without requiring a custom API layer, the platform has subsequently added stateful backend components to support indexing and notification delivery:
- **Event Indexer (`indexer/index.ts`)**: A long-running SQLite-backed background worker that polls Soroban contract events into a local database (`LOCK_INDEX_DB_PATH`) to provide fast queries and historical cache data.
- **Notifier Worker (`indexer/notifier.ts`)**: A scheduled/cron process (running hourly by default) that checks upcoming unlocks and dispatches reminder notifications via email and HMAC-signed webhooks.
- **Serverless API Routes (`api/notifications/*.ts`, `api/indexer-*.ts`)**: Edge/serverless functions that query and mutate notification subscriptions and indexer state with their own input validation and rate limiting.
- **New Operational Surface**: Introduces persistent SQLite storage requirements, background process monitoring (e.g. systemd/Docker), cron scheduling, and server-side secret management (`RESEND_API_KEY`, `WEBHOOK_SECRET`). Core dApp wallet interactions remain decentralized and direct-to-RPC as originally architected.

