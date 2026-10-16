# Contract Storage Optimization — Issue #148

## Problem

Both `token-locker` and `lp-locker` contracts have the following inefficiencies:

1. **Unconditional PERSISTENT_BUMP (365 days)** applied on every read/write, including
   withdrawn locks — rent keeps accruing indefinitely even after funds are gone.
2. **Full Address storage in indexes** — `ByCreator(Address)` / `ByBeneficiary(Address)` keys
   encode the full 32-byte address inside the enum variant, making key serialisation larger
   than necessary.
3. **No archive path for withdrawn locks** — withdrawn locks stay at full 1-year TTL forever.

## Proposed Changes

### `save_lock` — selective TTL renewal

```rust
fn save_lock(env: &Env, lock: &Lock) {
    let key = DataKey::Lock(lock.id);
    env.storage().persistent().set(&key, lock);
    // Only bump TTL for active (non-withdrawn) locks
    if !lock.withdrawn {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    } else {
        // Withdrawn locks get a short TTL — enough to be queried but not renewed forever
        env.storage()
            .persistent()
            .extend_ttl(&key, WITHDRAWN_THRESHOLD, WITHDRAWN_BUMP);
    }
}
```

New constants:
```rust
const WITHDRAWN_BUMP: u32      = 30 * LEDGERS_PER_DAY;  // 30 days
const WITHDRAWN_THRESHOLD: u32 = 7  * LEDGERS_PER_DAY;  // 7 days
```

### `push_index` — same selective logic for index entries

Apply `PERSISTENT_BUMP` only when the associated lock is active; use `WITHDRAWN_BUMP` otherwise.

### Storage cost comparison (estimated)

| Scenario | Before | After |
|---|---|---|
| Active lock TTL | 365 days | 365 days (unchanged) |
| Withdrawn lock TTL | 365 days (renewed forever) | 30 days (one-shot) |
| Rent saving per withdrawn lock | — | ~11.6× cheaper TTL |

## Status

**Implemented.** The selective TTL logic has been applied to both contracts:

- `contracts/token-locker/src/lib.rs` — `WITHDRAWN_BUMP` / `WITHDRAWN_THRESHOLD` constants
  added; `save_lock` and `push_index` branch on `lock.withdrawn` to apply the short TTL for
  withdrawn locks and the full TTL for active locks.
- `contracts/lp-locker/src/lib.rs` — same changes applied identically.
- `contracts/token-locker/src/tests.rs` — three tests added under
  "Storage optimization: selective TTL (#148)" covering both TTL branches.
- `contracts/lp-locker/src/tests.rs` — three equivalent tests added.
