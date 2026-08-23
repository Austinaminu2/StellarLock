import type { ReactNode } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render } from "./utils"
import { CreateTokenLockForm } from "../components/locks/CreateTokenLockForm"
import { VALID_PUBLIC_KEY, VALID_CONTRACT_ADDRESS } from "./mocks"

// Complete third-party dependency overrides
vi.mock("@stellar/stellar-sdk", () => ({
  Address: class {
    toScVal = vi.fn()
  },
  nativeToScVal: vi.fn(),
  xdr: { ScVal: { scvVoid: vi.fn() } },
}))

// Hook mocks with TypeScript ESLint 'any' bypasses
const mockUseWallet = vi.fn()
vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => mockUseWallet() as unknown as Record<string, unknown>,
  WalletProvider: ({ children }: { children: ReactNode }) => children,
}))

const mockUseTokenBalance = vi.fn()
const mockUseTokenAllowance = vi.fn()
vi.mock("@/hooks/useLocks", () => ({
  useTokenBalance: () => mockUseTokenBalance() as unknown as Record<string, unknown>,
  useTokenAllowance: () => mockUseTokenAllowance() as unknown as Record<string, unknown>,
}))

vi.mock("@/lib/stellar", () => ({
  CONTRACTS: { tokenLocker: "CONTRACT_LOCKER" },
  isValidStellarAddress: (addr: string) => addr.startsWith("G") && addr.length === 56,
  isValidStellarContractAddress: (addr: string) => addr.startsWith("C") && addr.length === 56,
}))

describe("CreateTokenLockForm Validation Rules", () => {
  beforeEach(() => {
    localStorage.clear()
    mockUseWallet.mockReturnValue({ address: VALID_PUBLIC_KEY })
    mockUseTokenBalance.mockReturnValue({ data: 500, loading: false })
    mockUseTokenAllowance.mockReturnValue({ data: 0, loading: false })
  })

  it("should evaluate the form state changes synchronously as valid strings are provided", async () => {
    const user = userEvent.setup()
    render(<CreateTokenLockForm />)

    const submitButton = screen.getByRole("button", { name: /lock tokens/i })
    expect(submitButton).toBeDisabled()

    // 1. Type Valid Contract Token Address
    await user.type(screen.getByLabelText(/token contract address/i), VALID_CONTRACT_ADDRESS)
    expect(submitButton).toBeDisabled()

    // 2. Type Valid Positive Numerical Amount
    await user.type(screen.getByLabelText(/amount/i), "250")
    expect(submitButton).toBeDisabled()

    // 3. Type Future Date Target
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 2)
    const validDateString = tomorrow.toISOString().slice(0, 10)

    await user.type(screen.getByLabelText(/unlock date/i), validDateString)

    // Form evaluates all rules on state loop changes and flips open the button element
    expect(submitButton).toBeEnabled()
  })

  it("keeps the user's unlock date when the vesting template is switched back to Custom", async () => {
    const user = userEvent.setup()
    render(<CreateTokenLockForm />)

    const unlockInput = screen.getByLabelText(/unlock date/i)
    const chosen = new Date()
    chosen.setDate(chosen.getDate() + 45)
    const chosenDate = chosen.toISOString().slice(0, 10)

    await user.type(unlockInput, chosenDate)
    expect(unlockInput).toHaveValue(chosenDate)

    const templateSelect = screen.getByLabelText(/vesting schedule/i)

    // Picking a template overwrites the date with the template-derived one...
    await user.selectOptions(templateSelect, "linear1y")
    expect(unlockInput).not.toHaveValue(chosenDate)
    const templateDate = (unlockInput as HTMLInputElement).value
    expect(templateDate).not.toBe("")

    // ...and switching between templates keeps updating it.
    await user.selectOptions(templateSelect, "linear2y")
    expect((unlockInput as HTMLInputElement).value).not.toBe(templateDate)

    // Going back to Custom restores what the user picked instead of blanking it.
    await user.selectOptions(templateSelect, "none")
    expect(unlockInput).toHaveValue(chosenDate)
  })

  it("stays quiet on a pristine form", () => {
    render(<CreateTokenLockForm />)
    expect(screen.queryByText(/problem/i)).not.toBeInTheDocument()
  })

  it("shows shared-validator guidance for a field the user has filled in badly", async () => {
    const user = userEvent.setup()
    render(<CreateTokenLockForm />)

    await user.type(screen.getByLabelText(/token contract address/i), "not-a-contract")

    const message = await screen.findByText("Invalid token contract address.")
    const panel = message.closest("[role='alert']") as HTMLElement
    expect(
      within(panel).getByText("Paste a Stellar contract id (starts with C) for the token you want to lock."),
    ).toBeInTheDocument()
    expect(within(panel).getByText(/1 problem to fix/i)).toBeInTheDocument()

    // The failure is also announced through the app-wide live region.
    expect(await screen.findByText(/1 problem to fix\. Invalid token contract address\./i)).toBeInTheDocument()

    // Untouched fields stay silent even though they are also invalid.
    expect(screen.queryByText("Amount must be greater than 0.")).not.toBeInTheDocument()
    expect(screen.queryByText("Unlock date must be in the future.")).not.toBeInTheDocument()
  })

  it("clears the guidance once the field is corrected", async () => {
    const user = userEvent.setup()
    render(<CreateTokenLockForm />)

    const tokenInput = screen.getByLabelText(/token contract address/i)
    await user.type(tokenInput, "not-a-contract")
    expect(await screen.findByText("Invalid token contract address.")).toBeInTheDocument()

    await user.clear(tokenInput)
    await user.type(tokenInput, VALID_CONTRACT_ADDRESS)

    expect(screen.queryByText("Invalid token contract address.")).not.toBeInTheDocument()
  })
})

describe("CreateTokenLockForm lock-creation cooldown", () => {
  const WALLET_A = VALID_PUBLIC_KEY
  const WALLET_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB5UY"

  beforeEach(() => {
    localStorage.clear()
    mockUseTokenBalance.mockReturnValue({ data: 500, loading: false })
    mockUseTokenAllowance.mockReturnValue({ data: 0, loading: false })
  })

  it("does not apply wallet A's cooldown to wallet B", () => {
    localStorage.setItem(`stellarlock:last_lock_created_at:${WALLET_A}`, String(Date.now()))

    mockUseWallet.mockReturnValue({ address: WALLET_B })
    render(<CreateTokenLockForm />)

    expect(screen.queryByText(/rate limit/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /lock tokens/i })).not.toHaveTextContent(/wait/i)
  })

  it("still enforces the cooldown for the wallet that created the lock", () => {
    localStorage.setItem(`stellarlock:last_lock_created_at:${WALLET_A}`, String(Date.now()))

    mockUseWallet.mockReturnValue({ address: WALLET_A })
    render(<CreateTokenLockForm />)

    expect(screen.getByText(/rate limit/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /wait \d+s/i })).toBeInTheDocument()
  })

  it("does not carry over a stale cooldown when the connected wallet changes after mount", () => {
    localStorage.setItem(`stellarlock:last_lock_created_at:${WALLET_A}`, String(Date.now()))

    mockUseWallet.mockReturnValue({ address: WALLET_A })
    const { rerender } = render(<CreateTokenLockForm />)
    expect(screen.getByText(/rate limit/i)).toBeInTheDocument()

    mockUseWallet.mockReturnValue({ address: WALLET_B })
    rerender(<CreateTokenLockForm />)

    expect(screen.queryByText(/rate limit/i)).not.toBeInTheDocument()
  })
})
