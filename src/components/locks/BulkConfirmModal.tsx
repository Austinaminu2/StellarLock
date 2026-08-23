import { useRef, useState } from "react"
import { useModalFocusTrap } from "@/lib/modalFocusTrap"
import { X, CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { formatAmount } from "@/lib/utils"
import { isValidStellarAddress } from "@/lib/stellar-address"
import type { Lock } from "@/types/lock"

type Action = "extend" | "transfer"

interface LockResult {
  id: string
  status: "pending" | "success" | "error"
  error?: string
}

type ItemOutcome = Omit<LockResult, "id">

interface Props {
  action: Action
  locks: Lock[]
  onConfirm: (value: string, onItemSettled: (id: string, outcome: ItemOutcome) => void) => Promise<void>
  onClose: () => void
}

export function BulkConfirmModal({ action, locks, onConfirm, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  const [value, setValue] = useState("")

  useModalFocusTrap({
    active: true,
    containerRef,
    initialFocusRef: closeBtnRef,
    onEscape: onClose,
  })
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<LockResult[]>([])
  const done = results.length > 0

  const minDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  const isValid = action === "extend" ? value.length > 0 : isValidStellarAddress(value.trim())

  async function handleConfirm() {
    setRunning(true)
    setResults(locks.map((l) => ({ id: l.id, status: "pending" })))
    await onConfirm(value, (id, outcome) => {
      setResults((prev) => prev.map((r) => (r.id === id ? { id, ...outcome } : r)))
    })
    setRunning(false)
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={!running ? onClose : undefined} />

      <div className="relative z-10 w-full max-w-lg rounded-t-2xl border border-border bg-card p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {action === "extend" ? "Bulk Extend" : "Bulk Transfer"} — {locks.length} lock{locks.length !== 1 && "s"}
          </h2>
          {!running && (
            <button
              ref={closeBtnRef}
              onClick={onClose}
              className="rounded-full p-1 text-muted-foreground hover:bg-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {!done && (
          <>
            <div className="mb-4 max-h-48 overflow-y-auto rounded-lg border border-border">
              {locks.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between border-b border-border px-3 py-2 last:border-b-0 text-sm"
                >
                  <span className="font-medium">
                    #{l.id} {l.token.symbol}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatAmount(l.amount, { compact: true })}
                  </span>
                </div>
              ))}
            </div>

            <div className="mb-4">
              {action === "extend" ? (
                <>
                  <label className="mb-1.5 block text-sm font-medium">New unlock date for all selected locks</label>
                  <Input type="date" min={minDate} value={value} onChange={(e) => setValue(e.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Only locks with a current unlock date earlier than this date will be extended.
                  </p>
                </>
              ) : (
                <>
                  <label className="mb-1.5 block text-sm font-medium">New beneficiary address</label>
                  <Input
                    placeholder="G…"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="font-mono"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Transfer withdrawal rights for all selected locks to this address.
                  </p>
                </>
              )}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} className="flex-1" disabled={running}>
                Cancel
              </Button>
              <Button onClick={() => void handleConfirm()} className="flex-1" loading={running} disabled={!isValid}>
                Confirm {action === "extend" ? "Extension" : "Transfer"}
              </Button>
            </div>
          </>
        )}

        {done && (
          <>
            <div className="mb-4 max-h-64 overflow-y-auto space-y-2">
              {results.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                  {r.status === "pending" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : r.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className="font-medium">Lock #{r.id}</span>
                  {r.error && <span className="ms-auto text-xs text-destructive truncate">{r.error}</span>}
                </div>
              ))}
            </div>
            <Button onClick={onClose} className="w-full">
              Done
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
