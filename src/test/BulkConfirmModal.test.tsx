import type { ReactNode } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render } from "./utils"
import { BulkConfirmModal } from "@/components/locks/BulkConfirmModal"
import { mockWallet, mockLock, VALID_PUBLIC_KEY } from "./mocks"
import type { Lock } from "@/types/lock"

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => mockWallet,
  WalletProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}))

// No-op the focus trap so jsdom focus side-effects don't interfere
vi.mock("@/lib/modalFocusTrap", () => ({
  useModalFocusTrap: vi.fn(),
}))

const makeLock = (overrides: Partial<Lock> = {}): Lock => ({
  ...mockLock,
  ...overrides,
})

const lock1 = makeLock({ id: "1" })
const lock2 = makeLock({ id: "2", token: { ...mockLock.token, symbol: "XLM" }, amount: 500 })

describe("BulkConfirmModal", () => {
  const onClose = vi.fn()
  const onConfirm = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Title rendering ───────────────────────────────────────────────────────

  it("renders the correct title for extend with single lock", () => {
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText(/bulk extend — 1 lock$/i)).toBeInTheDocument()
  })

  it("renders the correct title for extend with multiple locks", () => {
    render(<BulkConfirmModal action="extend" locks={[lock1, lock2]} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText(/bulk extend — 2 locks$/i)).toBeInTheDocument()
  })

  it("renders the correct title for transfer", () => {
    render(<BulkConfirmModal action="transfer" locks={[lock1, lock2]} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText(/bulk transfer — 2 locks/i)).toBeInTheDocument()
  })

  // ─── Lock list ─────────────────────────────────────────────────────────────

  it("renders all locks in the list before confirmation", () => {
    render(<BulkConfirmModal action="extend" locks={[lock1, lock2]} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText(/#1/)).toBeInTheDocument()
    expect(screen.getByText(/#2/)).toBeInTheDocument()
  })

  // ─── Extend: date input ────────────────────────────────────────────────────

  it("shows a date input labelled correctly for extend action", () => {
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText(/new unlock date for all selected locks/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue("")).toHaveAttribute("type", "date")
  })

  it("disables confirm button when no date is set for extend", () => {
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByRole("button", { name: /confirm extension/i })).toBeDisabled()
  })

  it("enables confirm button once a date is entered for extend", async () => {
    const user = userEvent.setup()
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    const dateInput = screen.getByDisplayValue("")
    await user.type(dateInput, "2099-01-01")
    expect(screen.getByRole("button", { name: /confirm extension/i })).not.toBeDisabled()
  })

  // ─── Transfer: address input ───────────────────────────────────────────────

  it("shows an address input labelled correctly for transfer action", () => {
    render(<BulkConfirmModal action="transfer" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText(/new beneficiary address/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText("G…")).toBeInTheDocument()
  })

  it("disables confirm button when transfer address is too short", () => {
    render(<BulkConfirmModal action="transfer" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByRole("button", { name: /confirm transfer/i })).toBeDisabled()
  })

  it("enables confirm button once a valid 56-char address is entered for transfer", async () => {
    const user = userEvent.setup()
    render(<BulkConfirmModal action="transfer" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    const addressInput = screen.getByPlaceholderText("G…")
    await user.type(addressInput, VALID_PUBLIC_KEY) // 56 chars
    expect(screen.getByRole("button", { name: /confirm transfer/i })).not.toBeDisabled()
  })

  it("keeps confirm button disabled for a 56-char string with an invalid checksum", async () => {
    const user = userEvent.setup()
    render(<BulkConfirmModal action="transfer" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    const addressInput = screen.getByPlaceholderText("G…")
    const badChecksum = "GABC1234GABC1234GABC1234GABC1234GABC1234GABC1234GABC1234"
    expect(badChecksum).toHaveLength(56)
    await user.type(addressInput, badChecksum)
    expect(screen.getByRole("button", { name: /confirm transfer/i })).toBeDisabled()
  })

  it("keeps confirm button disabled for a 55-char address", async () => {
    const user = userEvent.setup()
    render(<BulkConfirmModal action="transfer" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    const addressInput = screen.getByPlaceholderText("G…")
    await user.type(addressInput, VALID_PUBLIC_KEY.slice(0, 55))
    expect(screen.getByRole("button", { name: /confirm transfer/i })).toBeDisabled()
  })

  // ─── Cancel / close ────────────────────────────────────────────────────────

  it("calls onClose when Cancel button is clicked", async () => {
    const user = userEvent.setup()
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    await user.click(screen.getByRole("button", { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("calls onClose when the X close button is clicked", async () => {
    const user = userEvent.setup()
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    // The X button has no accessible name; find it by its SVG child
    const closeBtn = screen.getByRole("button", { name: "" })
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("calls onClose when the backdrop is clicked", () => {
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    // The backdrop is the absolute overlay div immediately inside the dialog
    const dialog = screen.getByRole("dialog")

    const backdrop = dialog.querySelector(".absolute.inset-0")!
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  // ─── Running state ─────────────────────────────────────────────────────────

  it("shows per-lock pending spinners while onConfirm is in-flight", async () => {
    let resolveConfirm!: () => void
    const slowConfirm = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveConfirm = res
        }),
    )

    const user = userEvent.setup()
    render(<BulkConfirmModal action="extend" locks={[lock1, lock2]} onConfirm={slowConfirm} onClose={onClose} />)

    const dateInput = screen.getByDisplayValue("")
    await user.type(dateInput, "2099-01-01")

    await user.click(screen.getByRole("button", { name: /confirm extension/i }))

    // Spinners should appear while the promise is unresolved
    await waitFor(() => {
      // Loader2 renders as SVG; check for the loading state rows (Lock #id text)
      expect(screen.getAllByText(/lock #/i)).toHaveLength(2)
    })

    // X close button should be hidden while running
    expect(screen.queryByRole("button", { name: "" })).not.toBeInTheDocument()

    // Cancel button should be disabled while running
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled()

    resolveConfirm()
  })

  it("hides the X close button while onConfirm is running", async () => {
    let resolveConfirm!: () => void
    const slowConfirm = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveConfirm = res
        }),
    )

    const user = userEvent.setup()
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={slowConfirm} onClose={onClose} />)
    const dateInput = screen.getByDisplayValue("")
    await user.type(dateInput, "2099-01-01")

    await user.click(screen.getByRole("button", { name: /confirm extension/i }))

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "" })).not.toBeInTheDocument()
    })

    resolveConfirm()
  })

  // ─── Settled / done state ──────────────────────────────────────────────────

  it("shows success icon and Done button after all locks succeed", async () => {
    const successConfirm = vi.fn(
      (
        _value: string,
        onItemSettled: (id: string, outcome: { status: "success" | "error"; error?: string }) => void,
      ) => {
        onItemSettled("1", { status: "success" })
        return Promise.resolve()
      },
    )

    const user = userEvent.setup()
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={successConfirm} onClose={onClose} />)
    const dateInput = screen.getByDisplayValue("")
    await user.type(dateInput, "2099-01-01")
    await user.click(screen.getByRole("button", { name: /confirm extension/i }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument()
    })

    // The form section should no longer be rendered
    expect(screen.queryByText(/new unlock date/i)).not.toBeInTheDocument()
  })

  it("shows error message for a failed lock after settling", async () => {
    const errorConfirm = vi.fn(
      (
        _value: string,
        onItemSettled: (id: string, outcome: { status: "success" | "error"; error?: string }) => void,
      ) => {
        onItemSettled("1", { status: "error", error: "Rejected by ledger" })
        return Promise.resolve()
      },
    )

    const user = userEvent.setup()
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={errorConfirm} onClose={onClose} />)
    const dateInput = screen.getByDisplayValue("")
    await user.type(dateInput, "2099-01-01")
    await user.click(screen.getByRole("button", { name: /confirm extension/i }))

    await waitFor(() => {
      expect(screen.getByText(/rejected by ledger/i)).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument()
  })

  it("shows mixed success and error rows when some locks fail", async () => {
    const mixedConfirm = vi.fn(
      (
        _value: string,
        onItemSettled: (id: string, outcome: { status: "success" | "error"; error?: string }) => void,
      ) => {
        onItemSettled("1", { status: "success" })
        onItemSettled("2", { status: "error", error: "tx failed" })
        return Promise.resolve()
      },
    )

    const user = userEvent.setup()
    render(<BulkConfirmModal action="extend" locks={[lock1, lock2]} onConfirm={mixedConfirm} onClose={onClose} />)
    const dateInput = screen.getByDisplayValue("")
    await user.type(dateInput, "2099-01-01")
    await user.click(screen.getByRole("button", { name: /confirm extension/i }))

    await waitFor(() => {
      expect(screen.getByText(/tx failed/i)).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument()
  })

  it("calls onClose when Done button is clicked", async () => {
    const successConfirm = vi.fn(
      (_value: string, onItemSettled: (id: string, outcome: { status: "success" | "error" }) => void) => {
        onItemSettled("1", { status: "success" })
        return Promise.resolve()
      },
    )

    const user = userEvent.setup()
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={successConfirm} onClose={onClose} />)
    const dateInput = screen.getByDisplayValue("")
    await user.type(dateInput, "2099-01-01")
    await user.click(screen.getByRole("button", { name: /confirm extension/i }))

    const doneBtn = await screen.findByRole("button", { name: /done/i })
    await user.click(doneBtn)
    expect(onClose).toHaveBeenCalledOnce()
  })

  // ─── onConfirm call args ───────────────────────────────────────────────────

  it("passes the entered date value to onConfirm for extend", async () => {
    const user = userEvent.setup()
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    const dateInput = screen.getByDisplayValue("")
    await user.type(dateInput, "2099-06-15")
    await user.click(screen.getByRole("button", { name: /confirm extension/i }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onConfirm.mock.calls[0][0]).toBe("2099-06-15")
  })

  it("passes the entered address to onConfirm for transfer", async () => {
    const user = userEvent.setup()
    render(<BulkConfirmModal action="transfer" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    const addressInput = screen.getByPlaceholderText("G…")
    await user.type(addressInput, VALID_PUBLIC_KEY)
    await user.click(screen.getByRole("button", { name: /confirm transfer/i }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onConfirm.mock.calls[0][0]).toBe(VALID_PUBLIC_KEY)
  })

  // ─── Accessibility ─────────────────────────────────────────────────────────

  it("renders with role=dialog and aria-modal=true", () => {
    render(<BulkConfirmModal action="extend" locks={[lock1]} onConfirm={onConfirm} onClose={onClose} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "true")
  })
})
