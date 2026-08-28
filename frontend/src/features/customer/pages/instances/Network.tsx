// Instance networking: reverse DNS entries (create/list/wildcard delete),
// BGP enable/disable, and a shortcut to anchor organization reserved IPs on
// this instance (PATCH /reserved-ips/:rip_id {anchor_ip}).
import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { GlobeIcon, Loader2Icon, NetworkIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api"
import { orgHeaders, useOrg } from "../../useOrg"
import {
  InstanceBreadcrumb,
  useInstance,
  type InstanceDetail,
  type RdnsEntry,
} from "./shared"

interface ReservedIp {
  id: string
  name?: string
  ip_addr?: string
  status?: string
  attachment?: { id: string; name: string } | null
}

export default function InstanceNetworkPage() {
  const { instanceId } = useParams()
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <NetworkContent instanceId={instanceId} />
    </div>
  )
}

function NetworkContent({ instanceId }: { instanceId: string | undefined }) {
  const { instance } = useInstance(instanceId)
  return (
    <>
      <InstanceBreadcrumb instanceName={instance?.name} section="Network" />
      <PageHeader
        title="Network"
        description="Reverse DNS, BGP sessions and reserved IP anchoring for this instance."
      />
      <RdnsCard instanceId={instanceId} />
      <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-2">
        <BgpCard instanceId={instanceId} />
        <ReservedIpsCard instance={instance} />
      </div>
    </>
  )
}

// ---- Reverse DNS ---------------------------------------------------------------

function RdnsCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  const [entries, setEntries] = useState<RdnsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [ipAddr, setIpAddr] = useState("")
  const [domain, setDomain] = useState("")
  const [adding, setAdding] = useState(false)
  const [deleteIp, setDeleteIp] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!instanceId || !orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<RdnsEntry[]>(`/instances/${instanceId}/rdns`, {
        headers: orgHeaders(orgId),
      })
      setEntries(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [instanceId, orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const addEntry = async () => {
    if (!instanceId || !orgId) return
    if (!ipAddr.trim() || !domain.trim()) {
      toast.error("Both the IP address and the domain are required")
      return
    }
    setAdding(true)
    try {
      await apiPost(
        `/instances/${instanceId}/rdns`,
        { ip_addr: ipAddr.trim(), domain: domain.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Reverse DNS entry set")
      setIpAddr("")
      setDomain("")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to set reverse DNS")
    } finally {
      setAdding(false)
    }
  }

  const runDelete = async () => {
    if (!deleteIp || !instanceId || !orgId) return
    try {
      // The wildcard path segment carries the "ip/prefix" value.
      await apiDelete(`/instances/${instanceId}/rdns/${encodeURIComponent(deleteIp)}`, {
        headers: orgHeaders(orgId),
      })
      toast.success(`Reverse DNS for ${deleteIp} removed`)
      setDeleteIp(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete entry")
    }
  }

  const columns: Array<SimpleColumn<RdnsEntry>> = [
    {
      key: "ip",
      header: "Address",
      render: (row) => <span className="font-mono text-sm">{row.ip}</span>,
    },
    {
      key: "domain",
      header: "PTR record",
      render: (row) => <span className="font-mono text-sm">{row.domain}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-16",
      render: (row) => (
        <Button
          size="icon"
          variant="ghost"
          title={`Delete ${row.ip}…`}
          onClick={() => setDeleteIp(row.ip)}
        >
          <Trash2Icon />
        </Button>
      ),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reverse DNS</CardTitle>
        <CardDescription>
          One PTR record per address; the API returns addresses with their prefix length.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SimpleDataTable
          columns={columns}
          rows={entries}
          loading={loading}
          error={error}
          skeletonRows={3}
          emptyMessage="No reverse DNS entries yet."
          getRowKey={(row) => row.ip}
        />

        <div className="flex flex-wrap items-end gap-2 border-t pt-4">
          <div className="space-y-1">
            <Label htmlFor="rdns-ip">IP address *</Label>
            <Input
              id="rdns-ip"
              className="w-52 font-mono"
              value={ipAddr}
              onChange={(event) => setIpAddr(event.target.value)}
              placeholder="203.0.113.10"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rdns-domain">Domain *</Label>
            <Input
              id="rdns-domain"
              className="w-64 font-mono"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="host.example.com"
            />
          </div>
          <Button onClick={() => void addEntry()} disabled={adding}>
            {adding ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Set record
          </Button>
        </div>

        <AlertDialog open={deleteIp !== null} onOpenChange={(open) => !open && setDeleteIp(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove PTR for {deleteIp}?</AlertDialogTitle>
              <AlertDialogDescription>
                Lookups will fall back to the provider default until a new record is set.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-primary-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  event.preventDefault()
                  void runDelete()
                }}
              >
                Remove record
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

// ---- BGP -------------------------------------------------------------------------

function BgpCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  /** Unknown until an action runs — the API exposes no read-back endpoint. */
  const [state, setState] = useState<"unknown" | "enabled" | "disabled">("unknown")
  const [busy, setBusy] = useState<"enable-bgp" | "disable-bgp" | null>(null)
  const [confirm, setConfirm] = useState<"enable-bgp" | "disable-bgp" | null>(null)

  const runBgp = async (action: "enable-bgp" | "disable-bgp") => {
    if (!instanceId || !orgId) return
    setBusy(action)
    try {
      const { data } = await apiPost<{ status?: string }>(
        `/instances/${instanceId}/${action}`,
        {},
        { headers: orgHeaders(orgId) },
      )
      const next =
        data?.status === "enabled" || data?.status === "disabled"
          ? data.status
          : action === "enable-bgp"
            ? "enabled"
            : "disabled"
      setState(next)
      toast.success(`BGP ${next}`)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : `Failed to ${action.replace("-bgp", "")} BGP`)
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>BGP session</CardTitle>
        <CardDescription>
          Advertise this instance's addresses over BGP. The console cannot read the current
          state back — the last action you performed here is shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          Session status:{" "}
          <span className="font-medium capitalize">{state}</span>
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => setConfirm("enable-bgp")}
          >
            <GlobeIcon /> Enable BGP…
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => setConfirm("disable-bgp")}
          >
            Disable BGP…
          </Button>
        </div>

        <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirm === "enable-bgp" ? "Enable" : "Disable"} BGP?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirm === "enable-bgp"
                  ? "The provider starts advertising your assigned space towards this instance."
                  : "Routes announced by this session will be withdrawn."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy !== null}
                onClick={(event) => {
                  event.preventDefault()
                  if (confirm) void runBgp(confirm)
                }}
              >
                {busy ? <Loader2Icon className="animate-spin" /> : null}{" "}
                {confirm === "enable-bgp" ? "Enable" : "Disable"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

// ---- Reserved IPs ----------------------------------------------------------------

const ATTACH_HINT =
  "Anchoring routes a reserved IP to this instance's primary address via PATCH /reserved-ips/:id."

function ReservedIpsCard({ instance }: { instance: InstanceDetail | null }) {
  const { orgId } = useOrg()
  const [ips, setIps] = useState<ReservedIp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<ReservedIp[]>("/reserved-ips", {
        headers: orgHeaders(orgId),
      })
      setIps(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const anchorIp = instance?.primary_ipv4 || ""

  const attach = async (rip: ReservedIp) => {
    if (!orgId || !anchorIp) return
    setBusyId(rip.id)
    try {
      await apiPatch(
        `/reserved-ips/${rip.id}`,
        { anchor_ip: anchorIp },
        { headers: orgHeaders(orgId) },
      )
      toast.success(`${rip.ip_addr ?? rip.id} anchored to ${anchorIp}`)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to anchor reserved IP")
    } finally {
      setBusyId(null)
    }
  }

  const detach = async (rip: ReservedIp) => {
    if (!orgId) return
    setBusyId(rip.id)
    try {
      await apiPatch(
        `/reserved-ips/${rip.id}`,
        { anchor_ip: null },
        { headers: orgHeaders(orgId) },
      )
      toast.success(`${rip.ip_addr ?? rip.id} detached`)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to detach reserved IP")
    } finally {
      setBusyId(null)
    }
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reserved IPs</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorBanner error={error} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <NetworkIcon className="size-4" /> Reserved IPs
        </CardTitle>
        <CardDescription>{ATTACH_HINT}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading reserved IPs…</p>
        ) : ips.length === 0 ? (
          <EmptyState message="No reserved IPs in this organization." />
        ) : !anchorIp ? (
          <EmptyState
            message="This instance has no primary IPv4 yet."
            description="Reserved IPs can only be anchored once the instance has an address."
          />
        ) : (
          <ul className="space-y-2">
            {ips.map((rip) => {
              const attachedHere = rip.attachment?.id === instance?.id
              return (
                <li
                  key={rip.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="min-w-0 truncate font-mono text-sm">{rip.ip_addr ?? rip.id}</p>
                    <p className="min-w-0 truncate text-xs text-muted-foreground">
                      {rip.name ? `${rip.name} · ` : ""}
                      {rip.status ?? "—"}
                      {rip.attachment
                        ? attachedHere
                          ? " · attached to this instance"
                          : ` · attached to ${rip.attachment.name}`
                        : " · unattached"}
                    </p>
                  </div>
                  {attachedHere ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === rip.id}
                      onClick={() => void detach(rip)}
                    >
                      {busyId === rip.id ? <Loader2Icon className="animate-spin" /> : null}
                      Detach
                    </Button>
                  ) : !rip.attachment ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === rip.id || !anchorIp}
                      onClick={() => void attach(rip)}
                    >
                      {busyId === rip.id ? <Loader2Icon className="animate-spin" /> : null}
                      Anchor here
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">in use elsewhere</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
