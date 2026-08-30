import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ApiError } from "@/lib/api"
import { TriangleAlertIcon } from "lucide-react"

interface ErrorBannerProps {
  /** Any thrown value; `ApiError` instances render code + status detail. */
  error: unknown
}

/** Renders nothing when `error` is falsy; an alert banner otherwise. */
export function ErrorBanner({ error }: ErrorBannerProps) {
  if (!error) return null

  let title = "Something went wrong"
  let description: string | undefined
  let fieldEntries: Array<[string, string]> = []
  if (error instanceof ApiError) {
    title = error.message || title
    const bits = [error.code]
    if (error.status > 0) bits.push(`HTTP ${error.status}`)
    description = bits.join(" · ")
    // Surface per-field validation errors when the backend provides them (error.details.fields).
    const details = error.details as Record<string, unknown> | undefined
    const fields = details?.fields ?? (details as Record<string, unknown>)?.["fields"]
    // Some envelopes nest fields under error.details.fields, others directly under details.
    const rawFields =
      (fields as Record<string, string> | undefined) ??
      ((error.details as Record<string, unknown> | undefined)?.["fields"] as Record<string, string> | undefined)
    // Fallback: check if details itself is a field map (for direct field errors).
    const candidate = rawFields ?? (isFieldMap(details) ? (details as Record<string, string>) : undefined)
    if (candidate && typeof candidate === "object") {
      fieldEntries = Object.entries(candidate).filter(([, v]) => typeof v === "string") as Array<[string, string]>
      // Also check nested .fields inside details if details is an object containing fields
      if (fieldEntries.length === 0 && details && typeof details === "object" && "fields" in details) {
        const nested = (details as Record<string, unknown>)["fields"]
        if (nested && typeof nested === "object") {
          fieldEntries = Object.entries(nested as Record<string, string>).filter(([, v]) => typeof v === "string") as Array<
            [string, string]
          >
        }
      }
    }
    // Also handle case where details is directly a field map (backend sends Fields at top level of error.details)
    if (fieldEntries.length === 0 && details && typeof details === "object") {
      const maybeFields = details as Record<string, unknown>
      // If details looks like {email:"...", password:"..."} without nesting, treat each string entry as field error
      const entries = Object.entries(maybeFields).filter(([, v]) => typeof v === "string")
      // Heuristic: if we have more than one string entry and title is validation-related, show them
      if (entries.length > 0 && entries.length <= 5 && error.code === "VALIDATION_ERROR") {
        fieldEntries = entries as Array<[string, string]>
      }
    }
  } else if (error instanceof Error) {
    title = error.message
  } else {
    description = String(error)
  }

  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      {description ? <AlertDescription>{description}</AlertDescription> : null}
      {fieldEntries.length > 0 ? (
        <AlertDescription>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {fieldEntries.map(([field, msg]) => (
              <li key={field}>
                <span className="font-medium">{field}:</span> {msg}
              </li>
            ))}
          </ul>
        </AlertDescription>
      ) : null}
    </Alert>
  )
}

function isFieldMap(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false
  const entries = Object.entries(v as Record<string, unknown>)
  return entries.length > 0 && entries.every(([, val]) => typeof val === "string")
}
