// Formatting helpers shared by the customer portal pages.

/** Money with the currency taken from the API field when present. */
export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  const value = typeof amount === "number" && Number.isFinite(amount) ? amount : 0
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency && currency.length === 3 ? currency : "USD",
      maximumFractionDigits: currency === "IDR" || currency === "VND" ? 0 : 2,
    }).format(value)
  } catch {
    return `${value.toLocaleString()} ${currency ?? ""}`.trim()
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  const value = typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0
  if (value <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const scaled = value / 1024 ** exponent
  return `${scaled.toFixed(scaled >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

/** Humanized timestamp, e.g. "26/8/2026, 12:37". */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
