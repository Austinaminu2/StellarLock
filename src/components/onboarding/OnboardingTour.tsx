import { useCallback, useEffect, useState } from "react"
import { Wallet, Lock, TrendingUp, Compass, X } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { cn } from "@/lib/utils"
import { START_EVENT } from "./startOnboardingTour"

const STORAGE_KEY = "stellarlock:onboarding_tour_completed"
const AUTO_OPEN_DELAY_MS = 600

interface TourStep {
  icon: typeof Wallet
  title: string
  description: string
}

const STEPS: TourStep[] = [
  {
    icon: Wallet,
    title: "Connect your wallet",
    description:
      "StellarLock works with any Stellar wallet (Freighter, xBull, and more). Click \"Connect Wallet\" in the top-right corner to get started — nothing is stored on our servers, transactions are signed entirely in your wallet.",
  },
  {
    icon: Lock,
    title: "Choose a lock type",
    description:
      "Locking a plain token protects a single asset for a beneficiary. Locking LP (pool-share) tokens protects liquidity you've provided on a DEX like Aquarius or Soroswap. Pick the type that matches what you want to escrow when you create a lock.",
  },
  {
    icon: TrendingUp,
    title: "Understand vesting",
    description:
      "Token locks can optionally vest linearly between a start and end date, releasing a proportional amount over time instead of unlocking everything at once. LP locks always unlock in full on the unlock date — there's no vesting option for pool shares.",
  },
  {
    icon: Compass,
    title: "Find the explorer",
    description:
      "The Explorer page lets anyone look up a token or pool to see its total locked value, active locks, and next unlock date — a quick way to verify a project's locks are real before you trust it.",
  },
]

function hasCompletedTour(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function markTourCompleted() {
  try {
    localStorage.setItem(STORAGE_KEY, "1")
  } catch {
    // Ignore storage errors (private browsing, quota, etc.) — the tour will
    // simply re-offer itself next visit, which is a harmless fallback.
  }
}

/**
 * Lightweight, dependency-free onboarding tour for first-time visitors.
 *
 * Renders as a small floating coach-mark panel (not a full-screen modal) so it
 * never blocks interaction with the rest of the page — the underlying app
 * stays fully clickable/scrollable while the tour is open. Dismissible via the
 * close button, "Skip", completing the last step, or pressing Escape.
 *
 * Mount this once near the root of the app (see `App.tsx`). It automatically
 * opens on a user's first visit (tracked via a localStorage flag) and can be
 * re-triggered at any time via {@link startOnboardingTour}.
 */
export function OnboardingTour() {
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  // Auto-open on first visit.
  useEffect(() => {
    if (hasCompletedTour()) return
    const timer = setTimeout(() => {
      setStepIndex(0)
      setOpen(true)
    }, AUTO_OPEN_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  // Allow manual re-triggering from anywhere (e.g. Settings "Replay tour").
  useEffect(() => {
    function handleStart() {
      setStepIndex(0)
      setOpen(true)
    }
    window.addEventListener(START_EVENT, handleStart)
    return () => window.removeEventListener(START_EVENT, handleStart)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    markTourCompleted()
  }, [])

  // Escape closes the tour — it never traps focus or blocks the rest of the page.
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [open, close])

  if (!open) return null

  const step = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1
  const Icon = step.icon

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="StellarLock onboarding tour"
      className="fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-auto sm:end-6 sm:bottom-6 sm:justify-end"
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold">{step.title}</h2>
          </div>
          <button
            onClick={close}
            aria-label="Close tour"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">{step.description}</p>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  i === stepIndex ? "bg-primary" : "bg-border",
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
                Back
              </Button>
            )}
            {!isLast ? (
              <>
                <Button variant="ghost" size="sm" onClick={close}>
                  Skip
                </Button>
                <Button size="sm" onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}>
                  Next
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={close}>
                Done
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
