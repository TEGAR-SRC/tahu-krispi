// K6 · Settings ▸ DNS — parity with pages/dashboard/settings/dns.tsx
// (+ dns/show-dns-providers.tsx / handle-dns-provider.tsx /
// show-dns-provider-zones.tsx / handle-dns-record.tsx):
// dnsProvider.all/create/update/remove/testConnection plus per-provider zone
// listing (listZones) and A/CNAME record drill-down (listRecords /
// createRecord / updateRecord / deleteRecord).
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GlobeIcon,
  PenBoxIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { UpstreamError } from "../shared"
import { dokploy, toErrorMessage, useUpstream } from "../shared"
import {
  ConfirmAction,
  FieldRow,
  K6Breadcrumbs,
  asDisplayError,
  fieldErrorsFrom,
} from "./k6-helpers"

type DnsProviderType = "cloudflare" | "route53"

const PROVIDER_LABELS: Record<DnsProviderType, string> = {
  cloudflare: "Cloudflare",
  route53: "AWS Route53",
}

interface DnsConfig {
  providerType: DnsProviderType
  apiToken?: string
  accessKeyId?: string
  secretAccessKey?: string
}

export interface DnsProviderRow {
  dnsProviderId: string
  name: string
  providerType?: DnsProviderType
  config?: DnsConfig & { providerType: DnsProviderType }
}

function HandleDnsProviderDialog({
  dnsProviderId,
  onSaved,
  trigger,
}: {
  dnsProviderId?: string
  onSaved: () => void
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const { data: current } = useUpstream<DnsProviderRow | null>(
    () =>
      dnsProviderId && open
        ? dokploy<DnsProviderRow>("GET", "dnsProvider.one", undefined, { dnsProviderId })
        : Promise.resolve(null),
    [dnsProviderId, open],
  )

  const [values, setValues] = useState({
    name: "",
    providerType: "cloudflare" as DnsProviderType,
    apiToken: "",
    accessKeyId: "",
    secretAccessKey: "",
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<UpstreamError | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      if (!open) return
      setFieldErrors({})
      if (current) {
        const config = current.config
        setValues({
          name: current.name ?? "",
          providerType: config?.providerType ?? "cloudflare",
          apiToken: config?.apiToken ?? "",
          accessKeyId: config?.accessKeyId ?? "",
          secretAccessKey: config?.secretAccessKey ?? "",
        })
      } else if (!dnsProviderId) {
        setValues({ name: "", providerType: "cloudflare", apiToken: "", accessKeyId: "", secretAccessKey: "" })
      }
    }, 0)
    return () => clearTimeout(t)
  }, [open, current, dnsProviderId])

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const buildConfig = (): DnsConfig =>
    values.providerType === "cloudflare"
      ? { providerType: "cloudflare", apiToken: values.apiToken }
      : {
          providerType: "route53",
          accessKeyId: values.accessKeyId,
          secretAccessKey: values.secretAccessKey,
        }

  const validate = (): boolean => {
    const errors: Record<string, string> = {}
    if (!values.name.trim()) errors.name = "Name is required"
    else if (!/^[a-zA-Z0-9_-]+$/.test(values.name.trim()))
      errors.name = "Only letters, numbers, dashes and underscores"
    if (values.providerType === "cloudflare" && !values.apiToken.trim())
      errors.apiToken = "API token is required"
    if (values.providerType === "route53") {
      if (!values.accessKeyId.trim()) errors.accessKeyId = "Access Key ID is required"
      if (!values.secretAccessKey.trim()) errors.secretAccessKey = "Secret Access Key is required"
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitError(null)
    if (!validate()) return
    setBusy(true)
    try {
      await dokploy("POST", dnsProviderId ? "dnsProvider.update" : "dnsProvider.create", {
        name: values.name.trim(),
        config: buildConfig(),
        ...(dnsProviderId ? { dnsProviderId } : {}),
      })
      toast.success(dnsProviderId ? "DNS provider updated" : "DNS provider created")
      setOpen(false)
      onSaved()
    } catch (cause: unknown) {
      const err = cause as UpstreamError
      setSubmitError(err)
      toast.error(toErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const onTestConnection = async () => {
    if (!validate()) return
    setTesting(true)
    try {
      await dokploy("POST", "dnsProvider.testConnection", {
        config: buildConfig(),
        ...(dnsProviderId ? { dnsProviderId } : {}),
      })
      toast.success("Connection successful")
    } catch (cause: unknown) {
      toast.error(`Connection failed: ${toErrorMessage(cause)}`)
    } finally {
      setTesting(false)
    }
  }

  const zodErrors = submitError ? fieldErrorsFrom(submitError) : null
  const errorFor = (name: string) => fieldErrors[name] ?? zodErrors?.[name]?.[0]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {dnsProviderId ? "Update DNS Provider" : "Add DNS Provider"}
          </DialogTitle>
          <DialogDescription>
            Let Dokploy create A/CNAME records for domains automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <FieldRow label="Name" error={errorFor("name")}>
            <Input placeholder="prod-cloudflare" value={values.name} onChange={(e) => set("name", e.target.value)} />
          </FieldRow>
          <FieldRow label="Provider">
            <Select
              value={values.providerType}
              onValueChange={(value) => set("providerType", value as DnsProviderType)}
              disabled={!!dnsProviderId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDER_LABELS) as DnsProviderType[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {PROVIDER_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          {values.providerType === "cloudflare" ? (
            <FieldRow label="API Token" error={errorFor("apiToken")}>
              <Input type="password" value={values.apiToken} onChange={(e) => set("apiToken", e.target.value)} />
            </FieldRow>
          ) : (
            <>
              <FieldRow label="Access Key ID" error={errorFor("accessKeyId")}>
                <Input value={values.accessKeyId} onChange={(e) => set("accessKeyId", e.target.value)} />
              </FieldRow>
              <FieldRow label="Secret Access Key" error={errorFor("secretAccessKey")}>
                <Input type="password" value={values.secretAccessKey} onChange={(e) => set("secretAccessKey", e.target.value)} />
              </FieldRow>
            </>
          )}
          {submitError ? (
            <p className="text-destructive text-sm">{toErrorMessage(submitError)}</p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="secondary" onClick={onTestConnection} disabled={testing}>
              {testing ? "Testing…" : "Test Connection"}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : dnsProviderId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface ZoneRow {
  id: string
  name: string
}

interface DnsRecordRow {
  id: string
  type: string
  name: string
  content: string
  ttl?: number
}

function RecordDialog({
  dnsProviderId,
  zoneId,
  record,
  onSaved,
  trigger,
}: {
  dnsProviderId: string
  zoneId: string
  record?: DnsRecordRow
  onSaved: () => void
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState({
    type: record?.type === "CNAME" ? "CNAME" : "A",
    name: record?.name ?? "",
    content: record?.content ?? "",
    ttl: record?.ttl && record.ttl !== 1 ? String(record.ttl) : "",
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      if (!open) return
      setFieldErrors({})
      setValues({
        type: record?.type === "CNAME" ? "CNAME" : "A",
        name: record?.name ?? "",
        content: record?.content ?? "",
        ttl: record?.ttl && record.ttl !== 1 ? String(record.ttl) : "",
      })
    }, 0)
    return () => clearTimeout(t)
  }, [open, record])

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const errors: Record<string, string> = {}
    if (!values.name.trim()) errors.name = "Name is required"
    if (!values.content.trim()) errors.content = values.type === "A" ? "IPv4 address is required" : "Target is required"
    setFieldErrors(errors)
    setSubmitError(null)
    if (Object.keys(errors).length > 0) return

    setBusy(true)
    try {
      await dokploy("POST", record ? "dnsProvider.updateRecord" : "dnsProvider.createRecord", {
        dnsProviderId,
        zoneId,
        type: values.type,
        name: values.name.trim(),
        content: values.content.trim(),
        ...(values.ttl ? { ttl: Number(values.ttl) } : {}),
        ...(record ? { recordId: record.id } : {}),
      })
      toast.success(record ? "Record updated" : "Record created")
      setOpen(false)
      onSaved()
    } catch (cause: unknown) {
      setSubmitError(toErrorMessage(cause))
      toast.error(toErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{record ? "Edit Record" : "Add Record"}</DialogTitle>
          <DialogDescription>
            {record ? "Update this DNS record." : "Create a new A or CNAME record in this zone."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <FieldRow label="Type">
            <Select value={values.type} onValueChange={(value) => set("type", value)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A">A</SelectItem>
                <SelectItem value="CNAME">CNAME</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Name" hint="Use @ for the root domain." error={fieldErrors.name}>
            <Input placeholder="app.example.com" value={values.name} onChange={(e) => set("name", e.target.value)} />
          </FieldRow>
          <FieldRow label={values.type === "A" ? "IPv4 Address" : "Target"} error={fieldErrors.content}>
            <Input
              placeholder={values.type === "A" ? "203.0.113.10" : "app.example.com"}
              value={values.content}
              onChange={(e) => set("content", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="TTL (optional)">
            <Input type="number" placeholder="Auto" value={values.ttl} onChange={(e) => set("ttl", e.target.value)} />
          </FieldRow>
          {submitError ? <p className="text-destructive text-sm">{submitError}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : record ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ZonesDialog({ provider }: { provider: DnsProviderRow }) {
  const [open, setOpen] = useState(false)
  const [expandedZoneId, setExpandedZoneId] = useState<string | null>(null)

  const {
    data: zones,
    loading,
    error,
    reload,
  } = useUpstream<ZoneRow[]>(
    () =>
      open
        ? dokploy<ZoneRow[]>("GET", "dnsProvider.listZones", undefined, {
            dnsProviderId: provider.dnsProviderId,
          })
        : Promise.resolve([]),
    [open, provider.dnsProviderId],
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setExpandedZoneId(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <GlobeIcon className="size-3.5" /> Domains
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Zones for {provider.name}</DialogTitle>
          <DialogDescription>
            Zones this provider's credentials can manage. Expand a zone to manage its records.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((n) => (
              <div key={n} className="bg-muted h-9 w-full animate-pulse rounded-md" />
            ))}
          </div>
        ) : asDisplayError(error) ? (
          <p className="text-destructive text-sm">{toErrorMessage(error)}</p>
        ) : (zones ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No zones found for these credentials. Make sure they can access at least one zone.
          </p>
        ) : (
          <div className="grid max-h-[60vh] gap-1.5 overflow-y-auto">
            {(zones ?? []).map((zone) => {
              const expanded = expandedZoneId === zone.id
              return (
                <div key={zone.id} className="rounded-md border">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                    onClick={() => setExpandedZoneId(expanded ? null : zone.id)}
                  >
                    {expanded ? (
                      <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
                    ) : (
                      <ChevronRightIcon className="text-muted-foreground size-3.5 shrink-0" />
                    )}
                    <GlobeIcon className="text-muted-foreground size-3.5 shrink-0" />
                    {zone.name}
                  </button>
                  {expanded ? (
                    <ZoneRecords
                      dnsProviderId={provider.dnsProviderId}
                      zone={zone}
                      onRecordsChanged={() => reload()}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ZoneRecords({
  dnsProviderId,
  zone,
}: {
  dnsProviderId: string
  zone: ZoneRow
  /** Present so future cache invalidation can hook in; currently unused. */
  onRecordsChanged?: () => void
}) {
  const [reloadTick, setReloadTick] = useState(0)
  const { data, loading, error } = useUpstream<DnsRecordRow[]>(
    () =>
      dokploy<DnsRecordRow[]>("GET", "dnsProvider.listRecords", undefined, {
        dnsProviderId,
        zoneId: zone.id,
      }),
    [dnsProviderId, zone.id, reloadTick],
  )
  const [deleting, setDeleting] = useState(false)

  const deleteRecord = async (record: DnsRecordRow) => {
    setDeleting(true)
    try {
      await dokploy("POST", "dnsProvider.deleteRecord", {
        dnsProviderId,
        zoneId: zone.id,
        recordId: record.id,
      })
      toast.success("Record deleted")
      setReloadTick((t) => t + 1)
    } catch (cause: unknown) {
      toast.error(toErrorMessage(cause))
    } finally {
      setDeleting(false)
    }
  }

  const recordsChanged = () => setReloadTick((t) => t + 1)

  return (
    <div className="flex flex-col gap-1 px-3 pb-2 pl-8">
      {loading ? (
        <p className="text-muted-foreground py-1 text-xs">Loading records…</p>
      ) : asDisplayError(error) ? (
        <p className="text-destructive py-1 text-xs">{toErrorMessage(error)}</p>
      ) : (data ?? []).length === 0 ? (
        <p className="text-muted-foreground py-1 text-xs">No records found in this zone.</p>
      ) : (
        (data ?? []).map((record) => {
          const editable = record.type === "A" || record.type === "CNAME"
          return (
            <div key={record.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
              <Badge variant="outline" className="shrink-0">
                {record.type}
              </Badge>
              <span className="max-w-40 truncate font-medium">{record.name}</span>
              <span className="text-muted-foreground flex-1 truncate">→ {record.content}</span>
              {editable ? (
                <RecordDialog
                  dnsProviderId={dnsProviderId}
                  zoneId={zone.id}
                  record={record}
                  onSaved={recordsChanged}
                  trigger={
                    <Button variant="ghost" size="icon" className="group size-6 hover:bg-blue-500/10">
                      <PenBoxIcon className="text-primary group-hover:text-blue-500 size-3" />
                    </Button>
                  }
                />
              ) : null}
              <ConfirmAction
                title="Delete Record"
                description={`Delete the ${record.type} record "${record.name}"? This removes it from the DNS provider, not just from Dokploy.`}
                confirmLabel="Delete Record"
                onConfirm={() => deleteRecord(record)}
                busy={deleting}
                trigger={
                  <Button variant="ghost" size="icon" className="group size-6 hover:bg-red-500/10">
                    <Trash2Icon className="text-primary group-hover:text-red-500 size-3" />
                  </Button>
                }
              />
            </div>
          )
        })
      )}
      <div className="pt-1">
        <RecordDialog
          dnsProviderId={dnsProviderId}
          zoneId={zone.id}
          onSaved={recordsChanged}
          trigger={
            <Button variant="outline" size="sm" className="gap-1.5">
              <PlusIcon className="size-3.5" /> Add Record
            </Button>
          }
        />
      </div>
    </div>
  )
}

export default function DokploySettingsDnsPage() {
  const { data, error, loading, reload } = useUpstream<DnsProviderRow[]>(
    () => dokploy<DnsProviderRow[]>("GET", "dnsProvider.all"),
    [],
  )
  const providers = data ?? []

  const removeProvider = async (provider: DnsProviderRow) => {
    try {
      await dokploy("POST", "dnsProvider.remove", { dnsProviderId: provider.dnsProviderId })
      toast.success("DNS provider deleted")
      reload()
    } catch (cause: unknown) {
      toast.error(toErrorMessage(cause))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <K6Breadcrumbs current="DNS Providers" />
      <PageHeader
        title="DNS Providers"
        description="Connect a DNS provider so Dokploy can create domain records automatically."
        actions={
          <HandleDnsProviderDialog
            onSaved={reload}
            trigger={
              <Button size="sm">
                <PlusIcon className="size-4" /> Add Provider
              </Button>
            }
          />
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GlobeIcon className="text-muted-foreground size-5" />
            Providers ({providers.length})
          </CardTitle>
          <CardDescription>
            Supported types per the upstream API: Cloudflare and AWS Route53.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 border-t pt-6">
          {asDisplayError(error) ? (
            <p className="text-destructive text-sm">{toErrorMessage(error)}</p>
          ) : loading ? (
            <div className="bg-muted h-16 w-full animate-pulse rounded-md" />
          ) : providers.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              You don't have any DNS providers configured yet.
            </p>
          ) : (
            providers.map((provider) => {
              const type = provider.config?.providerType ?? provider.providerType ?? "cloudflare"
              return (
                <div key={provider.dnsProviderId} className="rounded-lg border p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <GlobeIcon className="text-muted-foreground size-6 shrink-0" />
                      <div>
                        <span className="text-sm font-medium">{provider.name}</span>
                        <div className="mt-1">
                          <Badge variant="outline">{PROVIDER_LABELS[type] ?? type}</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <ZonesDialog provider={provider} />
                      <HandleDnsProviderDialog
                        dnsProviderId={provider.dnsProviderId}
                        onSaved={reload}
                        trigger={
                          <Button variant="ghost" size="icon" className="group hover:bg-blue-500/10">
                            <PenBoxIcon className="text-primary group-hover:text-blue-500 size-4" />
                          </Button>
                        }
                      />
                      <ConfirmAction
                        title="Delete DNS Provider"
                        description={`Domains relying on "${provider.name}" for records will need manual updates. Delete this provider?`}
                        confirmLabel="Delete"
                        onConfirm={() => removeProvider(provider)}
                        trigger={
                          <Button variant="ghost" size="icon" className="group hover:bg-red-500/10">
                            <Trash2Icon className="text-primary group-hover:text-red-500 size-4" />
                          </Button>
                        }
                      />
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
