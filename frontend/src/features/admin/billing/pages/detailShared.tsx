// Helpers shared by the admin billing DETAIL pages (OrderDetail, InvoiceDetail,
// CouponDetail, OrgWallet, ProductDetail, PlanPrices). Kept next to the pages
// they serve: src/components/shared only carries generic blocks and ./shared
// belongs to the list pages.
import { Fragment, type ReactNode } from "react"
import { Link } from "react-router-dom"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

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
