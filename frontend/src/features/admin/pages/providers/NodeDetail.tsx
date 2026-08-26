// Per-node console: status detail, DNS and clock, certificates and disks plus
// platform-admin power commands (reboot/shutdown/wake-on-LAN) and ad-hoc
// vzdump backups. Every mutation is confirmed before it hits the provider.
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiPost, apiPut, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { JsonBlock, formatDateTime } from "../shared"
import {
  ConfirmDialog,
  formatBytes,
  formatPercent,
  formatUptime,
  useInfraGet,
  type ClusterStorage,
} from "./shared"

interface NodeDetailPayload {
  Name?: string
  Kversion?: string
  PVEVersion?: string
  LoadAvg?: string[]
  CPU?: number
  Uptime?: number
  Idle?: number
  Wait?: number
  RootFS?: { Avail?: number; Total?: number; Free?: number; Used?: number }
  CPUInfo?: {
    user_hz?: number
    MHZ?: number | string
    Model?: string
    Cores?: number
    Sockets?: number
    Flags?: string
    CPUs?: number
    HVM?: string
  }
  Memory?: { Used?: number; Free?: number; Total?: number }
  Swap?: { Used?: number; Free?: number; Total?: number }
  Ksm?: { Shared?: number }
  [key: string]: unknown
}

interface DiskRow {
  devpath?: string
  type?: string
  size?: number
  used?: string
  health?: string
  wearout?: string
  model?: string
  serial?: string
  mounted?: string
  wwn?: string
  osdid?: number
  gpt?: number | boolean
  [key: string]: unknown
}

interface CertRow {
  filename?: string
  subject?: string
  issuer?: string
  "not-after"?: string
  "not-before"?: string
  fingerprint?: string
  san?: string[]
  "public-key-type"?: string
  "public-key-bits"?: number
  pem?: string
  [key: string]: unknown
}

const COMMANDS = ["reboot", "shutdown", "wakeonlan"] as const

/** URL prefix of one node under /admin/providers/:provider_id/nodes/:node. */
function clusterBase(providerId: string, node: string): string {
  return `/admin/providers/${providerId}/nodes/${encodeURIComponent(node)}`
}

export default function ProviderNodeDetailPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""
  const node = params.node ?? ""

  const detail = useInfraGet<NodeDetailPayload>(
    node ? `${clusterBase(providerId, node)}/detail` : null,
  )
  const storages = useInfraGet<ClusterStorage[]>(
    providerId ? `/admin/providers/${providerId}/cluster-storages` : null,
  )

  const [command, setCommand] = useState<(typeof COMMANDS)[number] | null>(null)
  const [busy, setBusy] = useState(false)

  // Ad-hoc vzdump dialog state.
  const [backupOpen, setBackupOpen] = useState(false)
  const [vmid, setVmid] = useState("")
  const [storage, setStorage] = useState("")
  const [mode, setMode] = useState("snapshot")

  const postNodeAction = async (
    path: string,
    body: Record<string, unknown>,
    success: string,
  ): Promise<boolean> => {
    setBusy(true)
    try {
      await apiPost(path, body)
      toast.success(success)
      return true
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!node) {
    return <EmptyState message="Node name missing." />
  }

  const base = clusterBase(providerId, node)
  const storageNames = (storages.data ?? [])
    .map((row) => row.storage)
    .filter((name): name is string => Boolean(name))

  const queueBackup = async () => {
    if (!storage.trim()) {
      toast.error("Pick a target storage first.")
      return
    }
    setBackupOpen(false)
    await postNodeAction(
      `${base}/backup`,
      { vmid: Number.parseInt(vmid, 10), storage: storage.trim(), mode },
      `Backup of VMID ${vmid} queued on ${storage}`,
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Node ${node}`}
        description="Status detail, resolver/clock configuration, disks, certificates and power operations."
        actions={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setBackupOpen(true)}>
              Ad-hoc backup…
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setCommand("wakeonlan")}>
              Wake-on-LAN
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => setCommand("reboot")}>
              Reboot…
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => setCommand("shutdown")}>
              Shutdown…
            </Button>
          </>
        }
      />

      <Tabs defaultValue="detail">
        <TabsList>
          <TabsTrigger value="detail">Detail</TabsTrigger>
          <TabsTrigger value="dns">DNS</TabsTrigger>
          <TabsTrigger value="time">Time</TabsTrigger>
          <TabsTrigger value="disks">Disks</TabsTrigger>
          <TabsTrigger value="certs">Certificates</TabsTrigger>
        </TabsList>

        <TabsContent value="detail" className="space-y-4 pt-4">
          {detail.loading ? (
            <p className="text-sm text-muted-foreground">Loading node detail…</p>
          ) : detail.error ? (
            <ErrorBanner error={detail.error} />
          ) : detail.data ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{detail.data.Name || node}</CardTitle>
                  <CardDescription>{detail.data.PVEVersion || "PVE version n/a"}</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                    <Field label="CPU usage">{formatPercent(detail.data.CPU)}</Field>
                    <Field label="Uptime">{formatUptime(detail.data.Uptime)}</Field>
                    <Field label="Load average">
                      {(detail.data.LoadAvg ?? []).join(" · ") || "—"}
                    </Field>
                    <Field label="IO wait">
                      {typeof detail.data.Wait === "number"
                        ? `${(detail.data.Wait * 100).toFixed(1)}%`
                        : "—"}
                    </Field>
                    <Field label="Kernel" wide>{detail.data.Kversion || "—"}</Field>
                    <Field label="CPU model" wide>{detail.data.CPUInfo?.Model || "—"}</Field>
                    <Field label="Cores / sockets">
                      {detail.data.CPUInfo?.Cores ?? "—"} / {detail.data.CPUInfo?.Sockets ?? "—"}
                    </Field>
                    <Field label="Memory">
                      {formatBytes(detail.data.Memory?.Used)} /{" "}
                      {formatBytes(detail.data.Memory?.Total)}
                    </Field>
                    <Field label="Swap used">{formatBytes(detail.data.Swap?.Used)}</Field>
                    <Field label="KSM shared">{formatBytes(detail.data.Ksm?.Shared)}</Field>
                    <Field label="Root fs free">{formatBytes(detail.data.RootFS?.Avail)}</Field>
                  </dl>
                </CardContent>
              </Card>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Raw payload</summary>
                <JsonBlock value={detail.data} />
              </details>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="dns" className="pt-4">
          <DnsTab base={base} />
        </TabsContent>

        <TabsContent value="time" className="pt-4">
          <TimeTab base={base} />
        </TabsContent>

        <TabsContent value="disks" className="pt-4">
          <DisksTab base={base} />
        </TabsContent>

        <TabsContent value="certs" className="pt-4">
          <CertsTab base={base} />
        </TabsContent>
      </Tabs>

      {/* Power command confirmation — these hit real hypervisors. */}
      <ConfirmDialog
        open={command !== null}
        onOpenChange={(open) => !open && setCommand(null)}
        title={
          command === "wakeonlan" ? `Send Wake-on-LAN to ${node}?` : `Run "${command}" on ${node}?`
        }
        body={
          command === "shutdown"
            ? "Shutdown stops the hypervisor and every guest running on it until it comes back."
            : command === "reboot"
              ? "The node reboots; all guests on it restart with it."
              : "A magic packet is sent to the node's management NIC."
        }
        confirmLabel="Run command"
        busy={busy}
        onConfirm={() => {
          const target = command
          setCommand(null)
          if (!target) return
          void postNodeAction(`${base}/command`, { command: target }, `Node ${target} queued`)
        }}
      />

      {/* Ad-hoc vzdump of one guest onto a chosen storage (202). */}
      <Dialog open={backupOpen} onOpenChange={setBackupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ad-hoc vzdump on {node}</DialogTitle>
            <DialogDescription>
              Backs up one guest (VMID) onto a cluster storage once. The job is queued at the
              provider.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vzdump-vmid">VMID *</Label>
              <Input
                id="vzdump-vmid"
                inputMode="numeric"
                value={vmid}
                onChange={(event) => setVmid(event.target.value.replace(/\D/g, ""))}
                placeholder="100"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vzdump-storage">Target storage *</Label>
              <Select value={storage} onValueChange={setStorage}>
                <SelectTrigger id="vzdump-storage">
                  <SelectValue placeholder={storages.loading ? "Loading storages…" : "Pick a storage"} />
                </SelectTrigger>
                <SelectContent>
                  {storageNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {storages.error && storageNames.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Storage list unavailable ({String(storages.error)}) — configure provider
                  credentials or type is required before running.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vzdump-mode">Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger id="vzdump-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["snapshot", "suspend", "stop"].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackupOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || vmid === "" || Number.parseInt(vmid, 10) <= 0 || storage === ""}
              onClick={() => void queueBackup()}
            >
              Queue backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`min-w-0 space-y-0.5 ${wide ? "sm:col-span-2 xl:col-span-1" : ""}`}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  )
}

function DnsTab({ base }: { base: string }) {
  const dns = useInfraGet<Record<string, unknown>>(`${base}/dns`)
  const [search, setSearch] = useState("")
  const [dns1, setDns1] = useState("")
  const [dns2, setDns2] = useState("")
  const [dns3, setDns3] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!dns.data) return
    setSearch(String(dns.data.search ?? ""))
    setDns1(String(dns.data.dns1 ?? ""))
    setDns2(String(dns.data.dns2 ?? ""))
    setDns3(String(dns.data.dns3 ?? ""))
  }, [dns.data])

  const save = async () => {
    setSaving(true)
    try {
      await apiPut(`${base}/dns`, { search, dns1, dns2, dns3 })
      toast.success("DNS settings updated")
      dns.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update DNS")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Resolver search domain is required; the three server slots are optional.
      </p>
      {dns.error ? <ErrorBanner error={dns.error} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="dns-search">Search domain</Label>
          <Input
            id="dns-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dns-server-1">Server 1</Label>
          <Input id="dns-server-1" value={dns1} onChange={(event) => setDns1(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dns-server-2">Server 2</Label>
          <Input id="dns-server-2" value={dns2} onChange={(event) => setDns2(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dns-server-3">Server 3</Label>
          <Input id="dns-server-3" value={dns3} onChange={(event) => setDns3(event.target.value)} />
        </div>
      </div>
      <Button disabled={saving || search.trim() === ""} onClick={() => void save()}>
        {saving ? "Saving…" : "Save DNS settings"}
      </Button>
    </div>
  )
}

function TimeTab({ base }: { base: string }) {
  const time = useInfraGet<Record<string, unknown>>(`${base}/time`)
  if (time.loading) return <p className="text-sm text-muted-foreground">Loading clock…</p>
  if (time.error) return <ErrorBanner error={time.error} />
  if (!time.data) return null
  const epoch = Number(time.data.time ?? 0)
  const localtime = Number(time.data.localtime ?? 0)
  return (
    <dl className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="min-w-0 space-y-0.5">
        <dt className="text-xs font-medium text-muted-foreground">Timezone</dt>
        <dd className="truncate text-sm">{String(time.data.timezone ?? "—")}</dd>
      </div>
      <div className="min-w-0 space-y-0.5">
        <dt className="text-xs font-medium text-muted-foreground">UTC time</dt>
        <dd className="truncate text-sm">
          {epoch > 0 ? new Date(epoch * 1000).toLocaleString() : "—"}
        </dd>
      </div>
      <div className="min-w-0 space-y-0.5">
        <dt className="text-xs font-medium text-muted-foreground">Local time</dt>
        <dd className="truncate text-sm">
          {localtime > 0 ? new Date(localtime * 1000).toLocaleString() : "—"}
        </dd>
      </div>
    </dl>
  )
}

function DisksTab({ base }: { base: string }) {
  const disks = useInfraGet<DiskRow[]>(`${base}/disks`)
  return (
    <SimpleDataTable<DiskRow>
      columns={[
        { key: "devpath", header: "Device", render: (d) => d.devpath || "—" },
        { key: "type", header: "Type" },
        { key: "size", header: "Size", render: (d) => formatBytes(d.size) },
        { key: "used", header: "Used" },
        {
          key: "health",
          header: "Health",
          render: (d) => (d.health ? <Badge variant="outline">{d.health}</Badge> : "—"),
        },
        { key: "wearout", header: "Wearout" },
        { key: "model", header: "Model", className: "hidden md:table-cell" },
        {
          key: "serial",
          header: "Serial",
          className: "hidden lg:table-cell font-mono text-xs",
        },
        { key: "mounted", header: "Mounted", render: (d) => d.mounted || "—" },
      ]}
      rows={disks.data ?? []}
      loading={disks.loading}
      error={disks.error}
      getRowKey={(d, index) => String(d.devpath ?? index)}
      emptyMessage="No disks reported."
      skeletonRows={4}
    />
  )
}

function CertsTab({ base }: { base: string }) {
  const certs = useInfraGet<CertRow[]>(`${base}/certs`)
  if (certs.loading) return <p className="text-sm text-muted-foreground">Loading certificates…</p>
  if (certs.error) return <ErrorBanner error={certs.error} />
  const rows = Array.isArray(certs.data) ? certs.data : []
  if (rows.length === 0) {
    return <EmptyState message="No custom certificates reported." />
  }
  return (
    <div className="space-y-3">
      <SimpleDataTable<CertRow>
        columns={[
          { key: "filename", header: "File" },
          { key: "subject", header: "Subject", render: (c) => c.subject || "—" },
          { key: "issuer", header: "Issuer", render: (c) => c.issuer || "—" },
          {
            key: "not-after",
            header: "Valid until",
            render: (c) => formatDateTime(c["not-after"]),
          },
          {
            key: "san",
            header: "SANs",
            className: "hidden max-w-72 truncate lg:table-cell",
            render: (c) => (c.san ?? []).join(", ") || "—",
          },
        ]}
        rows={rows}
        getRowKey={(c, index) => String(c.filename ?? index)}
        skeletonRows={2}
      />
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Raw payload</summary>
        <JsonBlock value={rows} />
      </details>
    </div>
  )
}
