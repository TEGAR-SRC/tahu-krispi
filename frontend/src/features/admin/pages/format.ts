// Shared formatting helpers for the platform-admin pages: API date/money
// formatting. Kept local to src/features/admin/pages so the other role
// consoles stay untouched.
/**
 * Parses backend timestamps like "2026-08-26 11:40:22.561606+07".
 * The space-separated format is not valid `Date` input in every engine, so it
 * is normalized to ISO before parsing; returns null when unparseable.
 */
export function parseApiDate(raw?: string | null): Date | null {
  if (!raw) return null
  const text = raw.trim()
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2}(?::?\d{2})?|Z)?$/.exec(
      text,
    )
  if (!match) {
    const fallback = new Date(text)
    return Number.isNaN(fallback.getTime()) ? null : fallback
  }
  const [, datePart, timePart, rawOffset] = match
  let offset = ""
  if (rawOffset && rawOffset !== "Z") {
    const sign = rawOffset.startsWith("-") ? "-" : "+"
    const digits = rawOffset.replace(/[+-]/g, "").replace(":", "")
    offset = `${sign}${digits.slice(0, 2)}:${digits.slice(2, 4) || "00"}`
  }
  // Truncate sub-millisecond precision; JS Date only keeps ms.
  const [hms, fraction] = timePart.split(".")
  const millis = fraction ? `.${fraction.slice(0, 3).padEnd(3, "0")}` : ""
  const parsed = new Date(`${datePart}T${hms}${millis}${offset || "Z"}`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Humanized timestamp ("8/26/2026, 11:40:22 AM" style); "—" when empty. */
export function formatDateTime(raw?: string | null): string {
  const parsed = parseApiDate(raw)
  return parsed ? parsed.toLocaleString() : "—"
}

const moneyFormatters = new Map<string, Intl.NumberFormat>()

/** Currency-aware money formatter; defaults to IDR like the platform ledger. */
export function formatMoney(
  amount?: number | null,
  currency?: string | null,
): string {
  if (amount === undefined || amount === null || Number.isNaN(amount)) return "—"
  const code = (currency ?? "").trim().toUpperCase()
  let formatter = moneyFormatters.get(code)
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code || "IDR",
        maximumFractionDigits: code === "IDR" ? 0 : 2,
      })
    } catch {
      formatter = new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
      })
    }
    moneyFormatters.set(code, formatter)
  }
  return formatter.format(amount)
}
