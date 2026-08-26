// Proxmox (PVE) drill-down for the NOC provider console. Every tab hits a
// real NOC-readable endpoint (requireStaff("infra") area); mutations on
// these surfaces are platform-admin only and therefore not offered here.
import { useMemo, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RawResourceTable } from "./RawResourceTable"
import { useRawResource, type RawRow } from "./rawResourceUtils"

const NODE_SUBRESOURCES = [
  { value: "detail", label: "Detail" },
  { value: "storages", label: "Storages" },
  { value: "tasks", label: "Tasks" },
  { value: "certs", label: "Certificates" },
  { value: "disks", label: "Disks" },
  { value: "dns", label: "DNS" },
  { value: "time", label: "Time" },
] as const

type NodeSubresource = (typeof NODE_SUBRESOURCES)[number]["value"]

export function ProxmoxDrillDown({ providerId }: { providerId: string }) {
  const base = `/admin/providers/${providerId}`
  return (
    <Tabs defaultValue="cluster" className="gap-4">
      <TabsList className="flex-wrap">
        <TabsTrigger value="cluster">Cluster</TabsTrigger>
        <TabsTrigger value="log">Cluster log</TabsTrigger>
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="storages">Storages</TabsTrigger>
        <TabsTrigger value="firewall">Firewall</TabsTrigger>
        <TabsTrigger value="hapools">HA &amp; Pools</TabsTrigger>
        <TabsTrigger value="sdn">SDN</TabsTrigger>
        <TabsTrigger value="ceph">Ceph</TabsTrigger>
        <TabsTrigger value="containers">Containers</TabsTrigger>
        <TabsTrigger value="backups">Backup jobs</TabsTrigger>
        <TabsTrigger value="node">Node inspector</TabsTrigger>
      </TabsList>

      <TabsContent value="cluster">
        <RawResourceTable
          path={`${base}/cluster`}
          emptyMessage="No cluster resources reported."
        />
      </TabsContent>
      <TabsContent value="log">
        <RawResourceTable path={`${base}/cluster/log`} query={{ max: 50 }} />
      </TabsContent>
      <TabsContent value="tasks">
        <RawResourceTable path={`${base}/cluster/tasks`} />
      </TabsContent>
      <TabsContent value="storages">
        <RawResourceTable path={`${base}/cluster-storages`} />
      </TabsContent>
      <TabsContent value="firewall">
        <FirewallSection providerId={providerId} />
      </TabsContent>
      <TabsContent value="hapools">
        <div className="space-y-6">
          <section className="space-y-2">
            <p className="text-sm font-medium">HA resources</p>
            <RawResourceTable path={`${base}/ha-resources`} />
          </section>
          <section className="space-y-2">
            <p className="text-sm font-medium">Pools</p>
            <RawResourceTable path={`${base}/pools`} />
          </section>
        </div>
      </TabsContent>
      <TabsContent value="sdn">
        <div className="space-y-6">
          <section className="space-y-2">
            <p className="text-sm font-medium">Zones</p>
            <RawResourceTable path={`${base}/sdn/zones`} />
          </section>
          <section className="space-y-2">
            <p className="text-sm font-medium">VNets</p>
            <RawResourceTable path={`${base}/sdn/vnets`} />
          </section>
        </div>
      </TabsContent>
      <TabsContent value="ceph">
        <RawResourceTable path={`${base}/ceph-status`} />
      </TabsContent>
      <TabsContent value="containers">
        <RawResourceTable path={`${base}/containers`} />
      </TabsContent>
      <TabsContent value="backups">
        <RawResourceTable path={`${base}/backup-jobs`} />
      </TabsContent>
      <TabsContent value="node">
        <NodeInspector providerId={providerId} />
      </TabsContent>
    </Tabs>
  )
}

function FirewallSection({ providerId }: { providerId: string }) {
  const base = `/admin/providers/${providerId}`
  const groups = useRawResource(`${base}/fw-groups`)

  const groupNames = useMemo(() => {
    if (!Array.isArray(groups.data)) return []
    return groups.data
      .filter((item): item is RawRow => typeof item === "object" && item !== null)
      .map((row) => String(row.group ?? row.name ?? ""))
      .filter((name) => name.length > 0)
  }, [groups.data])

  const [selectedGroup, setSelectedGroup] = useState<string>("")

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="text-sm font-medium">Security groups &amp; rules</p>
        {groupNames.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="fw-group-select" className="text-xs text-muted-foreground">
              Group
            </Label>
            <Select
              value={selectedGroup || groupNames[0]}
              onValueChange={setSelectedGroup}
            >
              <SelectTrigger id="fw-group-select" className="w-56">
                <SelectValue placeholder="Choose a group…" />
              </SelectTrigger>
              <SelectContent>
                {groupNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {(selectedGroup || groupNames[0]) && !groups.loading && !groups.error ? (
          <RawResourceTable
            key={selectedGroup || groupNames[0]}
            path={`${base}/fw-groups/${encodeURIComponent(selectedGroup || groupNames[0])}/rules`}
          />
        ) : (
          <RawResourceTable path={`${base}/fw-groups`} emptyMessage="No firewall groups." />
        )}
      </section>
      <section className="space-y-2">
        <p className="text-sm font-medium">Cluster-level rules</p>
        <RawResourceTable path={`${base}/firewall-rules`} />
      </section>
    </div>
  )
}

function NodeInspector({ providerId }: { providerId: string }) {
  const base = `/admin/providers/${providerId}`
  const cluster = useRawResource(`${base}/cluster`)

  const nodes = useMemo(() => {
    if (!Array.isArray(cluster.data)) return []
    return cluster.data
      .filter((item): item is RawRow => typeof item === "object" && item !== null)
      .filter((row) => row.type === undefined || row.type === "node")
      .map((row) => String(row.node ?? row.name ?? ""))
      .filter((name) => name.length > 0)
  }, [cluster.data])

  const [node, setNode] = useState("")
  const [sub, setSub] = useState<NodeSubresource>("detail")
  const activeNode = node || nodes[0] || ""

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="node-name-input" className="text-xs text-muted-foreground">
          Node
        </Label>
        {nodes.length > 0 ? (
          <Select value={activeNode} onValueChange={(value) => setNode(value)}>
            <SelectTrigger id="node-name-input" className="w-52">
              <SelectValue placeholder="Pick a node…" />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...(activeNode ? [activeNode] : []), ...nodes])].map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id="node-name-input"
            placeholder="e.g. pve-01"
            value={node}
            onChange={(event) => setNode(event.target.value)}
            className="w-52"
          />
        )}
        <Select value={sub} onValueChange={(value) => setSub(value as NodeSubresource)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Sub-resource" />
          </SelectTrigger>
          <SelectContent>
            {NODE_SUBRESOURCES.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeNode ? (
        <RawResourceTable
          key={`${activeNode}:${sub}`}
          path={`${base}/nodes/${encodeURIComponent(activeNode)}/${sub}`}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Choose or type a node name to inspect storages, tasks, certificates and disks.
        </p>
      )}
    </div>
  )
}
