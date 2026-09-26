import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { render as rtlRender, screen, act, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { LanguageSelector } from "@/components/layout/LanguageSelector"
import i18n from "@/i18n"

function render(ui: React.ReactElement) {
  return rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

describe("LanguageSelector Component", () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en")
    })
  })

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en")
    })
  })

  it("renders a toggle button for the language menu, closed by default", () => {
    render(<LanguageSelector />)

    const toggle = screen.getByRole("button", { name: /select language/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("menuitem", { name: "English" })).not.toBeInTheDocument()
  })

  it("opens the language menu when the toggle is clicked", async () => {
    const user = userEvent.setup()
    render(<LanguageSelector />)

    await user.click(screen.getByRole("button", { name: /select language/i }))

    expect(screen.getByRole("button", { name: /select language/i })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("menuitem", { name: "English" })).toBeInTheDocument()
  })

  it("offers every shipped locale in the menu", async () => {
    const user = userEvent.setup()
    render(<LanguageSelector />)

    await user.click(screen.getByRole("button", { name: /select language/i }))

    for (const label of ["English", "Español", "한국어", "Türkçe", "中文"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument()
    }
  })

  it("switches to a non-English locale on selection", async () => {
    const user = userEvent.setup()
    render(<LanguageSelector />)

    await user.click(screen.getByRole("button", { name: /select language/i }))
    await user.click(screen.getByRole("menuitem", { name: "Türkçe" }))

    await act(async () => {
      await waitFor(() => expect(i18n.language).toBe("tr"))
    })
  })

  it("closes the language menu when the toggle is clicked again", async () => {
    const user = userEvent.setup()
    render(<LanguageSelector />)

    const toggle = screen.getByRole("button", { name: /select language/i })
    await user.click(toggle)
    expect(screen.getByRole("menuitem", { name: "English" })).toBeInTheDocument()

    await user.click(toggle)
    expect(screen.queryByRole("menuitem", { name: "English" })).not.toBeInTheDocument()
  })

  it("switches i18next's active language and closes the menu on selection", async () => {
    const user = userEvent.setup()

    await act(async () => {
      await i18n.changeLanguage("es")
    })

    render(<LanguageSelector />)

    await user.click(screen.getByRole("button", { name: /select language/i }))
    await user.click(screen.getByRole("menuitem", { name: "English" }))

    await act(async () => {
      await waitFor(() => expect(i18n.language).toBe("en"))
    })
    expect(screen.queryByRole("menuitem", { name: "English" })).not.toBeInTheDocument()
  })
})
