import { useMemo, useState, useCallback, useRef, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus, Wallet, Layers, Search, CheckSquare, LayoutGrid, Table2, Download, ChevronDown } from "lucide-react"
import { Helmet } from "react-helmet-async"
import { useTranslation } from "react-i18next"
import { useWallet } from "@/hooks/useWallet"
import { ALL_LOCKS_LIMIT, useMyLocks, useMyLocksStats } from "@/hooks/useLocks"
import { extendLock, transferBeneficiary } from "@/lib/token-locker"
import { extendLpLock, transferLpBeneficiary } from "@/lib/lp-locker"
import { exportToCSV, exportToJSON } from "@/lib/export"
import { Tabs } from "@/components/ui/Tabs"
import { Button } from "@/components/ui/Button"
import { StatCard } from "@/components/ui/StatCard"
import { LockCard } from "@/components/locks/LockCard"
import { LockTable } from "@/components/locks/LockTable"
import { Pagination } from "@/components/ui/Pagination"
import { BulkActionsToolbar } from "@/components/locks/BulkActionsToolbar"
import { BulkConfirmModal } from "@/components/locks/BulkConfirmModal"
import { ConnectGate } from "@/components/layout/ConnectGate"
import { SkeletonLockCard, SkeletonStatCard } from "@/components/ui/Skeleton"
import { cn, formatUsd } from "@/lib/utils"
import type { Lock, LockStatus } from "@/types/lock"

type Tab = "created" | "received"
type SortKey = "unlockAt" | "amount" | "createdAt"
type BulkAction = "extend" | "transfer" | null
type ViewMode = "card" | "table"

const PAGE_SIZE = 20
const VIEW_MODE_KEY = "stellarlock:locks-view-mode"

function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    return stored === "table" ? "table" : "card"
  } catch {
    return "card"
  }
}

function saveViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode)
  } catch {
    // ignore quota errors
  }
}

export function MyLocks() {
  const { t } = useTranslation()
  const { address, signTransaction } = useWallet()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  // Fetch the full lock set so search/status/kind filters apply across every
  // lock, not just the current page; pagination is done client-side below.
  const { data, loading, error, reload } = useMyLocks(address, 0, ALL_LOCKS_LIMIT)
  const { data: statsData, loading: statsLoading } = useMyLocksStats(address)
  const [tab, setTab] = useState<Tab>("created")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<LockStatus | "all">("all")
  const [kindFilter, setKindFilter] = useState<"all" | "token" | "lp">("all")
  const [sortKey, setSortKey] = useState<SortKey>("unlockAt")
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)

  // Bulk selection state
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<BulkAction>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  const created = data?.created ?? []
  const received = data?.received ?? []
  const totalCreated = data?.totalCreated ?? 0
  const totalReceived = data?.totalReceived ?? 0

  const stats = useMemo(() => {
    return {
      count: totalCreated,
      totalValue: statsData?.totalValue ?? 0,
      unlockable: statsData?.unlockable ?? 0,
    }
  }, [totalCreated, statsData])

  const rawList = tab === "created" ? created : received

  function handleTabChange(v: string) {
    setTab(v as Tab)
    setPage(1)
    exitSelectMode()
  }

  function handleViewMode(mode: ViewMode) {
    setViewMode(mode)
    saveViewMode(mode)
  }

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rawList
      .filter((l) => {
        if (statusFilter !== "all" && l.status !== statusFilter) return false
        if (kindFilter !== "all" && l.kind !== kindFilter) return false
        if (q && !l.token.symbol.toLowerCase().includes(q) && !l.id.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => {
        if (sortKey === "amount") return b.amount - a.amount
        if (sortKey === "createdAt") return b.createdAt - a.createdAt
        return a.unlockAt - b.unlockAt
      })
  }, [rawList, search, statusFilter, kindFilter, sortKey])

  // Clamp in case the filtered list shrinks (e.g. after a reload) below the current page.
  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedList = useMemo(
    () => filteredList.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredList, currentPage],
  )

  const selectedLocks = useMemo(() => filteredList.filter((l) => selectedIds.has(l.id)), [filteredList, selectedIds])

  const allSelected = pagedList.length > 0 && pagedList.every((l) => selectedIds.has(l.id))

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function handleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(pagedList.map((l) => l.id)))
    }
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const handleExportCSV = useCallback(() => {
    const filename = `stellar-locks-${tab}-${new Date().toISOString().split("T")[0]}.csv`
    exportToCSV(filteredList, filename)
    setExportOpen(false)
  }, [filteredList, tab])

  const handleExportJSON = useCallback(() => {
    const filename = `stellar-locks-${tab}-${new Date().toISOString().split("T")[0]}.json`
    exportToJSON(filteredList, filename)
    setExportOpen(false)
  }, [filteredList, tab])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportOpen(false)
      }
    }
    if (exportOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [exportOpen])

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

  return (
    <ConnectGate title={t("connectGate.title")}>
      <Helmet>
        <title>My Locks | StellarLock</title>
        <meta name="description" content="Manage and withdraw your locked token and LP positions on StellarLock." />
      </Helmet>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">{t("myLocks.title")}</h1>
            <p className="mt-2 text-muted-foreground">{t("myLocks.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <div className="relative" ref={exportMenuRef}>
              <Button
                variant="outline"
                onClick={() => setExportOpen(!exportOpen)}
                disabled={filteredList.length === 0}
                title={filteredList.length === 0 ? "No locks to export" : "Export locks"}
              >
                <Download className="h-4 w-4" />
                Export
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
              {exportOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-lg border border-border bg-background shadow-lg z-10">
                  <button
                    onClick={handleExportCSV}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-primary/10 rounded-t-lg"
                  >
                    Export as CSV
                  </button>
                  <button
                    onClick={handleExportJSON}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-primary/10 rounded-b-lg border-t border-border"
                  >
                    Export as JSON
                  </button>
                </div>
              )}
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setSelectMode((v) => !v)
                if (selectMode) exitSelectMode()
              }}
              aria-pressed={selectMode}
            >
              <CheckSquare className="h-4 w-4" />
              {selectMode ? "Cancel" : "Select"}
            </Button>
            <Button onClick={() => void navigate("/app/create")}>
              <Plus className="h-4 w-4" />
              {t("myLocks.newLock")}
            </Button>
          </div>
        </header>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {loading || statsLoading ? (
            <>
              <SkeletonStatCard />
              <SkeletonStatCard />
              <SkeletonStatCard />
            </>
          ) : (
            <>
              <StatCard
                label={t("myLocks.locksCreated")}
                value={String(stats.count)}
                icon={<Layers className="h-4 w-4" />}
              />
              <StatCard label={t("myLocks.totalValueLocked")} value={formatUsd(stats.totalValue)} />
              <StatCard
                label={t("myLocks.readyToWithdraw")}
                value={String(stats.unlockable)}
                hint={stats.unlockable > 0 ? t("myLocks.actionAvailable") : t("myLocks.nothingUnlocked")}
              />
            </>
          )}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Tabs
            value={tab}
            onChange={handleTabChange}
            items={[
              { value: "created", label: t("myLocks.createdByMe"), count: totalCreated },
              { value: "received", label: t("myLocks.beneficiary"), count: totalReceived },
            ]}
          />

          {/* Card / Table toggle */}
          <div
            role="group"
            aria-label="View mode"
            className="ml-auto flex items-center rounded-lg border border-border bg-card p-1 gap-1"
          >
            <button
              type="button"
              onClick={() => handleViewMode("card")}
              aria-pressed={viewMode === "card"}
              aria-label="Card view"
              title="Card view"
              className={cn(
                "inline-flex items-center justify-center rounded-md p-1.5 transition-colors cursor-pointer",
                viewMode === "card" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => handleViewMode("table")}
              aria-pressed={viewMode === "table"}
              aria-label="Table view"
              title="Table view"
              className={cn(
                "inline-flex items-center justify-center rounded-md p-1.5 transition-colors cursor-pointer",
                viewMode === "table" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Table2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search + filters */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search by token symbol or lock ID…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as LockStatus | "all")
              setPage(1)
            }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="locked">Locked</option>
            <option value="unlockable">Unlockable</option>
            <option value="withdrawn">Withdrawn</option>
          </select>

          <select
            value={kindFilter}
            onChange={(e) => {
              setKindFilter(e.target.value as "all" | "token" | "lp")
              setPage(1)
            }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
            aria-label="Filter by type"
          >
            <option value="all">All types</option>
            <option value="token">Token</option>
            <option value="lp">LP</option>
          </select>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
            aria-label="Sort locks"
          >
            <option value="unlockAt">Sort: Unlock date</option>
            <option value="amount">Sort: Amount</option>
            <option value="createdAt">Sort: Created</option>
          </select>
        </div>

        <LockListView
          locks={pagedList}
          loading={loading}
          error={error}
          onRetry={reload}
          tab={tab}
          hasFilters={search !== "" || statusFilter !== "all" || kindFilter !== "all"}
          selectable={selectMode}
          selectedIds={selectedIds}
          onSelect={toggleSelect}
          viewMode={viewMode}
        />

        <Pagination page={currentPage} pageSize={PAGE_SIZE} total={filteredList.length} onChange={setPage} />

        {/* Bulk actions toolbar */}
        {selectMode && (
          <BulkActionsToolbar
            selectedCount={selectedIds.size}
            onClear={exitSelectMode}
            onSelectAll={handleSelectAll}
            allSelected={allSelected}
            onBulkExtend={() => setBulkAction("extend")}
            onBulkTransfer={() => setBulkAction("transfer")}
            canExtend={tab === "created"}
            canTransfer={tab === "received"}
          />
        )}
      </div>

      {bulkAction && (
        <BulkConfirmModal
          action={bulkAction}
          locks={selectedLocks}
          onConfirm={bulkAction === "extend" ? handleBulkExtend : handleBulkTransfer}
          onClose={() => setBulkAction(null)}
        />
      )}
    </ConnectGate>
  )
}

// ── LockListView ──────────────────────────────────────────────────────────────

function LockListView({
  locks,
  loading,
  error,
  onRetry,
  tab,
  hasFilters,
  selectable,
  selectedIds,
  onSelect,
  viewMode,
}: {
  locks: Lock[]
  loading: boolean
  error: string | null
  onRetry: () => void
  tab: Tab
  hasFilters: boolean
  selectable: boolean
  selectedIds: Set<string>
  onSelect: (id: string, checked: boolean) => void
  viewMode: ViewMode
}) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonLockCard key={i} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-10 rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">{t("myLocks.failedToLoad")}</p>
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          {t("common.tryAgain")}
        </Button>
      </div>
    )
  }

  if (locks.length === 0) {
    return (
      <div className="mt-10 rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Wallet className="h-6 w-6" />
        </span>
        <h3 className="mt-4 text-lg font-semibold">
          {hasFilters
            ? "No locks match your filters"
            : tab === "created"
              ? t("myLocks.noLocksCreated")
              : t("myLocks.noBeneficiary")}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {hasFilters
            ? "Try adjusting your search or filters."
            : tab === "created"
              ? t("myLocks.noLocksCreatedDesc")
              : t("myLocks.noBeneficiaryDesc")}
        </p>
        {!hasFilters && tab === "created" && (
          <Link to="/app/create">
            <Button className="mt-6">
              <Plus className="h-4 w-4" />
              {t("myLocks.createLock")}
            </Button>
          </Link>
        )}
      </div>
    )
  }

  if (viewMode === "table") {
    return (
      <div className="mt-6">
        <LockTable locks={locks} selectable={selectable} selectedIds={selectedIds} onSelect={onSelect} />
      </div>
    )
  }

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      {locks.map((lock) => (
        <LockCard
          key={lock.id}
          lock={lock}
          selectable={selectable}
          selected={selectedIds.has(lock.id)}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
