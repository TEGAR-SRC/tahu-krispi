// Pricing-relevant region list from GET /admin/regions, read-only: finance has
// no region mutation endpoints and provider details are out of scope (403 for
// this role), so only the provider ID reference is shown.
import { useCallback, useEffect, useMemo, useState } from "react"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "../lib"

interface Region {
  id: string
  provider_id: string
  external_id: string
  code: string
  name: string
  country_code: string
  city: string
  enabled: boolean
}

export default function FinanceRegionsPage() {
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [search, setSearch] = useState("")

  const bulk = useBulkSelection<Region>((row) => row.id)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<Region[]>("/admin/regions")
      setRegions(
        [...envelope.data].sort((a, b) => a.name.localeCompare(b.name)),
      )
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await load()
        } catch {
          if (!cancelled) setError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [load])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return regions
    return regions.filter(
      (region) =>
        region.code.toLowerCase().includes(needle) ||
        region.name.toLowerCase().includes(needle),
    )
  }, [regions, search])

  const columns: Array<SimpleColumn<Region>> = [
    {
      key: "code",
      header: "Code",
      render: (row) => <span className="font-mono text-xs">{row.code}</span>,
    },
    { key: "name", header: "Name" },
    { key: "city", header: "City", render: (row) => row.city || "—" },
    {
      key: "country_code",
      header: "Country",
      render: (row) => row.country_code || "—",
    },
    {
      key: "provider_id",
      header: "Provider",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.provider_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "enabled",
      header: "Status",
      render: (row) =>
        row.enabled ? <StatusBadge status="active" /> : <StatusBadge status="void" />,
    },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Regions"
        description="Provider regions available for pricing and placement. Read-only view."
        actions={
          <div className="flex min-w-0 items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by code or name…"
              className="h-8 w-48"
            />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <>
          <ErrorBanner error={error} />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Retry
          </Button>
        </>
      ) : loading ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          <BulkActionBar selectedCount={bulk.selectedKeys.size} actions={[]} />
          <SimpleDataTable
            columns={columns}
            rows={filtered}
            getRowKey={bulk.getRowKey}
            selectable
            selectedKeys={bulk.selectedKeys}
            onSelectionChange={bulk.onSelectionChange}
            emptyMessage={
              search.trim()
                ? `No regions match “${search.trim()}”.`
                : "No regions are registered yet."
            }
          />
        </>
      )}
    </div>
  )
}
