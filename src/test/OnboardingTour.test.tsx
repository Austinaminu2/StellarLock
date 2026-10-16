import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { OnboardingTour } from "@/components/onboarding/OnboardingTour"
import { startOnboardingTour } from "@/components/onboarding/startOnboardingTour"

const STORAGE_KEY = "stellarlock:onboarding_tour_completed"
const AUTO_OPEN_DELAY_MS = 600

describe("OnboardingTour", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<OnboardingTour />)
    return user
  }

  it("does not render before the auto-open delay elapses", () => {
    setup()

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("auto-opens on the first step after the delay when the tour has not been completed", async () => {
    setup()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_OPEN_DELAY_MS)
    })

    expect(screen.getByRole("dialog", { name: /onboarding tour/i })).toBeInTheDocument()
    expect(screen.getByText("Connect your wallet")).toBeInTheDocument()
  })

  it("does not auto-open when the tour was already completed", async () => {
    localStorage.setItem(STORAGE_KEY, "1")

    setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_OPEN_DELAY_MS)
    })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("advances to the next step and back with Next/Back", async () => {
    const user = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_OPEN_DELAY_MS)
    })
    expect(screen.getByText("Connect your wallet")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Choose a lock type")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByText("Connect your wallet")).toBeInTheDocument()
  })

  it("closes and marks the tour completed when Skip is clicked", async () => {
    const user = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_OPEN_DELAY_MS)
    })
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Skip" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1")
  })

  it("closes when the close button is clicked", async () => {
    const user = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_OPEN_DELAY_MS)
    })
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Close tour" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1")
  })

  it("closes when Escape is pressed", async () => {
    const user = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_OPEN_DELAY_MS)
    })
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("shows a Done button (and no Skip/Next) on the last step, which closes the tour", async () => {
    const user = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_OPEN_DELAY_MS)
    })
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    // 4 steps total: Connect wallet -> Choose lock type -> Understand vesting -> Find explorer
    await user.click(screen.getByRole("button", { name: "Next" }))
    await user.click(screen.getByRole("button", { name: "Next" }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByText("Find the explorer")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("reopens at the first step when startOnboardingTour is called after dismissal", async () => {
    const user = setup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_OPEN_DELAY_MS)
    })
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Choose a lock type")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Skip" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    act(() => {
      startOnboardingTour()
    })

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("Connect your wallet")).toBeInTheDocument()
  })
})
