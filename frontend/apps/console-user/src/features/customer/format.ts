// Formatting helpers shared by the customer portal pages.

/** Money with the currency taken from the API field when present. */
export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  const value = typeof amount === "number" && Number.isFinite(amount) ? amount : 0
  const code = currency && currency.length === 3 ? currency : "IDR"
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "IDR" || code === "VND" ? 0 : 2,
    }).format(value)
  } catch {
    return `${value.toLocaleString()} ${code}`.trim()
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes as number)) return "—"
  const value = typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0
  if (value <= 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let scaled = value
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit += 1
  }
  return `${scaled.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function parseApiDate(raw?: string | null): Date | null {
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
  const [hms, fraction] = timePart.split(".")
  const millis = fraction ? `.${fraction.slice(0, 3).padEnd(3, "0")}` : ""
  const parsed = new Date(`${datePart}T${hms}${millis}${offset || "Z"}`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Humanized timestamp – robust against backend "YYYY-MM-DD HH:MM:SS+07" format. */
export function formatDateTime(value: string | null | undefined): string {
  const parsed = parseApiDate(value)
  if (parsed) return parsed.toLocaleString()
  if (!value) return "—"
  const fallback = new Date(value)
  return Number.isNaN(fallback.getTime()) ? value : fallback.toLocaleString()
}
