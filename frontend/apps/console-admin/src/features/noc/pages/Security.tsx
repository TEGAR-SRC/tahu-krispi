import { useCallback, useEffect, useMemo, useState } from "react"
import { apiDelete, apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { StatCard } from "@/components/shared/StatCard"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import {
  Loader2Icon,
  ShieldAlertIcon,
  ShieldBanIcon,
  CircleCheckIcon,
  KeyRoundIcon,
  TriangleAlertIcon,
} from "lucide-react"
import {
  type BlockedNetwork,
  type Provider,
  type SecurityIncident,
  StatusBadge,
} from "../lib"
import { fmtDateTime, toastApiError } from "../lib-utils"

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

// ---- Certificate expiry board -------------------------------------------------

/** One entry of GET /admin/providers/:id/nodes/:node/certs (PVE certificate info). */
interface NodeCertificate {
  filename?: string
  fingerprint?: string
  issuer?: string
  subject?: string
  "not-after"?: string
  "not-before"?: string
}

interface ClusterPayload {
  provider_id: string
  code: string
  nodes?: Array<{ node?: string; status?: string }>
  resources?: unknown[]
}

interface CertRow {
  key: string
  providerId: string
  providerName: string
  node: string
  subject: string
  fingerprint: string
  issuer: string
  notAfterRaw: string
  expiresAt: Date | null
  /** Whole days until expiry; negative when already expired. */
  daysRemaining: number | null
}

const CIDR_PATTERN =
  /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^([0-9a-fA-F:]+)\/\d{1,3}$/

function parseApiDate(value?: string | null): Date | null {
  if (!value) return null
  const direct = new Date(value)
  if (!Number.isNaN(direct.getTime())) return direct
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function certDaysRemaining(cert: NodeCertificate): Date | null {
  return parseApiDate(cert["not-after"])
}

function CertExpiryBadge({ row }: { row: CertRow }) {
  if (row.daysRemaining === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        unparsable date
      </Badge>
    )
  }
  if (row.daysRemaining < 0) {
    return <Badge variant="destructive">expired</Badge>
  }
  if (row.daysRemaining < 14) {
    return <Badge variant="destructive">{row.daysRemaining} d left</Badge>
  }
  if (row.daysRemaining < 30) {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      >
        {row.daysRemaining} d left
      </Badge>
    )
  }
  return <Badge variant="outline">{row.daysRemaining} d left</Badge>
}

export default function NocSecurityPage() {
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [incidentTotal, setIncidentTotal] = useState(0)
  const [incidentsLoading, setIncidentsLoading] = useState(true)
  const [incidentsError, setIncidentsError] = useState<unknown>(null)

  const [networks, setNetworks] = useState<BlockedNetwork[]>([])
  const [networksLoading, setNetworksLoading] = useState(true)
  const [networksError, setNetworksError] = useState<unknown>(null)

  const [certRows, setCertRows] = useState<CertRow[]>([])
  const [certsLoading, setCertsLoading] = useState(true)
  const [certsError, setCertsError] = useState<unknown>(null)
  const [certWarnings, setCertWarnings] = useState<string[]>([])

  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [confirmResolve, setConfirmResolve] = useState<IncidentRow | null>(null)

  const [newCidr, setCidr] = useState("")
  const [newReason, setNewReason] = useState("")
  const [cidrInvalid, setCidrInvalid] = useState(false)
  const [addingNetwork, setAddingNetwork] = useState(false)
  const [confirmUnblock, setConfirmUnblock] = useState<BlockedNetwork | null>(null)
  const [deletingNetwork, setDeletingNetwork] = useState<BlockedNetwork | null>(null)

  const bulkIncidents = useBulkSelection<IncidentRow>((row) => row.id)
  const [bulkResolveOpen, setBulkResolveOpen] = useState(false)
  const [bulkIncidentBusy, setBulkIncidentBusy] = useState(false)
  const bulkNetworks = useBulkSelection<BlockedNetwork>((row) => row.id)
  const [bulkUnblockOpen, setBulkUnblockOpen] = useState(false)
  const [bulkNetworkBusy, setBulkNetworkBusy] = useState(false)

  const bulkResolveIncidents = async () => {
    const targets = bulkIncidents.resolve(incidents)
    if (targets.length === 0) return
    setBulkIncidentBusy(true)
    try {
      await Promise.all(targets.map((row) => apiPost(`/admin/security-incidents/${row.id}/resolve`)))
      toast.success(`Resolved ${targets.length} incident${targets.length === 1 ? "" : "s"}`)
      setBulkResolveOpen(false)
      bulkIncidents.clear()
      await load()
    } catch (cause) {
      toastApiError(cause, "Could not resolve incidents")
    } finally {
      setBulkIncidentBusy(false)
    }
  }

  const bulkUnblockNetworks = async () => {
    const targets = bulkNetworks.resolve(networks)
    if (targets.length === 0) return
    setBulkNetworkBusy(true)
    try {
      await Promise.all(targets.map((row) => apiDelete(`/admin/blocked-networks/${row.id}`)))
      toast.success(`Unblocked ${targets.length} network${targets.length === 1 ? "" : "s"}`)
      setBulkUnblockOpen(false)
      bulkNetworks.clear()
      await load()
    } catch (cause) {
      toastApiError(cause, "Could not unblock networks")
    } finally {
      setBulkNetworkBusy(false)
    }
  }

  const loadCerts = useCallback(async () => {
    setCertsLoading(true)
    setCertsError(null)
    setCertWarnings([])
    try {
      const providersEnvelope = await apiGet<Provider[]>("/admin/providers")
      // The certs endpoints are proxmox-only on this backend; only enabled
      // proxmox-kind providers can answer.
      const targets = providersEnvelope.data.filter(
        (p) => p.enabled && p.kind === "proxmox",
      )
      if (targets.length === 0) {
        setCertRows([])
        setCertWarnings([])
        return
      }

      const providerResults = await Promise.allSettled(
        targets.map(async (provider) => {
          const clusterEnvelope = await apiGet<ClusterPayload>(
            `/admin/providers/${provider.id}/cluster`,
          )
          const nodes = [...new Set((clusterEnvelope.data.nodes ?? [])
            .map((entry) => String(entry.node ?? ""))
            .filter(Boolean))]

          const nodeResults = await Promise.allSettled(
            nodes.map(async (node) => {
              const envelope = await apiGet<NodeCertificate[]>(
                `/admin/providers/${provider.id}/nodes/${encodeURIComponent(node)}/certs`,
              )
              return { node, certs: Array.isArray(envelope.data) ? envelope.data : [] }
            }),
          )

          return { provider, nodes, nodeResults }
        }),
      )

      const rows: CertRow[] = []
      const warnings: string[] = []
      for (const providerResult of providerResults) {
        if (providerResult.status === "rejected") {
          const cause = providerResult.reason
          warnings.push(
            `Provider cluster unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
          continue
        }
        const { provider, nodes, nodeResults } = providerResult.value
        if (nodes.length === 0) {
          warnings.push(`${provider.name}: cluster reported no nodes.`)
        }
        for (let index = 0; index < nodeResults.length; index += 1) {
          const nodeResult = nodeResults[index]
          const node = nodes[index]
          if (nodeResult.status === "rejected") {
            const cause = nodeResult.reason
            warnings.push(
              `${provider.name}/${node}: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
            continue
          }
          for (const cert of nodeResult.value.certs) {
            const expiresAt = certDaysRemaining(cert)
            rows.push({
              key: `${provider.id}:${node}:${cert.fingerprint ?? cert.filename ?? rows.length}`,
              providerId: provider.id,
              providerName: provider.name,
              node,
              subject: cert.subject || cert.filename || "—",
              fingerprint: cert.fingerprint ?? "",
              issuer: cert.issuer ?? "",
              notAfterRaw: cert["not-after"] ?? "",
              expiresAt,
              daysRemaining:
                expiresAt === null
                  ? null
                  : Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
            })
          }
        }
      }
      rows.sort((a, b) => {
        if (a.daysRemaining === null) return 1
        if (b.daysRemaining === null) return -1
        return a.daysRemaining - b.daysRemaining
      })
      setCertRows(rows)
      setCertWarnings(warnings)
    } catch (cause) {
      setCertsError(cause)
    } finally {
      setCertsLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    setIncidentsLoading(true)
    setNetworksLoading(true)
    void loadCerts()
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
  }, [loadCerts])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
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

  const openIncidents = incidents.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed",
  ).length

  const expiringSoon = useMemo(
    () =>
      certRows.filter(
        (row) => row.daysRemaining !== null && row.daysRemaining < 30,
      ).length,
    [certRows],
  )

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
        <span className="min-w-0 block max-w-72 truncate text-sm" title={row.description}>
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
        <span className="min-w-0 block max-w-80 truncate text-sm" title={row.reason}>
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
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Security"
        description="Security incidents, network blocking and provider certificate expiry."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-3">
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
        <StatCard
          label={"Certs expiring <30 d"}
          value={expiringSoon}
          hint={`${certRows.length} certificates tracked`}
          icon={<KeyRoundIcon />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider certificate expiry</CardTitle>
          <CardDescription>
            Node certificates of every enabled Proxmox provider, soonest expiry first. Collected
            via the NOC-readable cluster and certs endpoints.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {certsLoading ? (
            <div className="flex min-w-0 items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Scanning provider certificates…
            </div>
          ) : certsError ? (
            <p className="text-destructive text-sm">
              Certificate board unavailable:{" "}
              {certsError instanceof Error ? certsError.message : "request failed"}
            </p>
          ) : certRows.length === 0 && certWarnings.length === 0 ? (
            <p className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
              No enabled Proxmox-kind provider is available to scan. Enable one with configured
              credentials to populate this board.
            </p>
          ) : (
            <>
              {certRows.length > 0 ? (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Subject</th>
                        <th className="px-3 py-2 font-medium">Provider / node</th>
                        <th className="px-3 py-2 font-medium">Issuer</th>
                        <th className="px-3 py-2 font-medium">Not after</th>
                        <th className="px-3 py-2 text-right font-medium">Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {certRows.map((row) => (
                        <tr key={row.key} className="border-b last:border-b-0">
                          <td className="max-w-64 px-3 py-2">
                            <p className="min-w-0 truncate" title={row.subject}>
                              {row.subject}
                            </p>
                            {row.fingerprint ? (
                              <p
                                className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
                                title={row.fingerprint}
                              >
                                {row.fingerprint}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {row.providerName}
                            <span className="text-muted-foreground"> · {row.node}</span>
                          </td>
                          <td className="min-w-0 max-w-48 truncate px-3 py-2 text-xs text-muted-foreground" title={row.issuer}>
                            {row.issuer || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {row.expiresAt ? fmtDateTime(row.notAfterRaw) : row.notAfterRaw || "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <CertExpiryBadge row={row} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No certificates could be collected — see the scan failures below.
                </p>
              )}
              {certWarnings.length > 0 ? (
                <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                  <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <TriangleAlertIcon className="size-3.5" /> Partial results — some scans failed:
                  </p>
                  <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                    {certWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security incidents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <BulkActionBar
            selectedCount={bulkIncidents.selectedKeys.size}
            busy={bulkIncidentBusy}
            actions={[
              {
                key: "resolve",
                label: "Resolve selected",
                onClick: () => setBulkResolveOpen(true),
              },
            ]}
          />
          <SimpleDataTable
            columns={incidentColumns}
            rows={incidents}
            loading={incidentsLoading}
            error={incidentsError}
            skeletonRows={5}
            emptyMessage="No security incidents recorded — all quiet."
            getRowKey={bulkIncidents.getRowKey}
            selectable
            selectedKeys={bulkIncidents.selectedKeys}
            onSelectionChange={bulkIncidents.onSelectionChange}
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
            className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1.5fr)_auto]"
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

          <BulkActionBar
            selectedCount={bulkNetworks.selectedKeys.size}
            busy={bulkNetworkBusy}
            actions={[
              {
                key: "unblock",
                label: "Unblock selected",
                destructive: true,
                onClick: () => setBulkUnblockOpen(true),
              },
            ]}
          />
          <SimpleDataTable
            columns={networkColumns}
            rows={networks}
            loading={networksLoading}
            error={networksError}
            skeletonRows={4}
            emptyMessage="No networks are currently blocked."
            getRowKey={bulkNetworks.getRowKey}
            selectable
            selectedKeys={bulkNetworks.selectedKeys}
            onSelectionChange={bulkNetworks.onSelectionChange}
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

      {/* Bulk resolve incidents confirmation */}
      <AlertDialog open={bulkResolveOpen} onOpenChange={setBulkResolveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve {bulkIncidents.selectedKeys.size} selected incident{bulkIncidents.selectedKeys.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be marked resolved and leave the open queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkIncidentBusy}>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkIncidentBusy}
              onClick={(event) => {
                event.preventDefault()
                void bulkResolveIncidents()
              }}
            >
              {bulkIncidentBusy ? <Loader2Icon className="animate-spin" /> : null}
              Resolve selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk unblock networks confirmation */}
      <AlertDialog open={bulkUnblockOpen} onOpenChange={setBulkUnblockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock {bulkNetworks.selectedKeys.size} selected network{bulkNetworks.selectedKeys.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Traffic from these ranges will be allowed again immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkNetworkBusy}>Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={bulkNetworkBusy}
              onClick={(event) => {
                event.preventDefault()
                void bulkUnblockNetworks()
              }}
            >
              {bulkNetworkBusy ? <Loader2Icon className="animate-spin" /> : null}
              Unblock selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
