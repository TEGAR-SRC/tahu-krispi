// Shared money/date formatting helpers for the finance console. Kept separate
// from lib.tsx so non-component exports do not trip react-refresh.

const currencyFormatters = new Map<string, Intl.NumberFormat>()

/** Formats an amount using the row's own currency field (defaults to IDR). */
export function formatMoney(
  amount: number | string | null | undefined,
  currency?: string | null,
): string {
  const numeric = typeof amount === "string" ? Number(amount) : amount
  if (numeric === null || numeric === undefined || Number.isNaN(numeric)) return "—"
  const code = currency && currency.length === 3 ? currency.toUpperCase() : "IDR"
  let formatter = currencyFormatters.get(code)
  if (!formatter) {
    formatter = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    })
    currencyFormatters.set(code, formatter)
  }
  return formatter.format(numeric)
}

/** Plain grouped number (counts, quantities). */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("id-ID").format(value)
}

/**
 * Parses backend timestamps like `2026-08-26 11:21:09.466271+07`. Hand-written
 * because `new Date()` is unreliable across engines for space separators and
 * bare `+07` offsets.
 */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*([+-]\d{2}(?::?\d{2})?)?$/,
  )
  if (match) {
    const [, year, month, day, hour, minute, second, fraction, offset] = match
    const millis = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0
    let offsetMinutes = 0
    if (offset) {
      const sign = offset.startsWith("-") ? -1 : 1
      const digits = offset.slice(1).replace(":", "")
      const hours = Number(digits.slice(0, 2))
      const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0
      offsetMinutes = sign * (hours * 60 + minutes)
    }
    const utcMs = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      millis,
    )
    return new Date(utcMs - offsetMinutes * 60_000)
  }
  const fallback = new Date(value)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

/** Humanized timestamp; em dash for empty values. */
export function formatDateTime(value: string | null | undefined): string {
  const date = parseTimestamp(value)
  if (!date) return "—"
  return date.toLocaleString()
}
