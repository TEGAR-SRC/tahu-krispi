// Network blocklist (GET/POST/DELETE /admin/blocked-networks). POST takes
// {cidr, reason} — both validated client-side (reason is required server-side;
// CIDR is parsed with net.ParseCIDR) and the API's field errors are surfaced
// verbatim when it still rejects. Deletion asks for confirmation.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PagedMeta } from "@/lib/types"
import { PaginationBar } from "../shared"
import { formatDateTime } from "../format"

interface BlockedNetworkRow {
  id: string
  network: string
  reason: string
  expires_at: string
  created_by: string
  created_at: string
}

const PER_PAGE = 20

/** Strict IPv4 CIDR; IPv6 falls through to a loose addr/prefix shape check. */
const IPV4_CIDR =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(3[0-2]|[12]?\d)$/

function validateCidr(raw: string): string | null {
  const value = raw.trim()
  if (value === "") return "CIDR network is required"
  if (IPV4_CIDR.test(value)) return null
  // Loose check for IPv6 or unusual input; the backend stays authoritative.
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) {
    return "Use CIDR notation, e.g. 203.0.113.0/24"
  }
  return null
}

export default function BlockedNetworksPage() {
  const [rows, setRows] = useState<BlockedNetworkRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [cidr, setCidr] = useState("")
  const [cidrFieldError, setCidrFieldError] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [adding, setAdding] = useState(false)

  const [deleting, setDeleting] = useState<BlockedNetworkRow | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<BlockedNetworkRow[]>("/admin/blocked-networks", {
      query: { page, per_page: PER_PAGE },
    })
      .then((envelope) => {
        if (cancelled) return
        setRows(envelope.data)
        setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, reloadTick])

  const addNetwork = useCallback(async () => {
    const cidrProblem = validateCidr(cidr)
    setCidrFieldError(cidrProblem)
    if (cidrProblem) return
    if (reason.trim() === "") {
      toast.error("A reason is required")
      return
    }
    setAdding(true)
    try {
      await apiPost("/admin/blocked-networks", {
        cidr: cidr.trim(),
        reason: reason.trim(),
      })
      toast.success("Network blocked")
      setCidr("")
      setReason("")
      setCidrFieldError(null)
      setPage(1)
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      if (cause instanceof ApiError) {
        const fields = cause.details as Record<string, string> | undefined
        if (fields && typeof fields.cidr === "string") {
          setCidrFieldError(fields.cidr)
        }
        toast.error(cause.message)
      } else {
        toast.error("Failed to block network")
      }
    } finally {
      setAdding(false)
    }
  }, [cidr, reason])

  const deleteNetwork = useCallback(async () => {
    if (!deleting) return
    try {
      await apiDelete(`/admin/blocked-networks/${deleting.id}`)
      toast.success("Network unblocked")
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to unblock network")
    } finally {
      setDeleting(null)
    }
  }, [deleting])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Blocked networks"
        description="CIDR ranges denied at the edge (e.g. repeated abuse sources)."
      />

      {/* Add form */}
      <section className="space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Block a network</h2>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] sm:items-start">
          <div className="space-y-1.5">
            <Label htmlFor="blocked-cidr">CIDR network</Label>
            <Input
              id="blocked-cidr"
              placeholder="203.0.113.0/24"
              className="font-mono"
              value={cidr}
              aria-invalid={cidrFieldError !== null}
              onChange={(event) => {
                setCidr(event.target.value)
                setCidrFieldError(null)
              }}
            />
            {cidrFieldError ? (
              <p className="text-xs text-destructive">{cidrFieldError}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blocked-reason">Reason</Label>
            <Input
              id="blocked-reason"
              placeholder="Why this range is blocked (required)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <Button disabled={adding} onClick={() => void addNetwork()} className="sm:mt-6">
            {adding ? "Blocking…" : "Block"}
          </Button>
        </div>
      </section>

      <SimpleDataTable<BlockedNetworkRow>
        columns={[
          {
            key: "network",
            header: "Network",
            render: (row) => (
              <span className="font-mono text-sm">{row.network}</span>
            ),
          },
          {
            key: "reason",
            header: "Reason",
            render: (row) => (
              <span className="line-clamp-1 text-muted-foreground" title={row.reason}>
                {row.reason || "—"}
              </span>
            ),
          },
          {
            key: "expires_at",
            header: "Expires",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">
                {row.expires_at ? formatDateTime(row.expires_at) : "never"}
              </span>
            ),
          },
          {
            key: "created_by",
            header: "Blocked by",
            className: "hidden xl:table-cell",
            render: (row) => (
              <span className="font-mono text-xs text-muted-foreground">
                {row.created_by || "—"}
              </span>
            ),
          },
          {
            key: "created_at",
            header: "Created",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "w-24 text-right",
            render: (row) => (
              <Button variant="destructive" size="sm" onClick={() => setDeleting(row)}>
                Unblock
              </Button>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No networks are blocked."
        skeletonRows={6}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock {deleting?.network}?</AlertDialogTitle>
            <AlertDialogDescription>
              Traffic from this range will be allowed again immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              onClick={() => void deleteNetwork()}
            >
              Unblock network
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
