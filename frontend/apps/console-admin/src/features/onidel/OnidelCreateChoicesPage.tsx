import { useMemo } from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { ContainerIcon, ServerIcon } from "lucide-react"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

type ChoiceRow = {
  id: string
  kind: "vm" | "container"
  title: string
  description: string
  supported: boolean
  to: string
}

export default function OnidelCreateChoicesPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const navigate = useNavigate()
  const providers = useInfraGet<ProviderRow[]>("/admin/providers", undefined, { intervalMs: 5000 })

  const loading = providers.loading
  const error = providers.error as unknown
  const provider = useMemo(() => providers.data?.find((p) => p.id === providerId) ?? null, [providers.data, providerId])

  const isOnidel = provider ? provider.kind === "onidel" : true
  const vmSupported = true
  const containerSupported = false

  const rows: ChoiceRow[] = useMemo(
    () => [
      {
        id: "vm",
        kind: "vm",
        title: "Create VM",
        description: "Provision an Onidel VM via POST /v1/instances (service_kind=vm) with region routing and X-Organization-ID.",
        supported: vmSupported,
        to: `/admin/onidel/${providerId}/create`,
      },
      {
        id: "container",
        kind: "container",
        title: "Create Container",
        description: containerSupported
          ? "Provision an Onidel container via POST /v1/instances (service_kind=container)."
          : "Containers are not supported by the Onidel provider upstream (ProvisionContainer returns 501). Use Proxmox for LXC.",
        supported: containerSupported,
        to: `/admin/onidel/${providerId}/create-container`,
      },
    ],
    [providerId],
  )

  const columns: SimpleColumn<ChoiceRow>[] = [
    {
      key: "title",
      header: "Type",
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{r.title}</span>
          {r.supported ? <Badge variant="default">available</Badge> : <Badge variant="outline">unavailable</Badge>}
          <Badge variant="outline" className="font-mono text-xs">
            {r.kind}
          </Badge>
        </div>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (r) => <span className="text-sm text-muted-foreground">{r.description}</span>,
    },
    {
      key: "action",
      header: "Action",
      className: "w-[180px]",
      render: (r) => {
        if (!r.supported) {
          return (
            <Button variant="outline" disabled size="sm">
              Not supported
            </Button>
          )
        }
        return (
          <Button size="sm" onClick={() => navigate(r.to)}>
            {r.kind === "vm" ? "Create VM" : "Create Container"}
          </Button>
        )
      },
    },
  ]

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="Create" description="Choose VM or Container for this Onidel provider.">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Create"
      description={
        provider
          ? `Choose what to create on ${provider.code} (${provider.kind}). VM is available; container is unavailable on Onidel.`
          : "Choose VM or Container for this Onidel provider."
      }
    >
      {error ? <ErrorBanner error={error} /> : null}

      {!isOnidel && !loading ? (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Provider <span className="font-mono">{providerId.slice(0, 8)}…</span> is kind{" "}
            <span className="font-mono">{provider?.kind}</span>, not <span className="font-mono">onidel</span>. This chooser is intended
            for Onidel providers only.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className={vmSupported ? "border-primary/30" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <ServerIcon className="size-4" />
              </span>
              Create VM
              <Badge>VM</Badge>
              {vmSupported ? <Badge variant="default">available</Badge> : <Badge variant="outline">unavailable</Badge>}
            </CardTitle>
            <CardDescription>Onidel VM — billed via vCPU / RAM / disk through POST /v1/instances with service_kind=vm.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Routes via <span className="font-mono">region_id</span> (regions.provider_id == this provider). Requires{" "}
              <span className="font-mono">X-Organization-ID</span>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => navigate(`/admin/onidel/${providerId}/create`)} disabled={!vmSupported}>
                Create VM
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/admin/onidel/${providerId}/onidel`}>Back to catalog</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Target: <span className="font-mono">POST /v1/instances</span> {"{ name, region_id, service_kind:'vm', cpu, ram, disk }"} +{" "}
              <span className="font-mono">X-Organization-ID</span>
            </p>
          </CardContent>
        </Card>

        <Card className={!containerSupported ? "opacity-90" : "border-primary/30"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <ContainerIcon className="size-4" />
              </span>
              Create Container
              <Badge variant="outline">container</Badge>
              {containerSupported ? <Badge variant="default">available</Badge> : <Badge variant="outline">unavailable</Badge>}
            </CardTitle>
            <CardDescription>
              {containerSupported ? "Onidel container — service_kind=container." : "Not supported by Onidel upstream — ProvisionContainer returns 501."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {containerSupported
                ? "Routes via region_id like VMs. Requires X-Organization-ID."
                : "Onidel API exposes no container primitive; the adapter's ProvisionContainer is intentionally unsupported. Create containers on Proxmox instead."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!containerSupported} onClick={() => navigate(`/admin/onidel/${providerId}/create-container`)}>
                Create Container
              </Button>
              <Button variant="outline" asChild>
                <Link to="/admin/providers">All providers</Link>
              </Button>
            </div>
            {!containerSupported ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                If Onidel later supports containers, wire this card to POST /v1/instances with service_kind=container.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick chooser</CardTitle>
          <CardDescription>Tabular view of the same choices — useful for keyboard navigation and parity.</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleDataTable<ChoiceRow>
            columns={columns}
            rows={rows}
            loading={loading}
            error={error ?? undefined}
            getRowKey={(r) => r.id}
            emptyMessage="No choices available."
          />
        </CardContent>
      </Card>
    </ProviderShell>
  )
}
