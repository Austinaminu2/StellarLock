import { describe, it, expect } from "vitest"
import en from "@/i18n/locales/en.json"
import es from "@/i18n/locales/es.json"
import ko from "@/i18n/locales/ko.json"
import tr from "@/i18n/locales/tr.json"
import zh from "@/i18n/locales/zh.json"

const locales = { en, es, ko, tr, zh } as unknown as Record<string, Record<string, Record<string, string>>>

describe("locale files", () => {
  it.each(Object.keys(locales))("%s defines keys referenced by LockDetail and RecentActivity", (lng) => {
    const bundle = locales[lng]
    expect(bundle.lockDetail.extendDateMustBeAfter).toContain("{{date}}")
    expect(bundle.common.pause).toBeTruthy()
    expect(bundle.common.resume).toBeTruthy()
  })
})
