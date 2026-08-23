import { useMemo, useState, useEffect, useRef, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Lock, Info, Loader2, Calendar, ChevronDown, ChevronUp, Users, Timer, BookUser } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk"
import { Input, Label } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { TxProgressSteps } from "@/components/ui/TxProgressSteps"
import { useWallet } from "@/hooks/useWallet"
import { useTokenAllowance } from "@/hooks/useLocks"
import { useTokenBalanceSWR } from "@/hooks/useTokenBalanceSWR"
import { createTokenLock } from "@/lib/token-locker"
import { createSplitLock, type SplitBeneficiary } from "@/lib/split-lock"
import { trackEvent } from "@/lib/analytics"
import { addTransaction } from "@/lib/transaction-history"
import { cn, formatDate, notify } from "@/lib/utils"
import { validateTokenLockForm, type FieldKey } from "@/lib/validation/lockFormValidation"
import { FormValidationErrors } from "@/components/locks/FormValidationErrors"
import { sanitizeError } from "@/lib/error-sanitizer"
import type { StructuredError } from "@/lib/errors"
import { TxErrorAlert } from "@/components/ui/TxErrorAlert"
import { useAnnouncer } from "@/hooks/useAnnouncer"
import { CONTRACTS, type TxPhase, submitTokenApproval } from "@/lib/stellar"
import { ConfirmLockModal } from "@/components/locks/ConfirmLockModal"
import { CostEstimate } from "@/components/locks/CostEstimate"
import { MultiBeneficiaryFields } from "@/components/locks/MultiBeneficiaryFields"
import { AddressBookModal } from "@/components/ui/AddressBookModal"
import { createLogger } from "@/lib/logger"
import { useDraftAutoSave } from "@/hooks/useDraftStorage"
import { addNotification } from "@/hooks/useNotifications"

const log = createLogger("CreateTokenLockForm")

const DAY = 86_400_000

type VestingTemplate = "none" | "linear6m" | "linear1y" | "linear2y" | "quarterly"

interface VestingTemplateConfig {
  label: string
  durationMonths?: number
  releases?: number
}

export function CreateTokenLockForm() {
  const { t } = useTranslation()
  const { announce } = useAnnouncer()
  const { address, signTransaction } = useWallet()
  const navigate = useNavigate()

  const [tokenAddress, setTokenAddress] = useState("")
  const [amount, setAmount] = useState("")
  const [beneficiary, setBeneficiary] = useState("")
  const [unlockDate, setUnlockDate] = useState("")
  const [vesting, setVesting] = useState(false)
  const [vestingTemplate, setVestingTemplate] = useState<VestingTemplate>("none")
  const [vestingStartDate, setVestingStartDate] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [txPhase, setTxPhase] = useState<TxPhase | "idle">("idle")
  const [error, setError] = useState<StructuredError | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)
  const [description, setDescription] = useState("")
  const [projectUrl, setProjectUrl] = useState("")
  const [logoUrl, setLogoUrl] = useState("")
  const [multiMode, setMultiMode] = useState(false)
  const [splitBeneficiaries, setSplitBeneficiaries] = useState<SplitBeneficiary[]>([
    { address: "", shareBps: 5000 },
    { address: "", shareBps: 5000 },
  ])
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Last unlock date the user chose themselves (typed or via a preset button), as
  // opposed to one auto-filled by a vesting template. Restored when they switch the
  // template dropdown back to "Custom" so their own choice isn't silently wiped.
  const userUnlockDateRef = useRef("")
  const [addressBookOpen, setAddressBookOpen] = useState(false)

  const COOLDOWN_SECONDS = 60
  const COOLDOWN_KEY = "stellarlock:last_lock_created_at"
  // Namespaced per wallet — a global key would leak wallet A's cooldown onto
  // wallet B after a browser-local wallet switch.
  const cooldownKey = address ? `${COOLDOWN_KEY}:${address}` : null

  useDraftAutoSave("token", {
    tokenAddress,
    amount,
    beneficiary,
    unlockDate,
  })

  useEffect(() => {
    if (!cooldownKey) {
      setCooldownRemaining(0)
      return
    }
    const stored = localStorage.getItem(cooldownKey)
    if (stored) {
      const elapsed = Math.floor((Date.now() - Number(stored)) / 1000)
      const remaining = COOLDOWN_SECONDS - elapsed
      setCooldownRemaining(remaining > 0 ? remaining : 0)
    } else {
      setCooldownRemaining(0)
    }
  }, [cooldownKey])

  useEffect(() => {
    if (cooldownRemaining <= 0) {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
      return
    }
    cooldownRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [cooldownRemaining])

  const vestingTemplates: Record<VestingTemplate, VestingTemplateConfig> = {
    none: { label: t("tokenForm.vestingTemplateCustom") },
    linear6m: { label: t("tokenForm.vestingTemplateLinear6m"), durationMonths: 6 },
    linear1y: { label: t("tokenForm.vestingTemplateLinear1y"), durationMonths: 12 },
    linear2y: { label: t("tokenForm.vestingTemplateLinear2y"), durationMonths: 24 },
    quarterly: { label: t("tokenForm.vestingTemplateQuarterly"), durationMonths: 12, releases: 4 },
  }

  const trimmedTokenAddress = tokenAddress.trim()
  const trimmedBeneficiary = beneficiary.trim()

  // Single source of truth for this form's validity — the same module backs
  // CreateLpLockForm, so the two forms can't drift apart. Memoized because
  // FormValidationErrors keys its screen-reader announcement off the result.
  //
  // `allowance` is deliberately not passed: a low allowance is recoverable from
  // the confirm modal's Approve button, so it must not block reaching it.
  const validation = useMemo(
    () =>
      validateTokenLockForm({
        tokenAddress,
        amount,
        beneficiary,
        walletAddress: address ?? null,
        unlockDate,
        multiMode,
        splitBeneficiaries,
      }),
    [tokenAddress, amount, beneficiary, address, unlockDate, multiMode, splitBeneficiaries],
  )
  const valid = validation.isValid
  const hasIssue = (field: FieldKey) => validation.issues.some((it) => it.field === field)

  // Surface an issue only once the user has entered something for that field,
  // so a pristine form doesn't greet them with a wall of red.
  const visibleIssues = useMemo(() => {
    const touched = new Set<FieldKey>()
    if (tokenAddress.trim()) touched.add("tokenAddress")
    if (amount.trim()) touched.add("amount")
    if (beneficiary.trim()) touched.add("beneficiary")
    if (unlockDate) touched.add("unlockDate")
    if (multiMode && splitBeneficiaries.some((b) => b.address.trim())) touched.add("splitBeneficiaries")
    return validation.issues.filter((it) => touched.has(it.field))
  }, [validation, tokenAddress, amount, beneficiary, unlockDate, multiMode, splitBeneficiaries])

  const validTokenAddress = hasIssue("tokenAddress") ? undefined : trimmedTokenAddress
  const {
    balance: balanceStroops,
    isLoading: balanceLoading,
    isRevalidating: balanceRevalidating,
  } = useTokenBalanceSWR(validTokenAddress, address ?? null)
  // Convert stroops (bigint) to a human-readable float for display/validation.
  // While revalidating we keep the stale value visible — that's the SWR benefit.
  const balance = balanceStroops !== null ? Number(balanceStroops) / 1e7 : null
  const { data: allowance, loading: allowanceLoading } = useTokenAllowance(
    validTokenAddress,
    address ?? null,
    CONTRACTS.tokenLocker,
  )

  const presets = [
    { label: t("tokenForm.days30"), days: 30 },
    { label: t("tokenForm.days90"), days: 90 },
    { label: t("tokenForm.months6"), days: 182 },
    { label: t("tokenForm.year1"), days: 365 },
  ]

  const minDate = useMemo(() => new Date(Date.now() + DAY).toISOString().slice(0, 10), [])
  const unlockTs = unlockDate ? new Date(unlockDate).getTime() : 0
  const vestingStartTs = vestingStartDate ? new Date(vestingStartDate).getTime() : 0

  // Build the contract args for cost estimation when form is sufficiently filled in
  const costArgs = useMemo((): xdr.ScVal[] | null => {
    try {
      if (!validTokenAddress || !address || Number(amount) <= 0 || unlockTs <= Date.now()) return null
      const beneficiaryAddr = beneficiary.trim().length > 0 ? beneficiary.trim() : address
      const amountStroops = BigInt(Math.round(Number(amount) * 1e7))
      const args: xdr.ScVal[] = [
        new Address(address).toScVal(),
        new Address(validTokenAddress).toScVal(),
        nativeToScVal(amountStroops, { type: "i128" }),
        new Address(beneficiaryAddr).toScVal(),
        nativeToScVal(BigInt(Math.floor(unlockTs / 1000)), { type: "u64" }),
      ]
      if (vesting) {
        args.push(
          xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("end"),
              val: nativeToScVal(BigInt(Math.floor(unlockTs / 1000)), { type: "u64" }),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("released"),
              val: nativeToScVal(BigInt(0), { type: "i128" }),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("start"),
              val: nativeToScVal(BigInt(Math.floor(Date.now() / 1000)), { type: "u64" }),
            }),
          ]),
        )
      } else {
        args.push(xdr.ScVal.scvVoid())
      }
      return args
    } catch {
      return null
    }
  }, [validTokenAddress, address, amount, beneficiary, unlockTs, vesting])

  function applyPreset(days: number) {
    const date = new Date(Date.now() + days * DAY).toISOString().slice(0, 10)
    userUnlockDateRef.current = date
    setUnlockDate(date)
  }

  function applyVestingTemplate(template: VestingTemplate) {
    setVestingTemplate(template)
    if (template === "none") {
      setVesting(false)
      setVestingStartDate("")
      // Hand the user back their own unlock date rather than clearing the field —
      // only the template-derived value is discarded.
      setUnlockDate(userUnlockDateRef.current)
    } else {
      setVesting(true)
      const config = vestingTemplates[template]
      const now = new Date()
      const startDate = now.toISOString().slice(0, 10)
      setVestingStartDate(startDate)

      if (config.durationMonths) {
        const endDate = new Date(now.getTime() + config.durationMonths * 30 * DAY)
        setUnlockDate(endDate.toISOString().slice(0, 10))
      }
    }
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
      if (multiMode) {
        const { txHash } = await createSplitLock(
          {
            tokenAddress: tokenAddress.trim(),
            totalAmount: Number(amount),
            beneficiaries: splitBeneficiaries,
            unlockAt: Math.floor(unlockTs / 1000),
            vesting: vesting ? { start: Math.floor(Date.now() / 1000), end: Math.floor(unlockTs / 1000) } : undefined,
          },
          address!,
          signTransaction,
        )
        addTransaction(txHash, "split_lock", { amount: String(amount) })
        trackEvent("lock_create_split", { count: splitBeneficiaries.length, vesting })
        notify.lockCreated()
        // A split lock has no single id to link to, so the entry is history-only.
        addNotification({
          type: "lock_created",
          lockId: "",
          lockKind: "token",
          title: t("notifications.center.splitLockCreatedTitle"),
          message: t("notifications.center.splitLockCreatedMessage", { count: splitBeneficiaries.length }),
        })
        localStorage.setItem(COOLDOWN_KEY, String(Date.now()))
        localStorage.setItem(cooldownKey!, String(Date.now()))
        setCooldownRemaining(COOLDOWN_SECONDS)
        void navigate("/app/locks")
      } else {
        const { id, txHash } = await createTokenLock(
          {
            tokenAddress: tokenAddress.trim(),
            amount: Number(amount),
            beneficiary: beneficiary.trim() || address!,
            unlockAt: Math.floor(unlockTs / 1000),
            vesting: vesting ? { start: Math.floor(Date.now() / 1000), end: Math.floor(unlockTs / 1000) } : undefined,
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
        trackEvent("lock_create_token", { vesting })
        notify.lockCreated()
        addNotification({
          type: "lock_created",
          lockId: id,
          lockKind: "token",
          title: t("notifications.center.lockCreatedTitle"),
          message: t("notifications.center.lockCreatedMessage", { id, date: formatDate(unlockTs) }),
        })
        localStorage.setItem(COOLDOWN_KEY, String(Date.now()))
        localStorage.setItem(cooldownKey!, String(Date.now()))
        setCooldownRemaining(COOLDOWN_SECONDS)
        void navigate("/app/lock-created", {
          state: {
            lockId: id,
            lockKind: "token",
            txHash,
            tokenAddress: tokenAddress.trim(),
            amount,
            beneficiary: beneficiary.trim() || address!,
            creator: address!,
            unlockAt: unlockTs,
            vesting,
            timestamp: Date.now(),
          },
        })
      }
    } catch (err: unknown) {
      log.error("[createLock error]", err)
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
        tokenAddress.trim(),
        address!,
        CONTRACTS.tokenLocker,
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="token">{t("tokenForm.tokenAddress")}</Label>
          <Input
            id="token"
            placeholder={t("tokenForm.tokenPlaceholder")}
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            className="font-mono"
            aria-invalid={!!trimmedTokenAddress && hasIssue("tokenAddress")}
          />
          <p className="text-xs text-muted-foreground">{t("tokenForm.tokenHint")}</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="amount">{t("tokenForm.amount")}</Label>
            {validTokenAddress && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {balanceLoading || allowanceLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : balance != null ? (
                  <>
                    {t("tokenForm.balance")}: {balance.toLocaleString(undefined, { maximumFractionDigits: 7 })}
                    {balanceRevalidating && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
                  </>
                ) : null}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              id="amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1"
            />
            {balance != null && balance > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(balance))}
                className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-medium transition-colors hover:border-primary/40 cursor-pointer"
              >
                {t("tokenForm.max")}
              </button>
            )}
          </div>
        </div>

        {/* Multiple beneficiaries toggle */}
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
            multiMode ? "border-primary/40 bg-primary/5" : "border-border bg-background/40",
          )}
        >
          <input
            type="checkbox"
            checked={multiMode}
            onChange={(e) => setMultiMode(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[oklch(0.78_0.16_175)]"
          />
          <span className="text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <Users className="h-3.5 w-3.5" />
              {t("splitLock.toggle")}
            </span>
            <span className="block text-muted-foreground">{t("splitLock.toggleDesc")}</span>
          </span>
        </label>

        {multiMode ? (
          <MultiBeneficiaryFields beneficiaries={splitBeneficiaries} onChange={setSplitBeneficiaries} />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="beneficiary">{t("tokenForm.beneficiary")}</Label>
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
              id="beneficiary"
              placeholder={address ?? "G…"}
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              aria-invalid={!!trimmedBeneficiary && hasIssue("beneficiary")}
            />
            <p className="text-xs text-muted-foreground">{t("tokenForm.beneficiaryHint")}</p>
          </div>
        )}
        {addressBookOpen && (
          <AddressBookModal
            onSelect={(entry) => setBeneficiary(entry.address)}
            onClose={() => setAddressBookOpen(false)}
          />
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="unlock">{t("tokenForm.unlockDate")}</Label>
          <Input
            id="unlock"
            type="date"
            min={minDate}
            value={unlockDate}
            onChange={(e) => {
              userUnlockDateRef.current = e.target.value
              setUnlockDate(e.target.value)
            }}
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="vestingTemplate">{t("tokenForm.vestingTemplate")}</Label>
          <select
            id="vestingTemplate"
            value={vestingTemplate}
            onChange={(e) => applyVestingTemplate(e.target.value as VestingTemplate)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-border/80"
          >
            <option value="none">{t("tokenForm.vestingTemplateCustom")}</option>
            <option value="linear6m">{t("tokenForm.vestingTemplateLinear6m")}</option>
            <option value="linear1y">{t("tokenForm.vestingTemplateLinear1y")}</option>
            <option value="linear2y">{t("tokenForm.vestingTemplateLinear2y")}</option>
            <option value="quarterly">{t("tokenForm.vestingTemplateQuarterly")}</option>
          </select>
          <p className="text-xs text-muted-foreground">{t("tokenForm.vestingTemplateHint")}</p>
        </div>

        {vesting && vestingTemplate !== "none" && (
          <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{t("tokenForm.vestingLabel")}</span>
            </div>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">{t("tokenForm.vestingStart")}: </span>
                <span className="font-medium">{vestingStartDate || formatDate(Date.now())}</span>
              </p>
              <p>
                <span className="text-muted-foreground">{t("tokenForm.vestingEnd")}: </span>
                <span className="font-medium">{unlockDate ? formatDate(new Date(unlockDate).getTime()) : "—"}</span>
              </p>
              {vestingTemplate === "quarterly" && (
                <div className="mt-2 space-y-1 border-t border-primary/20 pt-2">
                  <p className="text-xs text-muted-foreground">Release schedule:</p>
                  <div className="flex gap-2 text-xs">
                    {[1, 2, 3, 4].map((quarter) => {
                      const startTs = vestingStartTs || Date.now()
                      const endTs = unlockTs || Date.now()
                      const quarterDuration = (endTs - startTs) / 4
                      const releaseDate = new Date(startTs + quarterDuration * quarter)
                      return (
                        <span key={quarter} className="rounded bg-primary/10 px-2 py-1">
                          Q{quarter}: {formatDate(releaseDate.getTime())}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {vesting && vestingTemplate === "none" && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background/40 p-3">
            <input
              type="checkbox"
              checked={vesting}
              onChange={(e) => setVesting(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[oklch(0.78_0.16_175)]"
            />
            <span className="text-sm">
              <span className="font-medium">{t("tokenForm.vestingLabel")}</span>
              <span className="block text-muted-foreground">{t("tokenForm.vestingDesc")}</span>
            </span>
          </label>
        )}

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
                <Label htmlFor="meta-desc">Description</Label>
                <textarea
                  id="meta-desc"
                  rows={3}
                  maxLength={280}
                  placeholder="Why is this lock being created? (e.g. Team tokens locked for 2 years)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-end text-xs text-muted-foreground">{description.length}/280</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="meta-url">Project URL</Label>
                <Input
                  id="meta-url"
                  type="url"
                  placeholder="https://your-project.com"
                  value={projectUrl}
                  onChange={(e) => setProjectUrl(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="meta-logo">Logo URL</Label>
                <Input
                  id="meta-logo"
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
            {t("tokenForm.lockInfo")}
            {unlockTs > Date.now() && (
              <>
                {" "}
                <Trans i18nKey="tokenForm.fundsUnlockOn" values={{ date: formatDate(unlockTs) }}>
                  Funds unlock on{" "}
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

        <CostEstimate contractId={CONTRACTS.tokenLocker} method="create_lock" args={costArgs} />

        <FormValidationErrors issues={visibleIssues} />

        {cooldownRemaining > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
            <Timer className="h-4 w-4 shrink-0 text-primary animate-pulse" />
            <span>
              Rate limit: next lock available in{" "}
              <span className="font-semibold tabular-nums text-foreground">{cooldownRemaining}s</span>
            </span>
          </div>
        )}

        <Button type="submit" size="lg" loading={submitting} disabled={!valid || cooldownRemaining > 0}>
          <Lock className="h-4 w-4" />
          {cooldownRemaining > 0
            ? `Wait ${cooldownRemaining}s…`
            : multiMode
              ? t("splitLock.submit")
              : t("tokenForm.submit")}
        </Button>
      </form>

      {showConfirm && (
        <>
          <ConfirmLockModal
            data={{
              tokenAddress: tokenAddress.trim(),
              amount: amount,
              beneficiary: beneficiary.trim() || address!,
              unlockDate: unlockDate,
              vesting,
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
