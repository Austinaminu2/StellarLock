# StellarLock Contract Security Audit Checklist

## Threat Model

### What the contracts protect against

- **Rug pulls**: Locked tokens cannot be withdrawn before `unlock_at` by anyone, including the creator
- **Unauthorized withdrawal**: Only the designated beneficiary can withdraw, and only after the unlock timestamp
- **Lock shortening**: The `extend` function enforces `new_unlock_at > lock.unlock_at`, making it impossible to shorten a lock
- **Unauthorized extension**: Only the creator can extend; the beneficiary cannot change the unlock date
- **Double withdrawal**: The `withdrawn` flag prevents re-entry after full withdrawal
- **Beneficiary hijacking**: Only the current beneficiary can transfer the beneficiary role

### What the contracts do NOT protect against

- **Token contract bugs**: If the underlying SEP-41 token has vulnerabilities, the locker contract cannot prevent exploitation
- **Key compromise**: If a beneficiary's private key is compromised, the attacker can withdraw after unlock
- **Governance token risks**: Locked governance tokens can still be delegated if the token contract supports it (not enforced by the locker)
- **Price manipulation**: The contracts deal in token amounts, not USD values; price fluctuations are outside scope

## Soroban-Specific Security Checklist

### 1. Reentrancy

- [x] **Status: Immune** — Soroban's execution model is sequential within a single invocation. There is no callback mechanism that would allow a malicious token contract to re-enter the locker mid-execution. Each `token::Client::transfer` call completes before the next instruction runs.

### 2. Integer Overflow (i128 amounts)

- [x] **Status: Safe** — Token amounts use `i128`, which provides a range far exceeding any realistic token supply. The contracts assert `amount > 0` on creation. Vesting arithmetic uses `saturating_sub` to prevent underflow. The `.min(lock.amount)` cap on vested amounts prevents over-release.
- [ ] **Recommendation**: Consider adding explicit overflow checks on the vesting calculation `lock.amount * elapsed / duration` — while unlikely with i128, a formally verified bound would strengthen the audit posture.

### 3. Authorization Model (`require_auth`)

Both `TokenLocker` and `LpLocker` expose the same set of gated entry points. All 13 call sites are listed below, grouped by the signer required.

#### User-gated (lock-level)

- [x] **`create_lock`**: `creator.require_auth()` — ensures the funder authorized the token transfer
- [x] **`withdraw`**: `lock.beneficiary.require_auth()` — only the beneficiary can withdraw
- [x] **`extend`**: `lock.creator.require_auth()` — only the creator can extend
- [x] **`transfer_beneficiary`**: `lock.beneficiary.require_auth()` — only the current beneficiary can transfer the role
- [x] **Admin management**: `get_admin()` is read-only; `propose_admin()` requires the current admin; `accept_admin()` requires the nominated pending admin
- [x] **Emergency controls**: `pause()` and `unpause()` require the current admin; a pause blocks non-admin lock lifecycle writes but does not block reads or admin/governance calls
- [x] All write operations require authentication from the appropriate party
- [x] **`create_split_lock`**: `creator.require_auth()` — same guarantee for split/multi-beneficiary locks
- [x] **`withdraw`**: `lock.beneficiary.require_auth()` — only the designated beneficiary can withdraw
- [x] **`extend`**: `lock.creator.require_auth()` — only the original creator can extend the unlock date
- [x] **`transfer_beneficiary`**: `lock.beneficiary.require_auth()` — only the current beneficiary can reassign the role

#### Admin-gated (contract-level)

- [x] **`init`**: `admin.require_auth()` — prevents anyone other than the supplied admin from initialising the contract
- [x] **`propose_admin`**: `admin.require_auth()` — only the current admin can nominate a successor
- [x] **`accept_admin`**: `pending.require_auth()` — the incoming admin must sign to complete the two-step handover
- [x] **`propose_upgrade`**: `admin.require_auth()` — only admin can submit a new WASM hash for the time-locked upgrade queue
- [x] **`execute_upgrade`**: `admin.require_auth()` — only admin can apply a queued upgrade after the delay period
- [x] **`cancel_upgrade`**: `admin.require_auth()` — only admin can abort a pending upgrade
- [x] **`pause`**: `admin.require_auth()` — only admin can halt user-facing operations
- [x] **`unpause`**: `admin.require_auth()` — only admin can resume operations

> **Note**: The admin-gated functions are the highest-privilege operations in the system. A compromised or malicious admin could pause the contract indefinitely, push a malicious upgrade, or reassign themselves out of admin to a fresh address. The two-step admin transfer and the upgrade time-lock mitigate these risks but do not eliminate them entirely. Both should be covered in any third-party audit.

### 4. Storage TTL Expiry Risks

- [x] **Status: Mitigated** — Soroban persistent storage entries have a TTL. Active locks are protected against non-renewal.
- [x] **Recommendation (Implemented)**: Automatic TTL extension on read/write operations is implemented via `env.storage().persistent().extend_ttl()` for active locks (see [docs/storage-optimization.md](storage-optimization.md)). Both contracts expose a permissionless `bump_lock_ttl(id)` entry point allowing anyone to keep lock data alive.
- [x] **Recommendation (Implemented)**: Documented TTL policy in [docs/storage-optimization.md](storage-optimization.md).


### 5. Cross-Contract Call Safety

- [x] **Token transfers**: The contracts call `token::Client::new(&env, &token).transfer(...)` which is a standard Soroban cross-contract call to SEP-41 tokens. The token address is user-provided and stored at creation time.
- [ ] **Risk: Low** — A malicious token contract could panic during transfer, causing the withdrawal to fail. This would lock funds until the token contract is fixed. This is inherent to any token-locking design and is not a vulnerability in the locker itself.
- [ ] **Recommendation**: Document that StellarLock only supports standard SEP-41 tokens. Consider a token allowlist for mainnet.

### 6. Index Integrity

- [x] **`push_index`/`remove_from_index`**: Correctly maintain the `ByCreator`, `ByBeneficiary`, and `ByToken` indices
- [x] **`transfer_beneficiary`**: Properly removes from old beneficiary index and adds to new one
- [ ] **Risk: Low** — If `remove_from_index` is called for an id not in the index, it silently succeeds (no-op). This is correct behavior.

### 7. Timestamp Manipulation

- [x] **`env.ledger().timestamp()`** is used for time checks. Soroban ledger timestamps are consensus-agreed and cannot be manipulated by individual users.
- [ ] **Note**: Ledger close times have ~5 second granularity. Locks that unlock "at" a specific second may be withdrawable slightly before or after that exact moment. This is expected and documented.

### 8. Denial of Service

- [x] **Pagination added** (Issue #38): `get_locks_by_*` now accept `offset`/`limit` parameters, preventing unbounded reads that could exceed resource limits.
- [ ] **Risk: Low** — An attacker could create many small locks to inflate index sizes. The per-lock storage cost makes this economically unattractive. Pagination mitigates the read-side impact.

### 9. Front-Running

- [ ] **Risk: None** — There are no price-sensitive operations. Creating a lock, extending, or transferring beneficiary are not order-dependent in a way that creates MEV opportunities.

## Known Limitations

1. **No emergency withdrawal**: If the contract is upgraded or the token contract breaks, there is no admin override to release funds. This is by design — immutability is the trust guarantee.
2. **No partial lock creation**: Users must lock the full specified amount in one transaction. Cannot add to an existing lock.
3. **LP locker has no vesting**: Linear vesting is only available on token locks, not LP locks.
4. **No on-chain metadata**: Token names/symbols are derived client-side. The contracts only store addresses.
5. **Admin pause is an availability control**: A current admin can halt non-admin writes on each contract with `pause()`, but users cannot create, withdraw, extend, or transfer locks while paused. Reads and admin/governance calls remain available, and a pending upgrade can still execute after its timelock; an unsafe upgrade must be cancelled separately.

## Pre-Mainnet Checklist

- [ ] Engage a professional Soroban audit firm (e.g., OtterSec, Halborn, CertiK)
- [x] Implement storage TTL extension strategy (selective TTL renewal per [docs/storage-optimization.md](storage-optimization.md) and permissionless `bump_lock_ttl` entry points)
- [ ] Add fuzzing tests for vesting arithmetic edge cases
- [ ] Load test with 1000+ locks per address to validate pagination under resource limits
- [ ] Set up on-chain monitoring for unexpected state transitions
- [ ] Create an incident response plan for token contract failures
- [ ] Review and finalize token allowlist policy
- [ ] Document the upgrade/migration path if contract changes are needed post-deploy
