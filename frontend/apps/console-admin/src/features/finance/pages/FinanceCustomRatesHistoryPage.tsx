// Finance custom rates history — filtered view of GET /admin/custom-rates?provider=onidel
// Mirrors promo penyisihan existing finance pages: simple GET listing with
// ?provider=onidel filter, polling every 5s via useInfraGet + SimpleDataTable.
// Intended as a "history" lens over the rate timeline; POST/elsewhere tetap
// di /finance/rates. Task: ?provider=onidel filter on GET /admin/custom-rates.
import { useMemo, useState } from "react"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import { formatDateTime, formatMoney } from "../lib-utils"

interface CustomRateRow {
  id: string
  product_id: string
  product_code: string
  dimension_code: string
  currency: string
  billing_period: string
  unit_price: number | string
  included_quantity: number
  min_quantity: number | null
  max_quantity: number | null
  step_quantity: number
  provider_id: string | null
  region_id: string | null
  active_from: string
  active_until: string
}

interface ProviderOption {
  id: string
  code: string
  name: string
  kind: string
}

const PER_PAGE = 100
const PROVIDER_KINDS = ["onidel", "proxmox", "vmware", "dokploy"] as const
const DEFAULT_PROVIDER = "onidel"

function providerLabel(p: ProviderOption): string {
  return `${p.code} (${p.kind})`
}

export default function FinanceCustomRatesHistoryPage() {
  const [provider, setProvider] = useState(DEFAULT_PROVIDER)
  const [customProvider, setCustomProvider] = useState("")
  const [page, setPage] = useState(1)

  const providerParam = provider === "__custom" ? customProvider.trim() : provider

  const query = useMemo(() => {
    const q: Record<string, string | number | boolean | null | undefined> = {
      per_page: PER_PAGE,
      page,
    }
    if (providerParam) q.provider = providerParam
    return q
  }, [page, providerParam])

  const ratesState = useInfraGet<CustomRateRow[]>("/admin/custom-rates", query, { intervalMs: 5000 })
  const providersState = useInfraGet<ProviderOption[]>("/admin/providers", { per_page: 100 })

  const rows = useMemo(() => {
    const d = ratesState.data
    return Array.isArray(d) ? d : []
  }, [ratesState.data])

  const providerName = useMemo(() => {
    const byId = new Map<string, string>()
    const data = providersState.data
    if (Array.isArray(data)) {
      for (const p of data) byId.set(p.id, providerLabel(p))
    }
    return (id: string | null) => (id ? (byId.get(id) ?? `${id.slice(0, 8)}…`) : "—")
  }, [providersState.data])

  const total = typeof (ratesState.meta as Record<string, unknown> | null)?.total === "number" ? (ratesState.meta as Record<string, unknown>).total as number : undefined
  const metaPage = typeof (ratesState.meta as Record<string, unknown> | null)?.page === "number" ? (ratesState.meta as Record<string, unknown>).page as number : page
  const metaPerPage = typeof (ratesState.meta as Record<string, unknown> | null)?.per_page === "number" ? (ratesState.meta as Record<string, unknown>).per_page as number : PER_PAGE
  const lastPage = typeof total === "number" ? Math.max(1, Math.ceil(total / metaPerPage)) : undefined
  const canPrev = metaPage > 1
  const canNext = lastPage !== undefined ? metaPage < lastPage : rows.length >= metaPerPage

  const goPage = (next: number) => setPage(Math.max(1, next))

  const onProviderChange = (next: string) => {
    setProvider(next)
    setPage(1)
  }

  const columns: Array<SimpleColumn<CustomRateRow>> = [
    { key: "product_code", header: "Product", render: (r) => <span className="font-mono text-xs">{r.product_code}</span> },
    { key: "dimension_code", header: "Dimension", render: (r) => <span className="font-mono text-xs">{r.dimension_code}</span> },
    {
      key: "unit_price",
      header: "Unit price",
      className: "text-right tabular-nums",
      render: (r) => formatMoney(Number(r.unit_price), r.currency),
    },
    { key: "billing_period", header: "Period" },
    {
      key: "bounds",
      header: "Bounds",
      render: (r) => {
        const parts: string[] = []
        if (typeof r.included_quantity === "number" && r.included_quantity) parts.push(`incl ${r.included_quantity}`)
        if (typeof r.min_quantity === "number" && r.min_quantity) parts.push(`min ${r.min_quantity}`)
        if (typeof r.max_quantity === "number" && r.max_quantity !== null) parts.push(`max ${r.max_quantity}`)
        if (typeof r.step_quantity === "number" && r.step_quantity > 1) parts.push(`step ${r.step_quantity}`)
        return parts.length ? parts.join(" · ") : "—"
      },
    },
    {
      key: "provider_id",
      header: "Provider",
      render: (r) => <span className="font-mono text-xs">{providerName(r.provider_id)}</span>,
    },
    {
      key: "region_id",
      header: "Region",
      render: (r) => <span className="font-mono text-xs">{r.region_id ? `${r.region_id.slice(0, 8)}…` : "—"}</span>,
    },
    {
      key: "active_from",
      header: "Active from",
      render: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.active_from)}</span>,
    },
    {
      key: "active_until",
      header: "Active until",
      render: (r) => (
        <span className="whitespace-nowrap text-xs">
          {r.active_until ? formatDateTime(r.active_until) : <Badge variant="outline">current</Badge>}
        </span>
      ),
    },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Custom rates history"
        description={`GET /admin/custom-rates?provider=${providerParam || DEFAULT_PROVIDER} — filtered timeline of custom_resource_rates (requireStaff billing · platform_admin+finance, NOC 403). Polled every 5s via useInfraGet intervalMs: 5000 · SimpleDataTable. Default filter: provider=${DEFAULT_PROVIDER}.`}
        actions={
          <Button variant="outline" size="sm" onClick={() => ratesState.reload()} disabled={ratesState.loading}>
            {ratesState.loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filter</CardTitle>
          <CardDescription className="font-mono text-xs">
            GET /v1/admin/custom-rates?provider=… · value is matched as provider UUID, else (lower(kind)=value OR lower(code)=value). Default <span className="font-mono">{DEFAULT_PROVIDER}</span>. Table uses <span className="font-mono">useInfraGet polling 5000</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 space-y-1.5">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={onProviderChange}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
                <SelectItem value="__custom">custom…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {provider === "__custom" ? (
            <div className="min-w-64 space-y-1.5">
              <Label htmlFor="custom-rates-provider">Custom provider (UUID / kind / code)</Label>
              <Input
                id="custom-rates-provider"
                value={customProvider}
                onChange={(e) => {
                  setCustomProvider(e.target.value)
                  setPage(1)
                }}
                placeholder="onidel (or UUID)"
                className="font-mono"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">provider={providerParam || DEFAULT_PROVIDER}</Badge>
            <span className="font-mono">
              {rows.length} rows · page {metaPage}
              {lastPage !== undefined ? ` of ${lastPage}` : ""} {typeof total === "number" ? `· ${total} total` : ""}
            </span>
            <span className="font-mono">GET /admin/custom-rates?provider={providerParam || DEFAULT_PROVIDER}&amp;page={metaPage}&amp;per_page={metaPerPage}</span>
          </div>
        </CardContent>
      </Card>

      {ratesState.error ? <ErrorBanner error={ratesState.error} /> : null}
      {providersState.error ? <ErrorBanner error={providersState.error} /> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">History — GET /admin/custom-rates?provider={providerParam || DEFAULT_PROVIDER}</CardTitle>
          <CardDescription>
            Each row is one custom_resource_rates version (active_from → active_until). Newer first. Polled every 5s via <span className="font-mono">useInfraGet intervalMs: 5000</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SimpleDataTable<CustomRateRow>
            columns={columns}
            rows={rows}
            loading={ratesState.loading}
            error={null}
            getRowKey={(r) => r.id}
            emptyMessage={`No custom rates for provider=${providerParam || DEFAULT_PROVIDER} — add one at /finance/rates (POST /admin/custom-rates) then revisit. Try a different filter via the control above.`}
            skeletonRows={6}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground font-mono">
              {typeof total === "number" ? `${total} total · ` : ""}
              page {metaPage}
              {lastPage !== undefined ? ` of ${lastPage}` : ""} · {metaPerPage}/page · polling 5s
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={!canPrev || ratesState.loading} onClick={() => goPage(metaPage - 1)}>
                Prev
              </Button>
              <Button variant="outline" size="sm" disabled={!canNext || ratesState.loading} onClick={() => goPage(metaPage + 1)}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What this query does</CardTitle>
          <CardDescription>Backend: handlers_admin_catalog.go — adminListCustomRates + ?provider= filter.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            <span className="font-mono font-medium">GET /v1/admin/custom-rates?provider=onidel</span> →
            filtered <span className="font-mono">custom_resource_rates</span> where <span className="font-mono">provider_id</span> maps to a provider whose <span className="font-mono">code/kind = onidel</span> (or a raw UUID match). Unknown <span className="font-mono">?provider</span> simply returns an empty list. Pagination is <span className="font-mono">?page/&amp;per_page</span> with <span className="font-mono">meta.page/per_page/total</span>.
          </p>
          <p>
            RBAC: <span className="font-mono">admin.Get(&quot;/custom-rates&quot;, requireStaff(&quot;billing&quot;), …)</span> in <span className="font-mono">backend/internal/api/server.go</span> — platform_admin + finance only (NOC 403). Frontend uses <span className="font-mono">useInfraGet intervalMs: 5000</span> + <span className="font-mono">SimpleDataTable</span> (no ProviderShell — this is a finance surface, not a per-provider infra page).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
