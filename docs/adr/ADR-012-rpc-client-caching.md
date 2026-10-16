# ADR-012: RpcClient — In-Flight Deduplication, Response Cache, Concurrency Queue, and Retry

## Status
Accepted

## Context
StellarLock runs as a static frontend with no backend (see [ADR-003](./ADR-003-serverless-architecture.md)).
All contract reads go directly from the browser to a public Soroban RPC endpoint via
`simulateTransaction`. Several UI components can simultaneously request the same on-chain
read (e.g. token balance, lock details) on the same render cycle, and the app navigates
between pages that re-mount and re-fetch the same data within seconds of each other.

Without coordination, this produces:

- **Duplicate in-flight requests** — the same RPC call issued multiple times concurrently
  because different components race to fetch the same resource.
- **Redundant re-fetches** — re-navigation or re-render fetching data that was retrieved
  moments ago and is still valid.
- **RPC rate-limit pressure** — public endpoints throttle aggressive clients; unbounded
  concurrency amplifies the problem.
- **Transient network failures** — a single network hiccup surfacing as a user-visible error
  instead of being silently retried.

Additionally, Soroban's `TransactionBuilder` bakes the current wall-clock time into
`timeBounds.maxTime` on every call, making the raw XDR non-deterministic. Deriving cache
keys from `tx.toXDR()` would defeat caching almost entirely — two logically identical reads
issued one second apart would produce different XDR bytes and cache misses.

## Decision

The `RpcClient` class in `src/lib/stellar.ts` wraps `SorobanRpc.Server.simulateTransaction`
with four coordinated layers. All four apply only to **read (simulate) calls**; write paths
(`submitCall`, `submitCallWithHash`) bypass this class and go directly to the server.

### 1. Caller-supplied cache keys

`simulate(tx, cacheKey, cacheTtlMs?)` requires the caller to pass an explicit string key
rather than deriving one from the transaction XDR. This sidesteps the non-deterministic
`timeBounds.maxTime` problem. Callers construct keys from the logical identity of the
read — typically `contractId + ":" + method + ":" + serialised-args`.

### 2. Response cache (TTL: 10 seconds)

A `Map<string, { data, expiry }>` stores successful responses keyed by the caller-supplied
key. On each `simulate()` call the cache is checked first:

- **Hit and not expired** → return cached data immediately, no network call.
- **Expired or absent** → proceed to in-flight dedup (layer 3).

The default TTL is **10 000 ms** (`CACHE_TTL_MS`). Callers may override it per call by
passing `cacheTtlMs`; passing `0` disables caching for that call entirely (used by write
paths that need a fresh simulation for fee estimation).

`invalidateCache()` clears all cached entries immediately. It is called by `invalidateRpcCache()`
after every mutation (lock creation, withdrawal, extension) so the UI reflects on-chain
state as soon as the transaction confirms. In-flight promises are intentionally **not**
cancelled: they will resolve normally but their results will not be stored in the
now-cleared cache, so the next caller gets a fresh fetch.

### 3. In-flight request deduplication

A `Map<string, Promise<SimulateTransactionResponse>>` tracks every request that has passed
the cache check but has not yet resolved. When `simulate()` finds an existing promise for
the same key it returns that promise directly. Multiple concurrent callers waiting on the
same key all receive the same single promise and share one network round-trip.

On resolution (success or error) the key is removed from the in-flight map so the next
call after settlement goes through the full lookup path again.

### 4. Concurrency queue (max: 5)

`withConcurrencyLimit(fn)` enforces a maximum of **5** simultaneous in-progress RPC calls
(`MAX_CONCURRENT`). A numeric counter (`activeCount`) tracks live calls; new calls that
arrive when the limit is reached are pushed onto a FIFO `queue` array as thunks. Each
completing call decrements the counter and drains the next thunk from the queue.

This bounds the number of open connections to the public RPC endpoint regardless of how
many components trigger reads simultaneously.

### 5. Retry with exponential backoff

`retrySimulate(tx)` wraps the actual `server.simulateTransaction()` call (itself already
gated by the concurrency queue) in a retry loop:

- Up to **3 retries** after the initial attempt (`MAX_RETRIES = 3`), giving 4 total tries.
- Backoff delay between attempts: `1 000 × 2^attempt` ms → **1 s, 2 s, 4 s**.
- If all attempts fail the last error is re-thrown to the caller.

Retry applies at the network level only. Simulation errors returned by the RPC node (e.g.
contract panics, insufficient fees) are not retried — they propagate immediately as the
resolved value and are handled upstream by `simulateCall`.

### Request flow summary

```
simulate(tx, key)
  │
  ├─ cache hit & not expired?  → return cached data
  │
  ├─ key already in-flight?    → return existing promise (dedup)
  │
  └─ new request
       │
       ├─ activeCount < 5?  → proceed immediately
       │                       else enqueue (FIFO) and await slot
       │
       └─ retrySimulate()
            ├─ attempt 0
            ├─ (fail) wait 1 s → attempt 1
            ├─ (fail) wait 2 s → attempt 2
            ├─ (fail) wait 4 s → attempt 3
            └─ (fail) throw
```

On success the response is written to the cache (unless `cacheTtlMs = 0`) and the
in-flight entry is removed.

## Consequences

- **Staleness window**: reads are cached for up to 10 seconds. UI state after a mutation
  that calls `invalidateRpcCache()` is correct, but background polling or navigation within
  the TTL window may show data that lags the chain by up to one TTL period. This is
  acceptable for a lock explorer; locks do not change state at sub-10-second granularity
  under normal use.
- **Debugging stale reads**: if a component appears to show stale data, check whether
  `invalidateRpcCache()` is called after the relevant mutation. Do **not** remove caching
  globally — it exists to prevent hammering the public RPC endpoint.
- **Adjusting the TTL**: `CACHE_TTL_MS` is a module-level constant in `src/lib/stellar.ts`.
  It can be lowered for higher-frequency refresh needs; raising it increases the staleness
  risk. Per-call overrides are available via the `cacheTtlMs` parameter.
- **Concurrency limit**: `MAX_CONCURRENT = 5` is conservative for public endpoints. If the
  app is pointed at a dedicated RPC node this can be raised, but the dedup layer means the
  practical concurrency under normal UI load is already well below this limit.
- **Write calls are unaffected**: `submitCall` and `submitCallWithHash` call
  `server.simulateTransaction` directly (for fee estimation) and then `server.sendTransaction`
  — neither goes through `RpcClient.simulate`. They are not cached or deduplicated.
- **Single-instance singleton**: `getClient()` returns a module-level singleton, so the
  cache and in-flight maps are shared across all call sites in the same browser tab. This
  is intentional; it is the mechanism that makes dedup work across independently mounted
  components.

See also: [ADR-003 — Serverless Architecture](./ADR-003-serverless-architecture.md),
[CHANGELOG issue #82](https://github.com/SYMBAxx/StellarLock/issues/82).
