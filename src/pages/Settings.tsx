import { useState, useRef } from "react"
import { Helmet } from "react-helmet-async"
import { BookUser, Plus, Pencil, Trash2, Check, Download, Upload, Search, Bell, Compass } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Input, Label } from "@/components/ui/Input"
import { Card } from "@/components/ui/Card"
import { shortAddress } from "@/lib/utils"
import { isValidStellarAddress } from "@/lib/stellar-address"
import { useAddressBook, type AddressBookEntry } from "@/hooks/useAddressBook"
import { NotificationPreferences } from "@/components/ui/NotificationPreferences"
import { startOnboardingTour } from "@/components/onboarding/OnboardingTour"

export function Settings() {
  const book = useAddressBook()
  const [search, setSearch] = useState("")
  const [editId, setEditId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState("")
  const [editAddress, setEditAddress] = useState("")
  const [addMode, setAddMode] = useState(false)
  const [newLabel, setNewLabel] = useState("")
  const [newAddress, setNewAddress] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const filtered = book.entries.filter(
    (e) =>
      e.label.toLowerCase().includes(search.toLowerCase()) || e.address.toLowerCase().includes(search.toLowerCase()),
  )

  function handleAdd() {
    setError(null)
    if (!newLabel.trim()) return setError("Label is required.")
    if (!isValidStellarAddress(newAddress.trim())) return setError("Invalid Stellar address.")
    book.add(newLabel, newAddress)
    setNewLabel("")
    setNewAddress("")
    setAddMode(false)
  }

  function handleEditSave() {
    if (!editId) return
    setError(null)
    if (!editLabel.trim()) return setError("Label is required.")
    if (!isValidStellarAddress(editAddress.trim())) return setError("Invalid Stellar address.")
    book.update(editId, editLabel, editAddress)
    setEditId(null)
  }

  function handleEditStart(entry: AddressBookEntry) {
    setEditId(entry.id)
    setEditLabel(entry.label)
    setEditAddress(entry.address)
    setError(null)
    setAddMode(false)
  }

  function handleExport() {
    const json = book.exportJson()
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "stellarlock-address-book.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setImportStatus(null)
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const result = book.importJson(text)
      if (result.errors > 0 && result.imported === 0) {
        setImportStatus("Import failed: no valid entries found.")
      } else {
        setImportStatus(
          `Imported ${result.imported} address${result.imported !== 1 ? "es" : ""}${result.errors > 0 ? ` (${result.errors} skipped)` : ""}.`,
        )
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  return (
    <>
      <Helmet>
        <title>Settings — StellarLock</title>
        <meta name="description" content="Manage your address book and app settings on StellarLock." />
      </Helmet>

      <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <h1 className="mb-6 text-3xl font-bold tracking-tight">Settings</h1>

        <Card className="overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <BookUser className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Address Book</h2>
              <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {book.entries.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExport} title="Export as JSON">
                <Download className="h-4 w-4" />
                Export
              </Button>
              <Button variant="outline" size="sm" onClick={() => importRef.current?.click()} title="Import from JSON">
                <Upload className="h-4 w-4" />
                Import
              </Button>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button
                size="sm"
                onClick={() => {
                  setAddMode((v) => !v)
                  setEditId(null)
                  setError(null)
                }}
              >
                <Plus className="h-4 w-4" />
                Add Address
              </Button>
            </div>
          </div>

          {importStatus && (
            <div className="border-b border-border bg-secondary/30 px-6 py-3 text-sm text-muted-foreground">
              {importStatus}
            </div>
          )}

          <div className="p-6">
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search by label or address…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Add new entry form */}
            {addMode && (
              <div className="mb-4 rounded-lg border border-border bg-secondary/30 p-4">
                <h3 className="mb-3 text-sm font-medium">New Address</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ab-new-label">Label</Label>
                    <Input
                      id="ab-new-label"
                      placeholder="e.g. Team Wallet"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label htmlFor="ab-new-address">Stellar Address</Label>
                    <Input
                      id="ab-new-address"
                      placeholder="G… or C…"
                      value={newAddress}
                      onChange={(e) => setNewAddress(e.target.value)}
                      className={
                        newAddress && !isValidStellarAddress(newAddress)
                          ? "border-destructive focus:ring-destructive"
                          : ""
                      }
                    />
                  </div>
                </div>
                {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAddMode(false)
                      setError(null)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleAdd}>
                    <Check className="h-4 w-4" />
                    Save Address
                  </Button>
                </div>
              </div>
            )}

            {/* Entry list */}
            {filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-12 text-center">
                <BookUser className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {book.entries.length === 0
                    ? 'No saved addresses yet. Click "Add Address" to save your first beneficiary.'
                    : "No addresses match your search."}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50">
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">Label</th>
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">Address</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((entry) =>
                      editId === entry.id ? (
                        <tr key={entry.id} className="bg-secondary/20">
                          <td className="px-4 py-2" colSpan={3}>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <Label htmlFor={`ab-edit-label-${entry.id}`}>Label</Label>
                                <Input
                                  id={`ab-edit-label-${entry.id}`}
                                  value={editLabel}
                                  onChange={(e) => setEditLabel(e.target.value)}
                                  autoFocus
                                />
                              </div>
                              <div>
                                <Label htmlFor={`ab-edit-addr-${entry.id}`}>Address</Label>
                                <Input
                                  id={`ab-edit-addr-${entry.id}`}
                                  value={editAddress}
                                  onChange={(e) => setEditAddress(e.target.value)}
                                  className={
                                    editAddress && !isValidStellarAddress(editAddress) ? "border-destructive" : ""
                                  }
                                />
                              </div>
                              {error && <p className="col-span-2 text-xs text-destructive">{error}</p>}
                              <div className="col-span-2 flex justify-end gap-2">
                                <Button variant="ghost" size="sm" onClick={() => setEditId(null)}>
                                  Cancel
                                </Button>
                                <Button size="sm" onClick={handleEditSave}>
                                  <Check className="h-4 w-4" />
                                  Save
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={entry.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3 font-medium">{entry.label}</td>
                          <td className="px-4 py-3 font-mono text-muted-foreground">
                            {shortAddress(entry.address, 10, 10)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => handleEditStart(entry)}
                                aria-label={`Edit ${entry.label}`}
                                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => book.remove(entry.id)}
                                aria-label={`Delete ${entry.label}`}
                                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        {/* Notification Preferences */}
        <Card className="mt-8 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-6 py-4">
            <Bell className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Notification Preferences</h2>
          </div>
          <div className="p-6">
            <NotificationPreferences />
          </div>
        </Card>

        {/* Onboarding Tour */}
        <Card className="mt-8 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-6 py-4">
            <Compass className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Onboarding</h2>
          </div>
          <div className="flex items-center justify-between p-6">
            <div>
              <p className="text-sm font-medium">First-time tour</p>
              <p className="text-xs text-muted-foreground">
                Replay the guided tour covering wallets, lock types, vesting, and the explorer.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => startOnboardingTour()}>
              Replay tour
            </Button>
          </div>
        </Card>
      </div>
    </>
  )
}
