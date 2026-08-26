// NOC firewall console: PVE security groups with their per-group rules plus
// the cluster-level ruleset. Rule/group mutations are platform-admin only.
import { useState } from "react"
import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { AdminOnlyHint, type PveFwGroup, type PveFwRule, ProviderSurfaceNote, useNocProvider, useTyped } from "./pve"
import { ProviderSubBreadcrumb } from "./ProviderDetail"

const ruleColumns: Array<SimpleColumn<PveFwRule>> = [
  { key: "pos", header: "Pos", render: (row) => row.pos ?? "—" },
  {
    key: "enable",
    header: "Enabled",
    render: (row) => (
      <Badge variant={row.enable === 0 ? "secondary" : "default"}>
        {row.enable === 0 ? "disabled" : "enabled"}
      </Badge>
    ),
  },
  { key: "type", header: "Dir", render: (row) => <Badge variant="outline">{row.type ?? "—"}</Badge> },
  {
    key: "action",
    header: "Action",
    render: (row) => {
      const action = (row.action ?? "").toUpperCase()
      return (
        <Badge variant={action.startsWith("ACCEPT") ? "default" : action ? "destructive" : "outline"}>
          {row.action || "—"}
        </Badge>
      )
    },
  },
  { key: "source", header: "Source", render: (row) => <span className="font-mono text-xs">{row.source || "—"}</span> },
  { key: "dest", header: "Dest", render: (row) => <span className="font-mono text-xs">{row.dest || "—"}</span> },
  { key: "proto", header: "Proto", render: (row) => row.proto || row.macro || "—" },
  {
    key: "ports",
    header: "Ports",
    render: (row) =>
      [row.dport, row.sport].filter(Boolean).length > 0
        ? `${row.dport || "*"} ← ${row.sport || "*"}`
        : "—",
  },
  { key: "comment", header: "Comment", render: (row) => <span className="break-all text-xs">{row.comment ?? "—"}</span> },
]

export default function NocProviderFirewallPage() {
  const providerId = useParams().providerId ?? ""
  const { provider } = useNocProvider(providerId)
  const base = `/admin/providers/${providerId}`

  const groups = useTyped<PveFwGroup[]>(`${base}/fw-groups`)
  const clusterRules = useTyped<PveFwRule[]>(`${base}/firewall-rules`)

  const [groupName, setGroupName] = useState("")
  const activeGroup = groupName || groups.data?.[0]?.group || ""

  return (
    <div className="flex flex-col gap-6">
      <ProviderSubBreadcrumb providerId={providerId} providerName={provider?.name} page="Firewall" />
      <PageHeader
        title="Cluster firewall"
        description="Security groups, their rule matrices and the cluster-level ruleset — read-only."
        actions={<AdminOnlyHint />}
      />
      <ProviderSurfaceNote
        kind={provider?.kind} />

      <Tabs defaultValue="groups" className="gap-4">
        <TabsList>
          <TabsTrigger value="groups">Security groups</TabsTrigger>
          <TabsTrigger value="cluster">Cluster rules</TabsTrigger>
        </TabsList>

        <TabsContent value="groups" className="space-y-4">
          {groups.error ? (
            <ErrorBanner error={groups.error} />
          ) : (
            <>
              <SimpleDataTable<PveFwGroup>
                columns={[
                  { key: "group", header: "Group", render: (row) => row.group ?? "—" },
                  { key: "comment", header: "Comment", render: (row) => row.comment ?? "—" },
                ]}
                rows={groups.data ?? []}
                loading={groups.loading}
                skeletonRows={3}
                emptyMessage="No security groups defined on this cluster."
                getRowKey={(row) => row.group ?? Math.random().toString()}
              />

              {activeGroup ? (
                <section className="space-y-2">
                  <div className="flex items-center gap-3">
                    <Label htmlFor="fw-group-rules-select" className="text-sm text-muted-foreground">
                      Rules of group
                    </Label>
                    <Select value={activeGroup} onValueChange={setGroupName}>
                      <SelectTrigger id="fw-group-rules-select" className="w-56">
                        <SelectValue placeholder="Choose a group…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(groups.data ?? [])
                          .filter((row) => row.group)
                          .map((row) => (
                            <SelectItem key={row.group} value={row.group!}>
                              {row.group}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <GroupRules base={base} group={activeGroup} />
                </section>
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="cluster">
          {clusterRules.error ? (
            <ErrorBanner error={clusterRules.error} />
          ) : (
            <SimpleDataTable<PveFwRule>
              columns={ruleColumns}
              rows={clusterRules.data ?? []}
              loading={clusterRules.loading}
              skeletonRows={5}
              emptyMessage="The cluster-level firewall has no rules."
              getRowKey={(row) => String(row.pos ?? Math.random())}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function GroupRules({ base, group }: { base: string; group: string }) {
  const rules = useTyped<PveFwRule[]>(`${base}/fw-groups/${encodeURIComponent(group)}/rules`)

  if (rules.error) return <ErrorBanner error={rules.error} />
  return (
    <SimpleDataTable<PveFwRule>
      columns={ruleColumns}
      rows={rules.data ?? []}
      loading={rules.loading}
      skeletonRows={4}
      emptyMessage={`No rules in group ${group}.`}
      getRowKey={(row) => String(row.pos ?? Math.random())}
    />
  )
}
