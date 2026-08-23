import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useAddressBook } from "@/hooks/useAddressBook"

// Real checksum-valid Stellar account addresses. The address book validates with
// StrKey, so placeholder strings of the right length and prefix are rejected.
const ADDR_A = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR"
const ADDR_B = "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U"

describe("useAddressBook", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it("starts empty", () => {
    const { result } = renderHook(() => useAddressBook())
    expect(result.current.entries).toHaveLength(0)
  })

  it("adds a valid entry", () => {
    const { result } = renderHook(() => useAddressBook())
    act(() => {
      result.current.add("Team Wallet", ADDR_A)
    })
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0].label).toBe("Team Wallet")
    expect(result.current.entries[0].address).toBe(ADDR_A)
  })

  it("rejects an invalid address", () => {
    const { result } = renderHook(() => useAddressBook())
    act(() => {
      const entry = result.current.add("Bad Entry", "notanaddress")
      expect(entry).toBeNull()
    })
    expect(result.current.entries).toHaveLength(0)
  })

  it("deduplicates by address, updating label", () => {
    const { result } = renderHook(() => useAddressBook())
    act(() => {
      result.current.add("Label A", ADDR_A)
    })
    act(() => {
      result.current.add("Label B", ADDR_A)
    })
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0].label).toBe("Label B")
  })

  it("removes an entry", () => {
    const { result } = renderHook(() => useAddressBook())
    act(() => {
      result.current.add("Team", ADDR_A)
    })
    const id = result.current.entries[0].id
    act(() => result.current.remove(id))
    expect(result.current.entries).toHaveLength(0)
  })

  it("updates an entry", () => {
    const { result } = renderHook(() => useAddressBook())
    act(() => {
      result.current.add("Old Label", ADDR_A)
    })
    const id = result.current.entries[0].id
    act(() => {
      result.current.update(id, "New Label", ADDR_B)
    })
    expect(result.current.entries[0].label).toBe("New Label")
    expect(result.current.entries[0].address).toBe(ADDR_B)
  })

  it("finds an entry by address", () => {
    const { result } = renderHook(() => useAddressBook())
    act(() => {
      result.current.add("Team", ADDR_A)
    })
    const found = result.current.find(ADDR_A)
    expect(found?.label).toBe("Team")
  })

  it("persists to localStorage", () => {
    const { result } = renderHook(() => useAddressBook())
    act(() => {
      result.current.add("Persistent", ADDR_A)
    })
    const stored = JSON.parse(localStorage.getItem("stellarlock:address-book") ?? "[]") as { label: string }[]
    expect(stored).toHaveLength(1)
    expect(stored[0].label).toBe("Persistent")
  })

  it("loads from localStorage on mount", () => {
    localStorage.setItem(
      "stellarlock:address-book",
      JSON.stringify([{ id: "1", label: "Existing", address: ADDR_A, createdAt: Date.now(), updatedAt: Date.now() }]),
    )
    const { result } = renderHook(() => useAddressBook())
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0].label).toBe("Existing")
  })

  it("exports valid JSON", () => {
    const { result } = renderHook(() => useAddressBook())
    act(() => {
      result.current.add("Export Test", ADDR_A)
    })
    const json = result.current.exportJson()
    const parsed = JSON.parse(json) as { label: string }[]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0].label).toBe("Export Test")
  })

  it("imports from JSON", () => {
    const { result } = renderHook(() => useAddressBook())
    const json = JSON.stringify([{ label: "Imported", address: ADDR_B }])
    act(() => {
      const res = result.current.importJson(json)
      expect(res.imported).toBe(1)
      expect(res.errors).toBe(0)
    })
    expect(result.current.entries.some((e) => e.address === ADDR_B)).toBe(true)
  })

  it("skips invalid entries during import", () => {
    const { result } = renderHook(() => useAddressBook())
    const json = JSON.stringify([
      { label: "Valid", address: ADDR_A },
      { label: "Invalid", address: "bad" },
    ])
    act(() => {
      const res = result.current.importJson(json)
      expect(res.imported).toBe(1)
      expect(res.errors).toBe(1)
    })
  })
})
