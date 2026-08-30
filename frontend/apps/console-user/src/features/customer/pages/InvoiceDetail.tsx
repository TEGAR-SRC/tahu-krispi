// Invoice detail: line items, totals, PDF download when generated, and the
// two payment paths — wallet balance or an external gateway payment that
// answers with a checkout URL.
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeftIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  WalletIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatDateTime, formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  subtotal: number
  tax_amount: number
  total: number
}

interface InvoiceDetailData {
  id: string
  public_id: string
  invoice_number: string
  currency: string
  subtotal: number
  discount: number
  tax: number
  total: number
  amount_paid: number
  amount_due: number
  status: string
  issued_at?: string | null
  due_at?: string | null
  paid_at?: string | null
  created_at: string
  pdf_url?: string
  items: InvoiceItem[]
}

interface PaymentResult {
  id: string
  public_id: string
  status: string
  checkout_url: string
}

// Same methods the wallet top-up flow offers.
const PAYMENT_METHODS = ["bank_transfer", "va", "ewallet", "credit_card"] as const

const normalizeCheckoutUrl = (url: string) =>
  url
    .replace("https://payment.kilat-cloud.com/topup/", "https://pay.sumopod.com/pay/")
    .replace("https://payment.kilat-cloud.com", "https://pay.sumopod.com")
    .replace("http://payment.kilat-cloud.com", "https://pay.sumopod.com")

// Statuses where paying more makes no sense.
const SETTLED = new Set(["paid", "void", "refunded"])

export default function CustomerInvoiceDetailPage() {
  const { invoiceId } = useParams()
  const navigate = useNavigate()
  const { orgId } = useOrg()
  const [invoice, setInvoice] = useState<InvoiceDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [payWalletOpen, setPayWalletOpen] = useState(false)
  const [payingWallet, setPayingWallet] = useState(false)
  const [externalOpen, setExternalOpen] = useState(false)
  const [method, setMethod] = useState<string>("bank_transfer")
  const [creatingPayment, setCreatingPayment] = useState(false)
  const [payment, setPayment] = useState<PaymentResult | null>(null)

  const load = useCallback(async () => {
    if (!orgId || !invoiceId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<InvoiceDetailData>(`/invoices/${invoiceId}`, {
        headers: orgHeaders(orgId),
      })
      setInvoice(data)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId, invoiceId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const payWithWallet = async () => {
    if (!invoice) return
    setPayingWallet(true)
    try {
      await apiPost(`/invoices/${invoice.id}/pay-wallet`, {}, { headers: orgHeaders(orgId) })
      toast.success("Invoice paid from wallet")
      setPayWalletOpen(false)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Wallet payment failed")
    } finally {
      setPayingWallet(false)
    }
  }

  const createExternalPayment = async () => {
    if (!invoice) return
    setCreatingPayment(true)
    try {
      const { data } = await apiPost<PaymentResult>(
        `/invoices/${invoice.id}/payments`,
        { method },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Payment created — complete it at the checkout URL")
      setPayment(data)
      setExternalOpen(false)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create payment")
    } finally {
      setCreatingPayment(false)
    }
  }

  const itemColumns: Array<SimpleColumn<InvoiceItem>> = [
    { key: "description", header: "Description" },
    {
      key: "quantity",
      header: "Qty × unit",
      render: (row) => (
        <span className="tabular-nums">
          {row.quantity} × {formatMoney(row.unit_price, invoice?.currency)}
        </span>
      ),
    },
    {
      key: "tax_amount",
      header: "Tax",
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {formatMoney(row.tax_amount, invoice?.currency)}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      render: (row) => (
        <span className="tabular-nums font-medium">{formatMoney(row.total, invoice?.currency)}</span>
      ),
    },
  ]

  if (!loading && error && !invoice) {
    return (
      <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/app/invoices">Invoices</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{invoiceId}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <ErrorBanner error={error} />
        <Button variant="outline" className="w-fit" onClick={() => navigate("/app/invoices")}>
          <ArrowLeftIcon /> Back to invoices
        </Button>
      </div>
    )
  }

  const payable =
    invoice !== null &&
    !SETTLED.has(invoice.status) &&
    invoice.status !== "draft" &&
    invoice.amount_due > 0

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/app/invoices">Invoices</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{invoice?.invoice_number || invoice?.public_id || invoiceId}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={invoice ? `Invoice ${invoice.invoice_number || invoice.public_id}` : "Invoice"}
        description={
          invoice
            ? `Issued ${formatDateTime(invoice.issued_at ?? invoice.created_at)}${
                invoice.due_at ? ` · due ${formatDateTime(invoice.due_at)}` : ""
              }`
            : undefined
        }
        actions={
          <>
            {invoice?.pdf_url ? (
              <Button asChild variant="outline">
                <a href={invoice.pdf_url} target="_blank" rel="noopener noreferrer">
                  <DownloadIcon /> PDF
                </a>
              </Button>
            ) : null}
            {payable && invoice ? (
              <>
                <Button variant="outline" onClick={() => setExternalOpen(true)}>
                  <ExternalLinkIcon /> Pay via gateway
                </Button>
                <Button onClick={() => setPayWalletOpen(true)}>
                  <WalletIcon /> Pay with wallet ({formatMoney(invoice.amount_due, invoice.currency)})
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <ErrorBanner error={error} />

      {loading || !invoice ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          {/* Resulting external payment banner */}
          {payment ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <span>
                Payment <strong className="font-mono">{payment.public_id}</strong> is{" "}
                <StatusBadge status={payment.status} className="align-middle" /> — open the checkout
                to complete it; the invoice settles once the gateway webhook confirms.
              </span>
              <Button asChild size="sm" variant="outline">
                <a href={normalizeCheckoutUrl(payment.checkout_url)} target="_blank" rel="noopener noreferrer">
                  Open checkout <ExternalLinkIcon />
                </a>
              </Button>
            </div>
          ) : null}

          <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCell label="Status" value={<StatusBadge status={invoice.status} />} />
            <SummaryCell label="Total" value={formatMoney(invoice.total, invoice.currency)} strong />
            <SummaryCell label="Paid" value={formatMoney(invoice.amount_paid, invoice.currency)} />
            <SummaryCell label="Amount due" value={formatMoney(invoice.amount_due, invoice.currency)} strong />
            <SummaryCell label="Subtotal" value={formatMoney(invoice.subtotal, invoice.currency)} />
            <SummaryCell label="Discount" value={formatMoney(invoice.discount, invoice.currency)} />
            <SummaryCell label="Tax" value={formatMoney(invoice.tax, invoice.currency)} />
            <SummaryCell
              label="Paid at"
              value={<span className="text-sm">{formatDateTime(invoice.paid_at)}</span>}
            />
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Line items</h2>
            <SimpleDataTable
              columns={itemColumns}
              rows={invoice.items}
              emptyMessage="No line items on this invoice."
              getRowKey={(row) => row.id}
            />
          </section>
        </>
      )}

      {/* Wallet payment confirm */}
      <AlertDialog open={payWalletOpen} onOpenChange={setPayWalletOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pay this invoice from your wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              {invoice
                ? `${formatMoney(invoice.amount_due, invoice.currency)} is deducted immediately. The payment fails if the balance is insufficient.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={payingWallet}
              onClick={(event) => {
                event.preventDefault()
                void payWithWallet()
              }}
            >
              {payingWallet ? <Loader2Icon className="animate-spin" /> : null} Pay now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* External gateway payment */}
      <Dialog open={externalOpen} onOpenChange={(open) => !creatingPayment && setExternalOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create gateway payment</DialogTitle>
            <DialogDescription>
              A pending payment for the outstanding amount is created and you receive a checkout
              URL.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Method</p>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((item) => (
                  <SelectItem key={item} value={item} className="capitalize">
                    {item.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExternalOpen(false)} disabled={creatingPayment}>
              Cancel
            </Button>
            <Button onClick={() => void createExternalPayment()} disabled={creatingPayment}>
              {creatingPayment ? <Loader2Icon className="animate-spin" /> : null} Create payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryCell({
  label,
  value,
  strong = false,
}: {
  label: string
  value: ReactNode
  strong?: boolean
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className={`mt-1 ${strong ? "text-xl font-semibold tabular-nums" : "text-base font-medium tabular-nums"}`}>
        {value}
      </div>
    </div>
  )
}
