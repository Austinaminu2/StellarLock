import { useAsync } from "@/hooks/useAsync"
import { getTokenBalance, getTokenAllowance } from "@/lib/stellar"
import {
  getLock,
  getLocksByToken,
  getLocksByCreator,
  getLocksByBeneficiary,
  getLockCountByCreator,
  getLockCountByBeneficiary,
  getLockCountByToken,
} from "@/lib/token-locker"
import {
  getLpLock,
  getLpLocksByBeneficiary,
  getLpLocksByCreator,
  getLpLockCountByCreator,
  getLpLockCountByBeneficiary,
} from "@/lib/lp-locker"
import { fetchPricesBatch } from "@/lib/prices"
import {
  fetchIndexerLocksForToken,
  fetchIndexerStats,
  mapIndexerLocks,
  mapIndexerLocksPageToSummary,
} from "@/lib/indexer-client"
import { getOnChainTokenMeta } from "@/lib/token-metadata"
import type { Lock, TokenMeta } from "@/types/lock"

async function withUsdValues(locks: Lock[]): Promise<Lock[]> {
  if (locks.length === 0) return locks
  const addresses = locks.map((l) => l.token.address)
  const prices = await fetchPricesBatch(addresses)
  return locks.map((l) => ({ ...l, usdValue: (prices.get(l.token.address) ?? 0) * l.amount }))
}

/**
 * Single lock by id and type. Tries token-locker for "token" type,
 * lp-locker for "lp" type.
 */
export function useLock(id: string | undefined, type: "token" | "lp" = "token") {
  return useAsync(async () => {
    if (!id) return null
    const raw = type === "lp" ? await getLpLock(id) : await getLock(id)
    if (!raw) return null
    const [enriched] = await withUsdValues([raw])
    return enriched
  }, [id, type])
}

/** Public explorer: all locks for a token address. Prefers the lock indexer (faster, paginated at the DB level); falls back to direct RPC if the indexer is unreachable or has no data for this token. */
export function useLocksByToken(tokenAddress: string | undefined, offset = 0, limit = 50) {
  return useAsync(async () => {
    if (!tokenAddress) return null
    const indexerPage = await fetchIndexerLocksForToken(tokenAddress, offset, limit)
    const summary = indexerPage
      ? ((await mapIndexerLocksPageToSummary(indexerPage)) ?? (await getLocksByToken(tokenAddress, offset, limit)))
      : await getLocksByToken(tokenAddress, offset, limit)
    if (!summary) return null
    const enriched = await withUsdValues(summary.locks)
    const totalUsdValue = enriched.reduce((s, l) => s + l.usdValue, 0)
    return { ...summary, locks: enriched, totalUsdValue }
  }, [tokenAddress, offset, limit])
}

/** Lock count for a token (for pagination controls). Prefers the indexer's DB-level count. */
export function useLockCountByToken(tokenAddress: string | undefined) {
  return useAsync(async () => {
    if (!tokenAddress) return 0
    const indexerPage = await fetchIndexerLocksForToken(tokenAddress, 0, 1)
    if (indexerPage) return indexerPage.total
    return getLockCountByToken(tokenAddress)
  }, [tokenAddress])
}

/**
 * Upper bound used when a view needs a user's complete lock set (e.g. for
 * client-side filtering or aggregate stats). The on-chain contract paginates
 * by u32 so 10_000 is safe and well within practical limits.
 */
export const ALL_LOCKS_LIMIT = 10_000

/** Connected user's locks, split into created vs received (token + LP combined). */
export function useMyLocks(address: string | null, offset = 0, limit = 50) {
  return useAsync(async () => {
    if (!address) return { created: [] as Lock[], received: [] as Lock[], totalCreated: 0, totalReceived: 0 }
    const [tCreated, lpCreated, tReceived, lpReceived, tCreatedCount, lpCreatedCount, tReceivedCount, lpReceivedCount] =
      await Promise.all([
        getLocksByCreator(address, offset, limit),
        getLpLocksByCreator(address, offset, limit),
        getLocksByBeneficiary(address, offset, limit),
        getLpLocksByBeneficiary(address, offset, limit),
        getLockCountByCreator(address),
        getLpLockCountByCreator(address),
        getLockCountByBeneficiary(address),
        getLpLockCountByBeneficiary(address),
      ])
    const allLocks = [...tCreated, ...lpCreated, ...tReceived, ...lpReceived]
    const enriched = await withUsdValues(allLocks)
    const enrichedMap = new Map(enriched.map((l) => [l.id, l]))

    const created = [...tCreated, ...lpCreated].map((l) => enrichedMap.get(l.id) ?? l)
    const received = [...tReceived, ...lpReceived]
      .filter((l) => l.creator !== address)
      .map((l) => enrichedMap.get(l.id) ?? l)
    return {
      created,
      received,
      totalCreated: tCreatedCount + lpCreatedCount,
      totalReceived: tReceivedCount + lpReceivedCount,
    }
  }, [address, offset, limit])
}

/**
 * Aggregate stats for all of a user's created locks, independent of
 * pagination. Fetches the full set so that "Total Value Locked" and
 * "Ready to withdraw" are always accurate regardless of which page is shown.
 *
 * Fixes: stats computed from the current page only (issue #595).
 */
export interface MyLocksStats {
  totalValue: number
  unlockable: number
}

export function useMyLocksStats(address: string | null) {
  return useAsync(async (): Promise<MyLocksStats> => {
    if (!address) return { totalValue: 0, unlockable: 0 }

    const [tCreated, lpCreated] = await Promise.all([
      getLocksByCreator(address, 0, ALL_LOCKS_LIMIT),
      getLpLocksByCreator(address, 0, ALL_LOCKS_LIMIT),
    ])

    const enriched = await withUsdValues([...tCreated, ...lpCreated])

    const now = Date.now()
    const totalValue = enriched.reduce((sum, l) => sum + l.usdValue, 0)
    const unlockable = enriched.filter((l) => l.unlockAt <= now && l.status !== "withdrawn").length

    return { totalValue, unlockable }
  }, [address])
}

/** Fetch a user's balance for a specific SEP-41 token contract. */
export function useTokenBalance(tokenAddress: string | undefined, owner: string | null) {
  return useAsync(
    () => (tokenAddress && owner ? getTokenBalance(tokenAddress, owner) : Promise.resolve(null)),
    [tokenAddress, owner],
  )
}

/** Fetch a user's allowance for a specific token contract and spender. */
export function useTokenAllowance(tokenAddress: string | undefined, owner: string | null, spender: string | undefined) {
  return useAsync(
    () => (tokenAddress && owner && spender ? getTokenAllowance(tokenAddress, owner, spender) : Promise.resolve(null)),
    [tokenAddress, owner, spender],
  )
}

export interface DiscoverTokenGroup {
  token: TokenMeta
  count: number
  totalValue: number
}

export interface DiscoverStats {
  /** Which backend actually served this data — surfaced for debugging/telemetry, not shown to users. */
  source: "indexer" | "mock"
  totalLocks: number
  totalValueLocked: number
  uniqueTokens: number
  recentLocks: Lock[]
  upcomingUnlocks: Lock[]
  tokenGroups: DiscoverTokenGroup[]
}

const FEATURED_TOKEN_COUNT = 6

/**
 * Site-wide discover stats (total locks, TVL, per-token breakdown, recent
 * activity). Fetches data from the indexer service, which enables cross-token
 * aggregates (uniqueTokens, per-token TVL ranking) without iterating every
 * token contract over RPC. Returns empty/zero stats if indexer is unavailable.
 */
export function useDiscoverStats() {
  return useAsync<DiscoverStats>(async () => {
    const stats = await fetchIndexerStats()

    if (!stats) {
      return {
        source: "indexer",
        totalLocks: 0,
        totalValueLocked: 0,
        uniqueTokens: 0,
        recentLocks: [],
        upcomingUnlocks: [],
        tokenGroups: [],
      }
    }

    const [recentLocks, upcomingUnlocks] = await Promise.all([
      mapIndexerLocks(stats.recentLocks).then(withUsdValues),
      mapIndexerLocks(stats.upcomingUnlocks).then(withUsdValues),
    ])

    const topTokenAddrs = stats.topTokens.map((t) => t.token)
    const [metaEntries, prices] = await Promise.all([
      Promise.all(topTokenAddrs.map(async (addr) => [addr, await getOnChainTokenMeta(addr)] as const)),
      fetchPricesBatch(topTokenAddrs),
    ])
    const metaMap = new Map(metaEntries)

    const tokenValue = (agg: (typeof stats.topTokens)[number]) => {
      const meta = metaMap.get(agg.token)
      const decimals = meta?.decimals ?? 7
      const amount = Number(BigInt(agg.totalLocked)) / 10 ** decimals
      return amount * (prices.get(agg.token) ?? 0)
    }

    const tokenGroups: DiscoverTokenGroup[] = stats.topTokens.slice(0, FEATURED_TOKEN_COUNT).map((agg) => {
      const meta = metaMap.get(agg.token)
      return {
        token: {
          address: agg.token,
          symbol: meta?.symbol ?? agg.token.slice(0, 6),
          name: meta?.name ?? agg.token.slice(0, 6),
          decimals: meta?.decimals ?? 7,
        },
        count: agg.lockCount,
        totalValue: tokenValue(agg),
      }
    })

    return {
      source: "indexer",
      totalLocks: stats.totalLocks,
      totalValueLocked: stats.topTokens.reduce((sum, agg) => sum + tokenValue(agg), 0),
      uniqueTokens: stats.uniqueTokens,
      recentLocks,
      upcomingUnlocks,
      tokenGroups,
    }
  }, [])
}
