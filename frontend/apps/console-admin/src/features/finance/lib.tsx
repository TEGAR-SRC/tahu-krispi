// Shared helpers for the finance console: money/date formatting built on the
// API's own currency fields, DB timestamp parsing, status badges and a small
// pagination control for paged admin lists.
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import type { PagedMeta } from "@/lib/types"
import { formatNumber } from "./lib-utils"

const STATUS_TONES: Record<string, string> = {
  paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  credit: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  processing: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  pending_payment: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  unpaid: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  overdue: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  draft: "border-border bg-muted text-muted-foreground",
  void: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  cancelled: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  expired: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  failed: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  debit: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
}

/** Colored badge for billing statuses with sensible fallback tones. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const tone = STATUS_TONES[status]
  return (
    <Badge variant="outline" className={tone ?? "border-border bg-muted text-muted-foreground"}>
      {status.replaceAll("_", " ")}
    </Badge>
  )
}

interface FilterChipsProps<T extends string> {
  options: readonly T[]
  value: T | "all"
  onChange: (value: T | "all") => void
  allLabel?: string
}

/** Row of toggle chips used for status filters above tables. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  allLabel = "All",
}: FilterChipsProps<T>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        variant={value === "all" ? "default" : "outline"}
        onClick={() => onChange("all")}
      >
        {allLabel}
      </Button>
      {options.map((option) => (
        <Button
          key={option}
          size="sm"
          variant={value === option ? "default" : "outline"}
          onClick={() => onChange(option)}
          className="capitalize"
        >
          {option.replaceAll("_", " ")}
        </Button>
      ))}
    </div>
  )
}

interface TablePaginationProps {
  meta?: (PagedMeta & Record<string, unknown>) | null
  onPageChange: (page: number) => void
}

/** Prev/next pager driven by the backend's `meta.page/per_page/total`. */
export function TablePagination({ meta, onPageChange }: TablePaginationProps) {
  if (!meta || typeof meta.page !== "number" || typeof meta.per_page !== "number") return null
  const page = meta.page
  const perPage = meta.per_page
  const total = typeof meta.total === "number" ? meta.total : undefined
  const lastPage =
    total !== undefined && perPage > 0 ? Math.max(Math.ceil(total / perPage), 1) : undefined
  const hasNext = lastPage !== undefined ? page < lastPage : true

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Page {page}
        {lastPage !== undefined ? ` of ${lastPage}` : ""}
        {total !== undefined ? ` · ${formatNumber(total)} rows` : ""}
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext}
          onClick={() => onPageChange(page + 1)}
        >
          Next <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )
}

/** Renders a label/value pair inside detail dialogs. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium break-all">{children}</span>
    </div>
  )
}

// ---- Shared admin billing row shapes (verified against live API) ----------

export interface AdminOrderRow {
  id: string
  public_id: string
  organization_id: string
  org_public_id: string
  org_slug: string
  currency: string
  subtotal: number
  discount: number
  tax: number
  total: number
  status: string
  created_at: string
  completed_at: string
  cancelled_at: string
}

export interface OrderItem {
  id: string
  service_kind?: string
  description: string
  quantity: number
  unit_price: number
  subtotal: number
  billing_period?: string
  resource_config?: Record<string, unknown>
}

export interface OrderInvoiceRef {
  id: string
  public_id: string
  status: string
  total: number
  amount_due: number
}

export interface AdminOrderDetail extends AdminOrderRow {
  created_by?: string
  quote_id?: string
  coupon_id?: string
  metadata: Record<string, unknown>
  updated_at?: string
  items: OrderItem[]
  invoices: OrderInvoiceRef[]
  coupon_redemption?: { code: string; discount_amount: number } | null
  quote?: {
    id: string
    price_mode: string
    subtotal: number
    tax: number
    total: number
    expires_at?: string
    pricing_breakdown?: Array<{ amount: number; [key: string]: unknown }>
  } | null
}

export interface AdminInvoiceRow {
  id: string
  public_id: string
  invoice_number: string
  organization_id: string
  org_public_id: string
  org_slug: string
  currency: string
  subtotal: number
  discount: number
  tax: number
  total: number
  amount_paid: number
  amount_due: number
  status: string
  issued_at: string
  due_at: string
  paid_at: string
  voided_at: string
  created_at: string
}

export interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  subtotal: number
  tax_amount: number
  total: number
  metadata: Record<string, unknown>
}

export interface PaymentEvent {
  id?: string
  status?: string
  provider?: string
  amount?: number
  currency?: string
  created_at?: string
  [key: string]: unknown
}

export interface AdminInvoiceDetail extends AdminInvoiceRow {
  items: InvoiceItem[]
  payments: Array<Record<string, unknown>>
  payment_events: PaymentEvent[]
}

export interface AdminPaymentRow {
  id: string
  public_id: string
  organization_id: string
  org_public_id: string
  org_slug: string
  invoice_id: string | null
  provider: string
  method: string
  external_reference: string
  currency: string
  amount: number
  fee: number
  status: string
  paid_at: string
  created_at: string
}

export interface FinanceSummaryData {
  period_days: number
  invoices: { paid_count: number; paid_total: number }
  outstanding: { count: number; total: number }
  topups: { paid_count: number; paid_total: number }
  wallet_balance_total: number
  mrr_active: number
}

/** Currency carried by a wallet/balance endpoint response. */
export interface OrgWallet {
  wallet_id: string
  organization_id: string
  currency: string
  balance: number
  reserved_balance: number
}
