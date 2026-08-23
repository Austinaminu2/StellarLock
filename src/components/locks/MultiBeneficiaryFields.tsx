import { Plus, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Input, Label } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { isValidStellarAddress } from "@/lib/stellar-address"
import type { SplitBeneficiary } from "@/lib/split-lock"

const MAX_BENEFICIARIES = 10

interface Props {
  beneficiaries: SplitBeneficiary[]
  onChange: (next: SplitBeneficiary[]) => void
}

export function MultiBeneficiaryFields({ beneficiaries, onChange }: Props) {
  const { t } = useTranslation()
  const totalBps = beneficiaries.reduce((s, b) => s + b.shareBps, 0)
  const totalPct = +(totalBps / 100).toFixed(2)
  const isValid = totalBps === 10_000 && beneficiaries.length >= 2

  function update(index: number, patch: Partial<SplitBeneficiary>) {
    onChange(beneficiaries.map((b, i) => (i === index ? { ...b, ...patch } : b)))
  }

  function add() {
    if (beneficiaries.length >= MAX_BENEFICIARIES) return
    onChange([...beneficiaries, { address: "", shareBps: 0 }])
  }

  function remove(index: number) {
    onChange(beneficiaries.filter((_, i) => i !== index))
  }

  function handleShare(index: number, raw: string) {
    const pct = parseFloat(raw)
    if (isNaN(pct)) return
    update(index, { shareBps: Math.round(Math.min(100, Math.max(0, pct)) * 100) })
  }

  return (
    <div className="flex flex-col gap-3">
      {beneficiaries.map((b, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            {i === 0 && <Label htmlFor={`mb-addr-${i}`}>{t("splitLock.addressLabel")}</Label>}
            <Input
              id={`mb-addr-${i}`}
              placeholder="G…"
              value={b.address}
              onChange={(e) => update(i, { address: e.target.value })}
              className={`font-mono text-xs ${b.address && !isValidStellarAddress(b.address) ? "border-destructive" : ""}`}
            />
          </div>
          <div className="flex w-24 flex-col gap-1 shrink-0">
            {i === 0 && <Label htmlFor={`mb-share-${i}`}>{t("splitLock.shareLabel")}</Label>}
            <Input
              id={`mb-share-${i}`}
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.01"
              placeholder="0"
              value={b.shareBps > 0 ? b.shareBps / 100 : ""}
              onChange={(e) => handleShare(i, e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={beneficiaries.length <= 2}
            aria-label={t("splitLock.removeBeneficiary")}
            className="mb-[1px] flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {/* Total row */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t("splitLock.totalShare")}</span>
        <span className={`font-semibold tabular-nums ${isValid ? "text-success" : "text-destructive"}`}>
          {totalPct}%
        </span>
      </div>

      {!isValid && beneficiaries.length >= 2 && (
        <p className="text-xs text-destructive">{t("splitLock.totalShareError")}</p>
      )}
      {beneficiaries.length < 2 && <p className="text-xs text-muted-foreground">{t("splitLock.minBeneficiaries")}</p>}

      {beneficiaries.length < MAX_BENEFICIARIES && (
        <Button type="button" variant="outline" size="sm" onClick={add} className="self-start">
          <Plus className="h-3.5 w-3.5" />
          {t("splitLock.addBeneficiary")}
        </Button>
      )}
      {beneficiaries.length >= MAX_BENEFICIARIES && (
        <p className="text-xs text-muted-foreground">{t("splitLock.maxBeneficiaries")}</p>
      )}
    </div>
  )
}
