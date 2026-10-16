# StellarLock Contracts

Two Soroban smart contracts that power StellarLock.

## Contracts

### `token-locker`

Locks SEP-41 tokens with an optional linear vesting schedule.

**Storage layout**
- `Lock(u64)` — lock struct by id
- `NextId` — auto-incrementing id counter (starts at 1000)
- `ByCreator(Address)` — index of lock ids per creator
- `ByBeneficiary(Address)` — index of lock ids per beneficiary
- `ByToken(Address)` — index of lock ids per token

**Key invariants**
- `unlock_at` can only increase, never decrease
- Only the beneficiary can withdraw, only after `unlock_at`
- Only the creator can extend
- Tokens are held by the contract until withdrawal

**Split locks** (`create_split_lock`)
- Lock one token amount, split across 2–10 beneficiaries via basis-point shares (must sum to 10 000)
- Each beneficiary receives an independent `Lock` sub-lock with their proportional amount; integer-division remainder goes to the last beneficiary (see [ADR-011](../docs/adr/ADR-011-split-lock-allocation.md))
- An optional vesting schedule applies uniformly to every sub-lock in the group
- The returned `group_id` is also the lock id of the first sub-lock; use `get_split_group` to enumerate all sub-lock ids
- Storage layout additions: `SplitGroup(u64)` — split group record by group_id; `SplitByCreator(Address)` — index of split group ids per creator

### `lp-locker`

Locks LP pool share tokens from Aquarius or Soroswap with optional linear vesting, matching `token-locker`'s vesting semantics. Carries additional `dex`, `token_a`, `token_b` fields to identify the underlying pool.

**Storage layout**
- `Lock(u64)` — lock struct by id
- `NextId` — auto-incrementing id counter (starts at 5000)
- `ByCreator(Address)` — index of lock ids per creator
- `ByBeneficiary(Address)` — index of lock ids per beneficiary
- `ByPoolShare(Address)` — index of lock ids per pool-share token
- `SplitGroup(u64)` — split group record by group_id
- `SplitByCreator(Address)` — index of split group ids per creator

**Key invariants**
- `unlock_at` can only increase, never decrease
- Only the beneficiary can withdraw, only after `unlock_at`
- Only the creator can extend
- Without a vesting schedule, the full amount is released at `unlock_at`
- With a vesting schedule, each withdrawal releases only the linearly vested
  portion since the last claim; the lock stays open until fully released

**Split locks** (`create_split_lock`)
- Transfer one pool-share token amount, split across 2–10 beneficiaries via basis-point shares (must sum to 10 000)
- Each beneficiary receives an independent `LpLock` sub-lock with their proportional amount; integer-division remainder goes to the last beneficiary (see [ADR-011](../docs/adr/ADR-011-split-lock-allocation.md))
- An optional vesting schedule applies uniformly to every sub-lock in the group
- The returned `group_id` is also the lock id of the first sub-lock; use `get_split_group` to enumerate all sub-lock ids
- TVL is counted once (total amount) and global lock count increments by the number of sub-locks

## Build

```bash
stellar contract build
```

## Test

```bash
cargo test
```

## Deploy

```bash
./deploy.sh <account-alias>
```

## Deployed Addresses (Testnet)

| Contract | Address |
|---|---|
| token-locker | `CBFCKEOQRQIXKLGU4QBUQVOINOKFBOXJ37LXEKLKNUO6TW4FNGDU26AW` |
| lp-locker | `CA3WYETNIF5IAF3VUNQ3SYKZFV45TOFBF7CEZ46I7QEBPWTRM73WLEI4` |
