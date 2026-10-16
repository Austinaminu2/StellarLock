import { useTranslation } from "react-i18next"

export function ErrorFallback({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-bold text-destructive">{t("errorBoundary.title")}</h1>
      <pre className="max-w-xl overflow-auto rounded-lg border border-border bg-card p-4 text-left text-xs text-muted-foreground">
        {/* Avoid leaking internal error details (RPC/Soroban/stack traces) */}
        {t("errorBoundary.message")}
      </pre>
      <button
        className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-secondary"
        onClick={onReset}
      >
        {t("errorBoundary.tryAgain")}
      </button>
    </div>
  )
}
