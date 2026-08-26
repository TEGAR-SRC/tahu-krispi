import { useCallback, useEffect, useState } from "react"
import { apiDelete, apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { StatCard } from "@/components/shared/StatCard"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Loader2Icon, ShieldAlertIcon, ShieldBanIcon, CircleCheckIcon } from "lucide-react"
import {
  type BlockedNetwork,
  type SecurityIncident,
  StatusBadge,
  fmtDateTime,
  toastApiError,
} from "../lib"

interface IncidentRow extends SecurityIncident {
  id: string
  user_email: string
  org_slug: string
  type: string
  severity: string
  status: string
  description: string
  created_at: string
  resolved_at: string
}

const CIDR_PATTERN =
  /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^([0-9a-fA-F:]+)\/\d{1,3}$/

export default function NocSecurityPage() {
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [incidentTotal, setIncidentTotal] = useState(0)
  const [incidentsLoading, setIncidentsLoading] = useState(true)
  const [incidentsError, setIncidentsError] = useState<unknown>(null)

  const [networks, setNetworks] = useState<BlockedNetwork[]>([])
  const [networksLoading, setNetworksLoading] = useState(true)
  const [networksError, setNetworksError] = useState<unknown>(null)

  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [confirmResolve, setConfirmResolve] = useState<IncidentRow | null>(null)

  const [newCidr, setCidr] = useState("")
  const [newReason, setNewReason] = useState("")
  const [cidrInvalid, setCidrInvalid] = useState(false)
  const [addingNetwork, setAddingNetwork] = useState(false)
  const [confirmUnblock, setConfirmUnblock] = useState<BlockedNetwork | null>(null)
  const [deletingNetwork, setDeletingNetwork] = useState<BlockedNetwork | null>(null)

  const load = useCallback(async () => {
    setIncidentsLoading(true)
    setNetworksLoading(true)
    try {
      const envelope = await apiGet<IncidentRow[]>("/admin/security-incidents", {
        query: { page: 1, per_page: 50 },
      })
      setIncidents(envelope.data)
      setIncidentTotal(envelope.meta?.total ?? envelope.data.length)
      setIncidentsError(null)
    } catch (cause) {
      setIncidentsError(cause)
    } finally {
      setIncidentsLoading(false)
    }
    try {
      const envelope = await apiGet<BlockedNetwork[]>("/admin/blocked-networks", {
        query: { page: 1, per_page: 100 },
      })
      setNetworks(envelope.data)
      setNetworksError(null)
    } catch (cause) {
      setNetworksError(cause)
    } finally {
      setNetworksLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const resolveIncident = useCallback(
    async (incident: IncidentRow) => {
      setResolvingId(incident.id)
      try {
        await apiPost(`/admin/security-incidents/${incident.id}/resolve`)
        toast.success("Incident resolved")
        setConfirmResolve(null)
        await load()
      } catch (cause) {
        toastApiError(cause, "Could not resolve the incident")
      } finally {
        setResolvingId(null)
      }
    },
    [load],
  )

  const addNetwork = useCallback(async () => {
    const cidr = newCidr.trim()
    const reason = newReason.trim()
    if (!CIDR_PATTERN.test(cidr)) {
      setCidrInvalid(true)
      return
    }
    if (!reason) return
    setAddingNetwork(true)
    try {
      await apiPost("/admin/blocked-networks", { cidr, reason })
      toast.success(`${cidr} blocked`)
      setCidr("")
      setNewReason("")
      setCidrInvalid(false)
      await load()
    } catch (cause) {
      toastApiError(cause, "Could not block the network")
    } finally {
      setAddingNetwork(false)
    }
  }, [newCidr, newReason, load])

  const removeNetwork = useCallback(
    async (network: BlockedNetwork) => {
      setDeletingNetwork(network)
      try {
        await apiDelete(`/admin/blocked-networks/${network.id}`)
        toast.success(`${network.network} unblocked`)
        setConfirmUnblock(null)
        await load()
      } catch (cause) {
        toastApiError(cause, "Could not unblock the network")
      } finally {
        setDeletingNetwork(null)
      }
    },
    [load],
  )

  const openIncidents = incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed").length

  const incidentColumns: Array<SimpleColumn<IncidentRow>> = [
    { key: "type", header: "Type", render: (row) => <span className="font-medium">{row.type}</span> },
    {
      key: "severity",
      header: "Severity",
      render: (row) => <StatusBadge status={row.severity} />,
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "description",
      header: "Description",
      render: (row) => (
        <span className="block max-w-72 truncate text-sm" title={row.description}>
          {row.description || "—"}
        </span>
      ),
    },
    { key: "user_email", header: "User", render: (row) => row.user_email || "—" },
    { key: "org_slug", header: "Organization", render: (row) => row.org_slug || "—" },
    { key: "created_at", header: "Detected", render: (row) => fmtDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-16",
      render: (row) =>
        row.status === "resolved" || row.status === "dismissed" ? null : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Resolve incident ${row.type}`}
            disabled={resolvingId !== null}
            onClick={() => setConfirmResolve(row)}
          >
            {resolvingId === row.id ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <CircleCheckIcon />
            )}
          </Button>
        ),
    },
  ]

  const networkColumns: Array<SimpleColumn<BlockedNetwork>> = [
    { key: "network", header: "Network", render: (row) => <span className="font-mono text-sm">{row.network}</span> },
    {
      key: "reason",
      header: "Reason",
      render: (row) => (
        <span className="block max-w-80 truncate text-sm" title={row.reason}>
          {row.reason || "—"}
        </span>
      ),
    },
    { key: "expires_at", header: "Expires", render: (row) => fmtDateTime(row.expires_at) },
    { key: "created_by", header: "Created by", render: (row) => (
      <span className="font-mono text-xs">{row.created_by ? `${row.created_by.slice(0, 8)}…` : "—"}</span>
    ) },
    { key: "created_at", header: "Blocked at", render: (row) => fmtDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-16",
      render: (row) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Unblock ${row.network}`}
          disabled={deletingNetwork !== null}
          onClick={() => setConfirmUnblock(row)}
        >
          {deletingNetwork?.id === row.id ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <ShieldBanIcon />
          )}
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security"
        description="Security incidents and network blocking. Audit logs are platform-admin only."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Open incidents"
          value={openIncidents}
          hint={`${incidentTotal} recorded in total`}
          icon={<ShieldAlertIcon />}
        />
        <StatCard
          label="Blocked networks"
          value={networks.length}
          hint="active firewall blocks"
          icon={<ShieldBanIcon />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Security incidents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SimpleDataTable
            columns={incidentColumns}
            rows={incidents}
            loading={incidentsLoading}
            error={incidentsError}
            skeletonRows={5}
            emptyMessage="No security incidents recorded — all quiet."
            getRowKey={(row) => row.id}
          />
          <p className="text-xs text-muted-foreground">
            Showing up to 50 most recent of {incidentTotal}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Blocked networks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1.5fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              void addNetwork()
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="block-cidr">CIDR</Label>
              <Input
                id="block-cidr"
                placeholder="203.0.113.0/24"
                value={newCidr}
                onChange={(event) => {
                  setCidr(event.target.value)
                  setCidrInvalid(false)
                }}
                aria-invalid={cidrInvalid}
                required
              />
              {cidrInvalid ? (
                <p className="text-xs text-destructive">Must be a valid CIDR like 203.0.113.0/24.</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="block-reason">Reason</Label>
              <Input
                id="block-reason"
                placeholder="why is this range blocked?"
                value={newReason}
                onChange={(event) => setNewReason(event.target.value)}
                required
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={addingNetwork}>
                {addingNetwork ? <Loader2Icon className="animate-spin" /> : <ShieldBanIcon />}
                Block network
              </Button>
            </div>
          </form>

          <SimpleDataTable
            columns={networkColumns}
            rows={networks}
            loading={networksLoading}
            error={networksError}
            skeletonRows={4}
            emptyMessage="No networks are currently blocked."
            getRowKey={(row) => row.id}
          />
        </CardContent>
      </Card>

      {/* Resolve confirmation */}
      <AlertDialog open={confirmResolve !== null} onOpenChange={(open) => !open && setConfirmResolve(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve this incident?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmResolve
                ? `The ${confirmResolve.type} incident will be marked resolved and leave the open queue.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (confirmResolve) void resolveIncident(confirmResolve)
              }}
            >
              {resolvingId ? <Loader2Icon className="animate-spin" /> : null}
              Resolve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unblock confirmation */}
      <AlertDialog open={confirmUnblock !== null} onOpenChange={(open) => !open && setConfirmUnblock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock {confirmUnblock?.network}?</AlertDialogTitle>
            <AlertDialogDescription>
              Traffic from this range will be allowed again immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (confirmUnblock) void removeNetwork(confirmUnblock)
              }}
            >
              {deletingNetwork ? <Loader2Icon className="animate-spin" /> : null}
              Unblock network
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
