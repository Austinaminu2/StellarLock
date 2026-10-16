# ADR-011: Split-Lock Allocation Model (BPS Shares, Dust Assignment, group_id Reuse)

## Status
Accepted

## Context
`create_split_lock` — available on both `token-locker` and `lp-locker` — lets a
creator lock one token amount and distribute it across 2–10 beneficiaries in a
single transaction. Three non-obvious design points drive the implementation:

1. **How to express shares.** Percentages expressed as floating-point numbers
   are not available in Soroban's deterministic execution environment, and plain
   integer percentages give only 1 % granularity. A basis-point (bps) model
   (1 bps = 0.01 %) provides 10,000 levels of precision — enough for typical
   vesting cliffs, team allocations, and liquidity splits — while keeping all
   arithmetic in `u64` integers.

2. **How to handle integer-division remainder (dust).** Dividing a `total_amount`
   across N shares via `amount * bps / 10_000` produces floor-truncated results.
   The truncated fractions accumulate as an undistributed remainder. Three
   approaches were considered:

   a. **Proportional redistribution** — redistribute the remainder a second pass
      by rounding up the largest remainders first (largest-remainder method).
      Correct in the abstract, but requires a sort, a second loop, and extra
      on-chain compute; the per-beneficiary error is at most N−1 stropes
      (the smallest token unit) and the redistributed amounts are arbitrary from
      the beneficiaries' perspective anyway.

   b. **Burn / leave in contract** — leave the dust in the contract's balance.
      This permanently strands tokens and is never acceptable for a non-custodial
      locker whose invariant is that every deposited token is eventually
      withdrawable by a beneficiary.

   c. **Last beneficiary absorbs the remainder** — compute all but the last share
      via integer division, then assign `total_amount − total_allocated` to the
      last beneficiary. O(1) extra work, no sort, no second pass, zero dust
      stranded. The worst case is that the last beneficiary receives up to N−1
      extra stropes beyond their exact proportional share.

3. **Whether the group_id needs its own id counter slot.** Each sub-lock is a
   fully independent `Lock` / `LpLock` with its own id used by `withdraw`,
   `extend`, and `transfer_beneficiary`. The group-level record (`SplitGroup`)
   also needs a stable id so callers can look up the group. Allocating a
   *separate* id for the group (in addition to one per sub-lock) wastes an id
   counter slot and forces callers to track two different ids for the first
   beneficiary's lock. Reusing the group's id as the first sub-lock's id
   eliminates both costs.

## Decision

### 1. Basis-point shares, sum = 10,000

Each entry in the `beneficiaries` argument is `(Address, u64)` where the `u64`
is the share in basis points. The contract validates:

- Every individual share > 0 (a zero-share entry is rejected, not silently
  ignored).
- The sum of all shares == 10,000 exactly.

The error code `SharesMustSum10000` covers both failure modes.

### 2. Last beneficiary absorbs the integer-division remainder

For all beneficiaries except the last:

```
share_amount = total_amount * bps / 10_000   // integer (floor) division
```

For the last beneficiary:

```
share_amount = total_amount - total_allocated
```

This guarantees that the sum of all sub-lock `amount` fields equals
`total_amount` exactly. No tokens are stranded. The worst-case extra allocation
to the last beneficiary is `n − 1` stropes (one per earlier floor-truncation).
Callers who need strict proportionality at sub-strope precision cannot achieve
it with fungible integer tokens regardless of the algorithm chosen.

### 3. group_id reused as the first sub-lock's id

`create_split_lock` calls `get_id` once before the allocation loop to obtain
`group_id`. Inside the loop:

```rust
let lock_id = if i == 0 { group_id } else { get_id(&env) };
```

Consequences of this convention (see also below):

- `create_split_lock` returns `group_id`. Callers can pass that value to
  `get_lock(group_id)` to read the first beneficiary's lock directly, *or* to
  `get_split_group(group_id)` to enumerate every sub-lock id in the group.
- `SplitGroup.lock_ids[0] == group_id` is always true.
- The id counter is incremented `n` times per call (1 for the group/first lock
  + n−1 for the remaining sub-locks), the same as creating n individual locks.

## Consequences

- **Dust is not proportionally distributed.** The last beneficiary in the
  `beneficiaries` vector absorbs all integer-division remainders. Callers who
  care about the rounding direction should place the beneficiary most tolerant
  of a small surplus at the last position. This trade-off is intentional and
  documented here so it is not changed without understanding the implications.

- **group_id-reuse is a protocol invariant.** The indexer depends on it:
  `token-locker` emits a `lock_created` event for every sub-lock (including
  child 0 with `id = group_id`), so the indexer stores the first child's row
  under `token:${group_id}`. The subsequent `split_lock_created` summary event
  intentionally does *not* upsert a lock row — doing so would overwrite that
  row with the aggregate total and the creator as beneficiary. Any change to
  the group_id-reuse convention requires a matching indexer migration.

- **Per-beneficiary vesting is not supported.** The same `Vesting` value is
  applied to every sub-lock. Beneficiaries who need different vesting schedules
  must use separate `create_lock` calls. This is consistent with the linear-
  vesting-only constraint in ADR-005 and the lp-locker vesting decision in
  ADR-009.

- **lp-locker split-lock sub-locks are not indexed.** Unlike `token-locker`,
  `lp-locker`'s `create_split_lock` emits only one group-level
  `lp_split_lock_created` event and no per-child `lp_lock_created` events.
  The indexer therefore has no handler for lp split-lock children; they are
  only accessible via direct on-chain contract calls (`get_split_group`,
  `get_lock`). Closing this gap requires either adding per-child events to
  `lp-locker` (a contract upgrade) or a dedicated indexer handler for
  `lp_split_lock_created` that fetches child data via RPC.

- **2–10 beneficiary cap.** The lower bound (≥ 2) enforces that `create_split_lock`
  is only used when splitting is actually intended. The upper bound (≤ 10)
  bounds per-call compute and storage growth. These limits may be revised by a
  future ADR if demand warrants it.
