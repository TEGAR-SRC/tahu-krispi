// Helpers shared by the admin billing DETAIL pages (OrderDetail, InvoiceDetail,
// CouponDetail, OrgWallet, ProductDetail, PlanPrices). Kept next to the pages
// they serve: src/components/shared only carries generic blocks and ./shared
// belongs to the list pages.
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { apiGet } from "@/lib/api"

// ---- Breadcrumbs -------------------------------------------------------------

export interface Crumb {
  label: string
  /** When set the crumb renders as a link (list pages higher up the trail). */
  to?: string
}

/** Breadcrumb trail every detail page opens with; the last entry is the page. */
export function DetailBreadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              <BreadcrumbItem>
                {isLast || !crumb.to ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast ? <BreadcrumbSeparator /> : null}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

// ---- Field display -------------------------------------------------------------

/** Label/value pair used through the detail summaries. */
export function DetailField({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-medium">{value}</span>
    </div>
  )
}

// ---- Single-resource fetch hook -------------------------------------------------

export interface ApiDetail<T> {
  data: T | null
  loading: boolean
  error: unknown
  reload: () => void
}

/** Fetches one resource for a detail page; re-fetches when `path` or the
 * serialized headers change (e.g. X-Organization-ID for wallet reads). */
export function useApiDetail<T>(
  path: string | null,
  headers: Record<string, string> = {},
): ApiDetail<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)
  // Only the serialized form goes into the effect deps so an inline literal
  // header object does not retrigger the fetch every render.
  const headerKey = JSON.stringify(headers)

  useEffect(() => {
    if (!path) {
      const t = setTimeout(() => {
        setLoading(false)
        setError(new Error("No identifier in route."))
      }, 0)
      return () => clearTimeout(t)
    }
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      apiGet<T>(path, { headers: JSON.parse(headerKey) as Record<string, string> })
        .then((envelope) => {
          if (cancelled) return
          setData(envelope.data)
          setLoading(false)
        })
        .catch((cause: unknown) => {
          if (cancelled) return
          setError(cause)
          setLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [path, headerKey, tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { data, loading, error, reload }
}
