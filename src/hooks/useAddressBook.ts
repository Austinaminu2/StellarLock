import { useState, useCallback, useEffect } from "react"
import { isValidStellarAddress } from "@/lib/stellar-address"

const STORAGE_KEY = "stellarlock:address-book"

export interface AddressBookEntry {
  id: string
  label: string
  address: string
  createdAt: number
  updatedAt: number
}

export interface AddressBook {
  entries: AddressBookEntry[]
  add: (label: string, address: string) => AddressBookEntry | null
  update: (id: string, label: string, address: string) => boolean
  remove: (id: string) => void
  find: (address: string) => AddressBookEntry | undefined
  exportJson: () => string
  importJson: (json: string) => { imported: number; errors: number }
}

function isAddressBookEntry(e: unknown): e is AddressBookEntry {
  if (typeof e !== "object" || e === null) return false
  const entry = e as Record<string, unknown>
  return (
    typeof entry.id === "string" &&
    typeof entry.label === "string" &&
    typeof entry.address === "string" &&
    typeof entry.createdAt === "number" &&
    isValidStellarAddress(entry.address)
  )
}

function loadEntries(): AddressBookEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isAddressBookEntry)
  } catch {
    return []
  }
}

function saveEntries(entries: AddressBookEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Ignore storage quota errors
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useAddressBook(): AddressBook {
  const [entries, setEntries] = useState<AddressBookEntry[]>(loadEntries)

  // Sync to localStorage whenever entries change
  useEffect(() => {
    saveEntries(entries)
  }, [entries])

  const add = useCallback((label: string, address: string): AddressBookEntry | null => {
    const trimmedLabel = label.trim()
    const trimmedAddress = address.trim()
    if (!trimmedLabel || !isValidStellarAddress(trimmedAddress)) return null

    const entry: AddressBookEntry = {
      id: generateId(),
      label: trimmedLabel,
      address: trimmedAddress,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    setEntries((prev) => {
      // Avoid duplicates by address
      if (prev.some((e) => e.address === trimmedAddress)) {
        return prev.map((e) =>
          e.address === trimmedAddress ? { ...e, label: trimmedLabel, updatedAt: Date.now() } : e,
        )
      }
      return [...prev, entry]
    })

    return entry
  }, [])

  const update = useCallback((id: string, label: string, address: string): boolean => {
    const trimmedLabel = label.trim()
    const trimmedAddress = address.trim()
    if (!trimmedLabel || !isValidStellarAddress(trimmedAddress)) return false

    setEntries((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, label: trimmedLabel, address: trimmedAddress, updatedAt: Date.now() } : e,
      ),
    )
    return true
  }, [])

  const remove = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const find = useCallback((address: string) => entries.find((e) => e.address === address), [entries])

  const exportJson = useCallback((): string => {
    return JSON.stringify(entries, null, 2)
  }, [entries])

  const importJson = useCallback((json: string): { imported: number; errors: number } => {
    let imported = 0
    let errors = 0
    try {
      const parsed: unknown = JSON.parse(json)
      if (!Array.isArray(parsed)) return { imported: 0, errors: 1 }

      setEntries((prev) => {
        const next = [...prev]
        for (const item of parsed as unknown[]) {
          const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null
          if (
            entry &&
            typeof entry.label === "string" &&
            typeof entry.address === "string" &&
            isValidStellarAddress(entry.address.trim())
          ) {
            const address = entry.address.trim()
            const exists = next.some((e) => e.address === address)
            if (!exists) {
              next.push({
                id: generateId(),
                label: entry.label.trim(),
                address,
                createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
                updatedAt: Date.now(),
              })
              imported++
            }
          } else {
            errors++
          }
        }
        return next
      })
    } catch {
      errors++
    }
    return { imported, errors }
  }, [])

  return { entries, add, update, remove, find, exportJson, importJson }
}
