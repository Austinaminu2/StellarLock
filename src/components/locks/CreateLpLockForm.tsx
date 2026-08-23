import { useMemo, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Droplets, Info, Loader2, ChevronDown, ChevronUp } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk"
import type { Dex } from "@/types/lock"
import { Input, Label } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { TxProgressSteps } from "@/components/ui/TxProgressSteps"
import { cn, formatDate, notify } from "@/lib/utils"
import { isValidStellarAddress } from "@/lib/stellar-address"
import { validateLpLockForm, type FieldKey } from "@/lib/validation/lockFormValidation"
import { FormValidationErrors } from "@/components/locks/FormValidationErrors"
import { sanitizeError } from "@/lib/error-sanitizer"
import type { StructuredError } from "@/lib/errors"
import { TxErrorAlert } from "@/components/ui/TxErrorAlert"
import { useAnnouncer } from "@/hooks/useAnnouncer"
import { useWallet } from "@/hooks/useWallet"
import { useTokenBalance, useTokenAllowance } from "@/hooks/useLocks"
import { createLpLock, submitTokenApproval } from "@/lib/lp-locker"
import { CONTRACTS, type TxPhase } from "@/lib/stellar"
import { trackEvent } from "@/lib/analytics"
import { addTransaction } from "@/lib/transaction-history"
import { ConfirmLockModal } from "@/components/locks/ConfirmLockModal"
import { CostEstimate } from "@/components/locks/CostEstimate"
import { AddressBookModal } from "@/components/ui/AddressBookModal"
import { BookUser } from "lucide-react"
import { createLogger } from "@/lib/logger"
import { useDraftAutoSave } from "@/hooks/useDraftStorage"
import { addNotification } from "@/hooks/useNotifications"

const log = createLogger("CreateLpLockForm")

const DAY = 86_400_000

export function CreateLpLockForm() {
  const { t } = useTranslation()
  const { announce } = useAnnouncer()
  const { address, signTransaction } = useWallet()
  const navigate = useNavigate()

  const [dex, setDex] = useState<Dex>("aquarius")
  const [poolShareAddress, setPoolShareAddress] = useState("")
  const [tokenA, setTokenA] = useState("")
  const [tokenB, setTokenB] = useState("")
  const [amount, setAmount] = useState("")
  const [unlockDate, setUnlockDate] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [txPhase, setTxPhase] = useState<TxPhase | "idle">("idle")
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<StructuredError | null>(null)
  const [metaOpen, setMetaOpen] = useState(false)
  const [description, setDescription] = useState("")
  const [projectUrl, setProjectUrl] = useState("")
  const [logoUrl, setLogoUrl] = useState("")
  const [beneficiaryOverride, setBeneficiaryOverride] = useState("")
  const [addressBookOpen, setAddressBookOpen] = useState(false)

  useDraftAutoSave("lp", {
    poolShareAddress,
    tokenA,
    tokenB,
    amount,
    unlockDate,
  })

  const dexes: { value: Dex; label: string; desc: string }[] = [
    { value: "aquarius", label: t("lpForm.aquarius"), desc: t("lpForm.aquariusDesc") },
    { value: "soroswap", label: t("lpForm.soroswap"), desc: t("lpForm.soroswapDesc") },
  ]

  const presets = [
    { label: t("lpForm.days90"), days: 90 },
    { label: t("lpForm.months6"), days: 182 },
    { label: t("lpForm.year1"), days: 365 },
    { label: t("lpForm.years2"), days: 730 },
  ]

  const minDate = useMemo(() => new Date(Date.now() + DAY).toISOString().slice(0, 10), [])
  const unlockTs = unlockDate ? new Date(unlockDate).getTime() : 0
  const trimmedPoolShareAddress = poolShareAddress.trim()
  const trimmedTokenA = tokenA.trim()
  const trimmedTokenB = tokenB.trim()

  // Single source of truth for this form's validity — the same module backs
  // CreateTokenLockForm, so the two forms can't drift apart. Memoized because
  // FormValidationErrors keys its screen-reader announcement off the result.
  //
  // `allowance` is deliberately not passed: a low allowance is recoverable from
  // the confirm modal's Approve button, so it must not block reaching it.
  const validation = useMemo(
    () =>
      validateLpLockForm({
        poolShareAddress,
        tokenA,
        tokenB,
        amount,
        unlockDate,
        walletAddress: address ?? null,
      }),
    [poolShareAddress, tokenA, tokenB, amount, unlockDate, address],
  )
  const valid = validation.isValid
  const hasIssue = (field: FieldKey) => validation.issues.some((it) => it.field === field)

  // Surface an issue only once the user has entered something for that field,
  // so a pristine form doesn't greet them with a wall of red. The beneficiary
  // issue is wallet-derived rather than typed, so it always shows.
  const visibleIssues = useMemo(() => {
    const touched = new Set<FieldKey>(["beneficiary"])
    if (poolShareAddress.trim()) touched.add("poolShareAddress")
    if (tokenA.trim()) touched.add("tokenA")
    if (tokenB.trim()) touched.add("tokenB")
    if (amount.trim()) touched.add("amount")
    if (unlockDate) touched.add("unlockDate")
    return validation.issues.filter((it) => touched.has(it.field))
  }, [validation, poolShareAddress, tokenA, tokenB, amount, unlockDate])

  const validPoolShareAddress = hasIssue("poolShareAddress") ? undefined : trimmedPoolShareAddress
  const { data: balance, loading: balanceLoading } = useTokenBalance(validPoolShareAddress, address ?? null)
  const { data: allowance, loading: allowanceLoading } = useTokenAllowance(
    validPoolShareAddress,
    address ?? null,
    CONTRACTS.lpLocker,
  )
  // Build the contract args for cost estimation when form is sufficiently filled in
  const costArgs = useMemo((): xdr.ScVal[] | null => {
    try {
      if (
        !address ||
        poolShareAddress.trim().length <= 4 ||
        tokenA.trim().length <= 4 ||
        tokenB.trim().length <= 4 ||
        Number(amount) <= 0 ||
        unlockTs <= Date.now()
      ) {
        return null
      }
      const amountStroops = BigInt(Math.round(Number(amount) * 1e7))
      const dexScVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(dex === "aquarius" ? "Aquarius" : "Soroswap")])
      return [
        new Address(address).toScVal(),
        new Address(poolShareAddress.trim()).toScVal(),
        dexScVal,
        new Address(tokenA.trim()).toScVal(),
        new Address(tokenB.trim()).toScVal(),
        nativeToScVal(amountStroops, { type: "i128" }),
        new Address(address).toScVal(),
        nativeToScVal(BigInt(Math.floor(unlockTs / 1000)), { type: "u64" }),
      ]
    } catch {
      return null
    }
  }, [address, dex, poolShareAddress, tokenA, tokenB, amount, unlockTs])

  function applyPreset(days: number) {
    setUnlockDate(new Date(Date.now() + days * DAY).toISOString().slice(0, 10))
  }

  // Sanitize before display so raw RPC/Soroban text never reaches the UI, and
  // announce the failure for screen readers.
  function reportFailure(err: unknown) {
    const structured = sanitizeError(err)
    setError(structured)
    announce(`${t(structured.title)}. ${t(structured.message)}`, "assertive")
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setError(null)
    setShowConfirm(true)
  }

  async function confirmLock() {
    setSubmitting(true)
    setTxPhase("simulating")
    try {
      const { id, txHash } = await createLpLock(
        {
          poolShareAddress: poolShareAddress.trim(),
          dex,
          tokenA: tokenA.trim(),
          tokenB: tokenB.trim(),
          amount: Number(amount),
          beneficiary: address!,
          unlockAt: Math.floor(unlockTs / 1000),
          metadata: {
            description: description.trim(),
            projectUrl: projectUrl.trim(),
            logoUrl: logoUrl.trim(),
          },
        },
        address!,
        signTransaction,
        setTxPhase,
      )
      addTransaction(txHash, "create_lock", { lockId: id, amount: String(amount) })
      trackEvent("lock_create_lp", { dex })
      notify.lockCreated()
      addNotification({
        type: "lock_created",
        lockId: id,
        lockKind: "lp",
        title: t("notifications.center.lockCreatedTitle"),
        message: t("notifications.center.lockCreatedMessage", { id, date: formatDate(unlockTs) }),
      })
      void navigate(`/app/lock/${id}`)
    } catch (err: unknown) {
      log.error("[createLpLock error]", err)
      setShowConfirm(false)
      reportFailure(err)
    } finally {
      setSubmitting(false)
      setTxPhase("idle")
    }
  }

  async function handleApprove() {
    setApproving(true)
    try {
      await submitTokenApproval(
        poolShareAddress.trim(),
        address!,
        CONTRACTS.lpLocker,
        Number(amount),
        address!,
        signTransaction,
      )
      trackEvent("token_approve")
    } catch (err: unknown) {
      log.error("[approve error]", err)
      reportFailure(err)
    } finally {
      setApproving(false)
    }
  }

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">{t("lpForm.dex")}</legend>
          <div role="radiogroup" aria-label={t("lpForm.dex")} className="grid grid-cols-2 gap-3">
            {dexes.map((d) => (
              <button
                type="button"
                key={d.value}
                role="radio"
                aria-checked={dex === d.value}
                onClick={() => setDex(d.value)}
                className={cn(
                  "flex flex-col items-start rounded-lg border p-3 text-start transition-colors cursor-pointer",
                  dex === d.value
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background/40 hover:border-primary/40",
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <span
                    aria-hidden="true"
                    className={cn("h-2 w-2 rounded-full", d.value === "aquarius" ? "bg-primary" : "bg-warning")}
                  />
                  {d.label}
                </span>
                <span className="text-xs text-muted-foreground">{d.desc}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-2">
          <Label htmlFor="pool">{t("lpForm.poolAddress")}</Label>
          <Input
            id="pool"
            placeholder={t("lpForm.poolPlaceholder")}
            value={poolShareAddress}
            onChange={(e) => setPoolShareAddress(e.target.value)}
            className="font-mono"
            aria-invalid={!!trimmedPoolShareAddress && hasIssue("poolShareAddress")}
          />
          <p className="text-xs text-muted-foreground">
            {t("lpForm.poolHint", { dex: dex === "aquarius" ? t("lpForm.aquarius") : t("lpForm.soroswap") })}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="token-a">{t("lpForm.tokenA")}</Label>
            <Input
              id="token-a"
              placeholder="C…"
              value={tokenA}
              onChange={(e) => setTokenA(e.target.value)}
              className="font-mono"
              aria-invalid={!!trimmedTokenA && hasIssue("tokenA")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="token-b">{t("lpForm.tokenB")}</Label>
            <Input
              id="token-b"
              placeholder="C…"
              value={tokenB}
              onChange={(e) => setTokenB(e.target.value)}
              className="font-mono"
              aria-invalid={!!trimmedTokenB && hasIssue("tokenB")}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="lp-amount">{t("lpForm.amount")}</Label>
          <div className="flex gap-2">
            <Input
              id="lp-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1"
            />
            {validPoolShareAddress && balance != null && balance > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(balance))}
                className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-medium transition-colors hover:border-primary/40 cursor-pointer"
              >
                Max
              </button>
            )}
          </div>
          {validPoolShareAddress && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {balanceLoading || allowanceLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : balance != null ? (
                <>Balance: {balance.toLocaleString(undefined, { maximumFractionDigits: 7 })}</>
              ) : null}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="lp-beneficiary">
              Beneficiary <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <button
              type="button"
              onClick={() => setAddressBookOpen(true)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              title="Open address book"
            >
              <BookUser className="h-3.5 w-3.5" />
              Address Book
            </button>
          </div>
          <Input
            id="lp-beneficiary"
            placeholder={address ?? "G… — defaults to your wallet"}
            value={beneficiaryOverride}
            onChange={(e) => setBeneficiaryOverride(e.target.value)}
            className={beneficiaryOverride && !isValidStellarAddress(beneficiaryOverride) ? "border-destructive" : ""}
          />
          <p className="text-xs text-muted-foreground">Leave blank to use your connected wallet as beneficiary.</p>
        </div>
        {addressBookOpen && (
          <AddressBookModal
            onSelect={(entry) => setBeneficiaryOverride(entry.address)}
            onClose={() => setAddressBookOpen(false)}
          />
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="lp-unlock">{t("lpForm.unlockDate")}</Label>
          <Input
            id="lp-unlock"
            type="date"
            min={minDate}
            value={unlockDate}
            onChange={(e) => setUnlockDate(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => applyPreset(p.days)}
                className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium transition-colors hover:border-primary/40 cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Lock Details (optional metadata) */}
        <div className="rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setMetaOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium transition-colors hover:bg-secondary/40"
            aria-expanded={metaOpen}
          >
            <span>
              Lock Details <span className="ms-1 text-xs font-normal text-muted-foreground">(optional)</span>
            </span>
            {metaOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {metaOpen && (
            <div className="flex flex-col gap-4 border-t border-border px-4 pb-4 pt-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lp-meta-desc">Description</Label>
                <textarea
                  id="lp-meta-desc"
                  rows={3}
                  maxLength={280}
                  placeholder="Why is this lock being created? (e.g. Liquidity locked for 2 years)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-end text-xs text-muted-foreground">{description.length}/280</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lp-meta-url">Project URL</Label>
                <Input
                  id="lp-meta-url"
                  type="url"
                  placeholder="https://your-project.com"
                  value={projectUrl}
                  onChange={(e) => setProjectUrl(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lp-meta-logo">Logo URL</Label>
                <Input
                  id="lp-meta-logo"
                  type="url"
                  placeholder="https://your-project.com/logo.png"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            {t("lpForm.lockInfo")}
            {unlockTs > Date.now() && (
              <>
                {" "}
                <Trans i18nKey="lpForm.liquidityUnlockOn" values={{ date: formatDate(unlockTs) }}>
                  Liquidity unlocks on{" "}
                  <span className="font-medium text-foreground">
                    {{ date: formatDate(unlockTs) } as unknown as string}
                  </span>
                  .
                </Trans>
              </>
            )}
          </span>
        </div>

        <TxErrorAlert error={error} />

        <CostEstimate contractId={CONTRACTS.lpLocker} method="create_lock" args={costArgs} />

        <FormValidationErrors issues={visibleIssues} />

        <Button type="submit" size="lg" loading={submitting} disabled={!valid}>
          <Droplets className="h-4 w-4" />
          {t("lpForm.submit")}
        </Button>
      </form>

      {showConfirm && (
        <>
          <ConfirmLockModal
            data={{
              tokenAddress: poolShareAddress.trim(),
              amount: amount,
              beneficiary: address!,
              unlockDate: unlockDate,
              isLp: true,
              dex: dex,
              poolShareAddress: poolShareAddress.trim(),
              balance,
              allowance,
              needsApproval: allowance != null && allowance < Number(amount),
            }}
            onConfirm={() => void confirmLock()}
            onApprove={() => void handleApprove()}
            onCancel={() => setShowConfirm(false)}
            loading={submitting}
            approving={approving}
          />
          <div className="fixed bottom-6 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 px-4">
            <TxProgressSteps phase={txPhase} />
          </div>
        </>
      )}
    </>
  )
}
