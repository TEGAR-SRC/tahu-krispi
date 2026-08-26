import { useCallback, useEffect, useState } from "react"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2Icon, RefreshCwIcon, SearchIcon, LockIcon } from "lucide-react"
import { ProxmoxDrillDown } from "../components/ProxmoxDrillDown"
import { VmwareDrillDown } from "../components/VmwareDrillDown"
import {
  KindBadge,
  type Provider,
  StatusBadge,
  fmtDateTime,
  toastApiError,
} from "../lib"

export default function NocProvidersPage() {
  const [rows, setRows] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [inspectId, setInspectId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const envelope = await apiGet<Provider[]>("/admin/providers")
      setRows(envelope.data)
      setError(null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sync = useCallback(async (provider: Provider) => {
    setSyncingId(provider.id)
    try {
      await apiPost(`/admin/providers/${provider.id}/sync`)
      toast.success(`Sync job queued for ${provider.name}`)
    } catch (cause) {
      toastApiError(cause, "Could not queue the sync job")
    } finally {
      setSyncingId(null)
    }
  }, [])

  const inspecting = rows.find((row) => row.id === inspectId) ?? null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Providers"
        description="Compute platforms and their NOC-readable infrastructure surfaces."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <SimpleDataTable
        columns={[
          {
            key: "name",
            header: "Provider",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.code}
                  {row.api_base_url ? ` · ${row.api_base_url}` : ""}
                </p>
              </div>
            ),
          },
          { key: "kind", header: "Kind", render: (row) => <KindBadge kind={row.kind} /> },
          {
            key: "enabled",
            header: "Enabled",
            render: (row) => <StatusBadge status={row.enabled ? "enabled" : "disabled"} />,
          },
          {
            key: "health_status",
            header: "Health",
            render: (row) => <StatusBadge status={row.health_status} />,
          },
          {
            key: "has_credentials",
            header: "Credentials",
            render: (row) =>
              row.has_credentials ? (
                <span className="text-sm">configured</span>
              ) : (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <LockIcon className="size-3" /> not set
                </span>
              ),
          },
          { key: "created_at", header: "Registered", render: (row) => fmtDateTime(row.created_at) },
          {
            key: "actions",
            header: "",
            className: "w-40 text-right",
            render: (row) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Inspect ${row.name}`}
                  onClick={() => setInspectId(row.id)}
                >
                  <SearchIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Trigger sync for ${row.name}`}
                  disabled={syncingId !== null}
                  onClick={() => void sync(row)}
                >
                  {syncingId === row.id ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <RefreshCwIcon />
                  )}
                </Button>
              </div>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        skeletonRows={4}
        emptyMessage="No providers registered yet."
        getRowKey={(row) => row.id}
      />

      <Dialog open={inspecting !== null} onOpenChange={(open) => !open && setInspectId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {inspecting?.name}
              {inspecting ? <KindBadge kind={inspecting.kind} /> : null}
            </DialogTitle>
            <DialogDescription>
              Live drill-down of NOC-readable endpoints. Write operations on these surfaces
              are restricted to platform admins.
            </DialogDescription>
          </DialogHeader>

          {inspecting ? (
            inspecting.kind === "proxmox" ? (
              <ProxmoxDrillDown providerId={inspecting.id} />
            ) : inspecting.kind === "vmware" ? (
              <VmwareDrillDown providerId={inspecting.id} />
            ) : inspecting.kind === "dokploy" ? (
              <DokployNote name={inspecting.name} baseUrl={inspecting.api_base_url} />
            ) : (
              <p className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
                No provider-specific drill-down is available for kind
                {" "}
                <span className="font-medium">{inspecting.kind}</span>. Cluster observability
                endpoints are implemented for Proxmox; inventory and guest metrics for VMware.
              </p>
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DokployNote({ name, baseUrl }: { name: string; baseUrl: string }) {
  return (
    <Card>
      <CardContent className="space-y-3 px-4 py-4 text-sm">
        <p className="font-medium">{name} — PaaS control plane</p>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Server URL</dt>
          <dd className="break-all">{baseUrl || "—"}</dd>
        </dl>
        <p className="text-muted-foreground">
          All Dokploy operations — the universal proxy, the mirror database and sync — are
          platform-admin only on this backend. The NOC role receives HTTP&nbsp;403 on every
          one of them, so this console intentionally exposes no Dokploy actions beyond the
          provider-level sync job above.
        </p>
      </CardContent>
    </Card>
  )
}
