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
  if (error instanceof ApiError) {
    title = error.message || title
    const bits = [error.code]
    if (error.status > 0) bits.push(`HTTP ${error.status}`)
    description = bits.join(" · ")
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
    </Alert>
  )
}
