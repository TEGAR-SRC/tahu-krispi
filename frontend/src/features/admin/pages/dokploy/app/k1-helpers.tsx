/* eslint-disable react-refresh/only-export-components */
import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/shared/EmptyState"
import { dokploy, toErrorMessage } from "./shared"

export type Row = Record<string, unknown>

export function s(value: unknown): string {
  if (value === undefined || value === null) return ""
  return String(value)
}

export function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter(isRow)
  if (isRow(value)) {
    for (const key of ["data", "items", "projects", "environments", "deployments", "tags"] as const) {
      const nested = value[key]
      if (Array.isArray(nested)) return nested.filter(isRow)
    }
  }
  return []
}

export function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function firstString(row: Row | null | undefined, keys: string[]): string {
  if (!row) return ""
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value)) return String(value)
  }
  return ""
}

export function shortJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function parseJsonObject(text: string): Row {
  const parsed = JSON.parse(text)
  if (!isRow(parsed)) throw new Error("JSON body must be an object")
  return parsed
}

export function ErrorAlert({ title = "Upstream request failed", error }: { title?: string; error: unknown }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{toErrorMessage(error)}</AlertDescription>
    </Alert>
  )
}

export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function RawJsonCard({ title, value }: { title: string; value: unknown }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
          {shortJson(value)}
        </pre>
      </CardContent>
    </Card>
  )
}

export function JsonMutationDialog({
  title,
  description,
  trigger,
  op,
  method = "POST",
  initial,
  onSuccess,
}: {
  title: string
  description?: string
  trigger: ReactNode
  op: string
  method?: "POST" | "PUT" | "DELETE"
  initial: Row
  onSuccess?: (result: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState(shortJson(initial))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const result = await dokploy(method, op, parseJsonObject(body))
      toast.success(`${title} succeeded`)
      setOpen(false)
      onSuccess?.(result)
    } catch (cause) {
      const message = toErrorMessage(cause)
      setError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${op}-json`}>Request JSON</Label>
          <Textarea
            id={`${op}-json`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="min-h-64 font-mono text-xs"
            aria-invalid={Boolean(error)}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmMutation({
  title,
  description,
  trigger,
  op,
  body,
  onSuccess,
}: {
  title: string
  description: string
  trigger: ReactNode
  op: string
  body: Row
  onSuccess?: (result: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setSubmitting(true)
    try {
      const result = await dokploy("POST", op, body)
      toast.success(`${title} succeeded`)
      setOpen(false)
      onSuccess?.(result)
    } catch (cause) {
      toast.error(toErrorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={submit} disabled={submitting}>
            {submitting ? "Working..." : "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function EntityCard({
  title,
  description,
  badge,
  children,
  actions,
  to,
}: {
  title: string
  description?: string
  badge?: string
  children?: ReactNode
  actions?: ReactNode
  to?: string
}) {
  const heading = to ? (
    <Link className="hover:underline" to={to}>
      {title}
    </Link>
  ) : (
    title
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {badge ? (
          <CardAction>
            <Badge variant="secondary">{badge}</Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      {children ? <CardContent className="flex flex-col gap-3">{children}</CardContent> : null}
      {actions ? <CardContent className="flex flex-wrap gap-2">{actions}</CardContent> : null}
    </Card>
  )
}

export function EmptyList({ message, description }: { message: string; description?: string }) {
  return <EmptyState message={message} description={description} />
}
