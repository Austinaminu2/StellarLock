# Issue #713 — MyLocks bulk extend/transfer partial-failure handling is untested

**GitHub:** https://github.com/StellarLock/StellarLock/issues/713  
**Status:** Open  
**Area:** `src/pages/MyLocks.tsx` — `handleBulkExtend` / `handleBulkTransfer`

---

## Problem

`handleBulkExtend` and `handleBulkTransfer` in `src/pages/MyLocks.tsx` iterate `selectedLocks`
inside a `for...of` loop, wrapping each call in its own `try/catch`. When one lock's contract
call throws, the error is reported for that item via `onItemSettled` and the loop continues to
process the remaining locks — per-item failure isolation is the intended behaviour.

No unit test exists for the `MyLocks` component. A regression that turned the per-item
`try/catch` into a loop-aborting error (e.g. a bare `await` outside a `try`, or an
unhandled re-throw) would silently break all remaining locks in the batch with nothing to
catch it.

---

## Affected code

### `handleBulkExtend` — `src/pages/MyLocks.tsx`

```ts
const handleBulkExtend = useCallback(
  async (
    newDate: string,
    onItemSettled: (id: string, outcome: { status: "success" | "error"; error?: string }) => void,
  ) => {
    const newUnlockSecs = Math.floor(new Date(newDate).getTime() / 1000)
    for (const lock of selectedLocks) {
      if (Math.floor(lock.unlockAt / 1000) >= newUnlockSecs) {
        onItemSettled(lock.id, { status: "success" })
        continue
      }
      try {
        if (lock.kind === "lp") {
          await extendLpLock(lock.id, newUnlockSecs, address!, signTransaction)
        } else {
          await extendLock(lock.id, newUnlockSecs, address!, signTransaction)
        }
        onItemSettled(lock.id, { status: "success" })
      } catch {
        onItemSettled(lock.id, { status: "error", error: "Extend failed" })
      }
    }
    reload()
    exitSelectMode()
  },
  [selectedLocks, address, signTransaction, reload],
)
```

### `handleBulkTransfer` — `src/pages/MyLocks.tsx`

```ts
const handleBulkTransfer = useCallback(
  async (
    newBeneficiary: string,
    onItemSettled: (id: string, outcome: { status: "success" | "error"; error?: string }) => void,
  ) => {
    for (const lock of selectedLocks) {
      try {
        if (lock.kind === "lp") {
          await transferLpBeneficiary(lock.id, newBeneficiary.trim(), address!, signTransaction)
        } else {
          await transferBeneficiary(lock.id, newBeneficiary.trim(), address!, signTransaction)
        }
        onItemSettled(lock.id, { status: "success" })
      } catch {
        onItemSettled(lock.id, { status: "error", error: "Transfer failed" })
      }
    }
    reload()
    exitSelectMode()
  },
  [selectedLocks, address, signTransaction, reload],
)
```

### Supporting functions called

| Function | File | Auth requirement |
|---|---|---|
| `extendLock` | `src/lib/token-locker.ts` | caller must be lock `creator` |
| `extendLpLock` | `src/lib/lp-locker.ts` | caller must be lock `creator` |
| `transferBeneficiary` | `src/lib/token-locker.ts` | caller must be lock `beneficiary` |
| `transferLpBeneficiary` | `src/lib/lp-locker.ts` | caller must be lock `beneficiary` |

All four are plain `async` functions that return `Promise<{ txHash: string }>` and throw on
any contract or network error.

### `onItemSettled` callback contract

Defined via `ItemOutcome` in `src/components/locks/BulkConfirmModal.tsx`:

```ts
interface LockResult {
  id: string
  status: "pending" | "success" | "error"
  error?: string
}

type ItemOutcome = Omit<LockResult, "id">
// { status: "pending" | "success" | "error"; error?: string }
```

The bulk handlers only ever call `onItemSettled` with `"success"` or `"error"` — the
`"pending"` value is used internally by the modal before the loop starts.

---

## Existing test coverage

| File | What it covers |
|---|---|
| `src/test/BulkConfirmModal.test.tsx` | Modal UI: title, lock list, date/address inputs, cancel/close, loading spinners, per-lock settled state rows, mixed success/error display |
| `e2e/my-locks.spec.ts` | Full-page E2E flow |
| _(none)_ | `MyLocks` component unit tests — **does not exist** |

The `BulkConfirmModal` tests do exercise `onItemSettled` from the modal's perspective (it
receives the callback). They do **not** test the loop logic inside `handleBulkExtend` or
`handleBulkTransfer` that decides whether to call it with `"success"` or `"error"`.

---

## What a test must cover

### Acceptance criteria (from issue)

> Add a test that selects multiple locks, mocks `extendLock` to reject for one lock id and
> resolve for others, and asserts `onItemSettled` reports `"error"` and `"success"`
> respectively.

### Scenarios to verify

#### `handleBulkExtend`

1. **Partial failure — loop continues.**  
   Given three selected token locks and `extendLock` mocked to reject only for lock `"2"`,
   calling `handleBulkExtend` must:
   - Call `onItemSettled("1", { status: "success" })` for the first lock.
   - Call `onItemSettled("2", { status: "error", error: "Extend failed" })` for the failing lock.
   - Call `onItemSettled("3", { status: "success" })` for the third lock — i.e. the loop does
     not abort after the failure.
   - Call `extendLock` exactly twice (locks `"1"` and `"3"`), not once.

2. **Skip condition — already at or past the new date.**  
   A lock whose `unlockAt` is already ≥ the requested new date must be settled as `"success"`
   immediately without calling `extendLock`.

3. **LP lock routing.**  
   A lock with `kind: "lp"` must call `extendLpLock`, not `extendLock`.

#### `handleBulkTransfer`

1. **Partial failure — loop continues.**  
   Same structure as the extend test: mock `transferBeneficiary` to reject for one id and
   resolve for others; assert all `onItemSettled` calls fire in order and processing is not
   abandoned after the first failure.

2. **LP lock routing.**  
   A lock with `kind: "lp"` must call `transferLpBeneficiary`, not `transferBeneficiary`.

### Suggested test file location

```
src/test/MyLocks.bulk.test.tsx
```

Since `handleBulkExtend` and `handleBulkTransfer` are component-internal callbacks passed to
`BulkConfirmModal`, the most direct approach is to render `MyLocks` with the wallet and lock
hooks mocked (following the pattern in `src/test/BulkConfirmModal.test.tsx`), trigger the bulk
flow through the component's UI, and spy on the `extendLock` / `transferBeneficiary` module
exports.

Alternatively, the callbacks can be extracted into standalone utility functions (outside the
component) to allow pure unit testing without rendering.

### Key mocks needed

```ts
// Module mocks
vi.mock("@/lib/token-locker", () => ({
  extendLock: vi.fn(),
  transferBeneficiary: vi.fn(),
}))
vi.mock("@/lib/lp-locker", () => ({
  extendLpLock: vi.fn(),
  transferLpBeneficiary: vi.fn(),
}))
vi.mock("@/hooks/useLocks", () => ({
  useMyLocks: vi.fn(),
  useMyLocksStats: vi.fn(),
}))
vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => mockWallet,
  WalletProvider: ({ children }) => children,
}))

// Per-test: make extendLock reject only for lock "2"
import { extendLock } from "@/lib/token-locker"
vi.mocked(extendLock).mockImplementation(async (id) => {
  if (id === "2") throw new Error("ledger rejected")
  return { txHash: "abc" }
})
```

---

## Edge cases to keep in mind

- `handleBulkExtend` converts the date string to Unix **seconds** and compares against
  `lock.unlockAt / 1000` (the lock stores milliseconds). An off-by-one in that conversion
  would silently skip locks that should be extended.
- Both handlers call `reload()` and `exitSelectMode()` after the loop, regardless of how
  many items failed. Tests should confirm these are still called even when one item errors.
- `onProgress` is never passed from the bulk handlers, so the phase callbacks on
  `extendLock`/`transferBeneficiary` are always `undefined` — no need to assert on them.
