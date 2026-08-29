// VMware (vCenter) drill-down: infrastructure inventory plus guest
// performance metrics. Both endpoints are NOC-readable; `perf` requires the
// guest external id (`?v=`) and a timeframe of hour or day.
import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RawResourceTable, RawDataView } from "./RawResourceTable"
import { useRawResource, autoColumns, type RawRow } from "./rawResourceUtils"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"

export function VmwareDrillDown({ providerId }: { providerId: string }) {
  const base = `/admin/providers/${providerId}`
  return (
    <Tabs defaultValue="inventory" className="gap-4">
      <TabsList>
        <TabsTrigger value="inventory">Inventory</TabsTrigger>
        <TabsTrigger value="perf">Guest performance</TabsTrigger>
      </TabsList>
      <TabsContent value="inventory">
        <InventoryView path={`${base}/inventory`} />
      </TabsContent>
      <TabsContent value="perf">
        <GuestPerfView providerId={providerId} />
      </TabsContent>
    </Tabs>
  )
}

/** The inventory payload groups hosts/datastores/clusters/resource pools. */
function InventoryView({ path }: { path: string }) {
  const { data, loading, error } = useRawResource(path)

  if (error || loading) return <RawDataView data={data} loading={loading} error={error} />

  const sections = collectArraySections(data)
  if (sections.length === 0) {
    // Unknown/flat shape — fall back to the generic renderer.
    return <RawDataView data={data} />
  }

  return (
    <div className="space-y-6">
      {sections.map(([title, rows]) => (
        <section key={title} className="space-y-2">
          <p className="text-sm font-medium capitalize">{title.replace(/_/g, " ")}</p>
          <SimpleDataTable
            columns={autoColumns(rows)}
            rows={rows}
            getRowKey={(row, index) => String(row.id ?? row.name ?? index)}
          />
        </section>
      ))}
    </div>
  )
}

function collectArraySections(data: unknown): Array<[string, RawRow[]]> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return []
  const sections: Array<[string, RawRow[]]> = []
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    const rows = value.filter((item): item is RawRow => typeof item === "object" && item !== null)
    if (rows.length > 0) sections.push([key, rows])
  }
  return sections
}

function GuestPerfView({ providerId }: { providerId: string }) {
  const [externalId, setExternalId] = useState("")
  const [timeframe, setTimeframe] = useState<"hour" | "day">("hour")
  const [submitted, setSubmitted] = useState<{ v: string; timeframe: "hour" | "day" } | null>(null)

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (externalId.trim()) setSubmitted({ v: externalId.trim(), timeframe })
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="guest-ext-id">Guest external ID</Label>
          <Input
            id="guest-ext-id"
            placeholder="e.g. vm-1234 or moRef"
            value={externalId}
            onChange={(event) => setExternalId(event.target.value)}
            className="w-64"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="perf-timeframe">Timeframe</Label>
          <Select value={timeframe} onValueChange={(value) => setTimeframe(value as "hour" | "day")}>
            <SelectTrigger id="perf-timeframe" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hour">Hour</SelectItem>
              <SelectItem value="day">Day</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={!externalId.trim()}>
          Fetch metrics
        </Button>
      </form>

      {submitted ? (
        <RawResourceTable
          key={`${submitted.v}:${submitted.timeframe}`}
          path={`/admin/providers/${providerId}/perf`}
          query={{ v: submitted.v, timeframe: submitted.timeframe }}
          emptyMessage="No metrics returned for this guest."
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Metrics come straight from the hypervisor&apos;s guest interface and cover CPU,
          memory and disk counters for the chosen window.
        </p>
      )}
    </div>
  )
}
