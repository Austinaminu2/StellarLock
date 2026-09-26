import { useTranslation } from "react-i18next"
import { Globe } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { useState, useEffect, useRef } from "react"

const languages = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "ko", label: "한국어" },
  { code: "tr", label: "Türkçe" },
  { code: "zh", label: "中文" },
]

export function LanguageSelector() {
  const { i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Document dir/lang is handled centrally by the i18n `languageChanged` hook.
  const changeLanguage = (lng: string) => {
    void i18n.changeLanguage(lng)
    setIsOpen(false)
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Select language"
        aria-expanded={isOpen}
        aria-controls="language-menu"
      >
        <Globe className="h-4 w-4" />
      </Button>

      {isOpen && (
        <div
          id="language-menu"
          className="absolute right-0 mt-1 w-36 rounded-lg border border-border bg-card shadow-lg z-50"
          role="menu"
        >
          {languages.map((lng) => (
            <button
              key={lng.code}
              onClick={() => changeLanguage(lng.code)}
              className="block w-full px-4 py-2 text-sm text-start hover:bg-secondary rounded-lg"
              role="menuitem"
            >
              {lng.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
