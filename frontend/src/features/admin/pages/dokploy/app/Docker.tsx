import { useState } from "react"
import { toast } from "sonner"
import { EyeIcon, PlayIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { dokploy } from "./shared"
import {
  ConfirmButton,
  DisabledOpCard,
  FieldCard,
  K5Page,
  OperationConsole,
  RawResultCard,
  ServerSelect,
  StatusBadge,
  TextField,
  idFrom,
  mutate,
  textValue,
  type Row,
} from "./k5-common"

function withServerId(serverId: string) {
  return serverId ? { serverId } : undefined
}

export default function DokployDockerPage() {
  const [serverId, setServerId] = useState("")
  return (
    <K5Page title="Docker" description="Generic Docker operation console backed by Dokploy upstream operations.">
      <FieldCard title="Scope" description="Leave as Dokploy server or select a remote server for server-aware Docker ops.">
        <ServerSelect value={serverId} onChange={setServerId} />
      </FieldCard>
      <Tabs defaultValue="containers">
        <TabsList>
          <TabsTrigger value="containers">Containers</TabsTrigger>
          <TabsTrigger value="swarm">Swarm</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="volumes">Volumes</TabsTrigger>
          <TabsTrigger value="networks">Networks</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="disk">Disk usage</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>
        <TabsContent value="containers">
          <ContainersTab serverId={serverId} />
        </TabsContent>
        <TabsContent value="swarm">
          <SwarmTab serverId={serverId} />
        </TabsContent>
        <TabsContent value="images">
          <ImagesTab serverId={serverId} />
        </TabsContent>
        <TabsContent value="volumes">
          <VolumesTab serverId={serverId} />
        </TabsContent>
        <TabsContent value="networks">
          <NetworksTab serverId={serverId} />
        </TabsContent>
        <TabsContent value="events">
          <OperationConsole title="Docker events" description="docker.getEvents from the last 60 minutes." serverId={serverId} loader={(query) => dokploy("GET", "docker.getEvents", undefined, { ...query, minutes: 60 })} />
        </TabsContent>
        <TabsContent value="disk">
          <DiskUsageTab serverId={serverId} />
        </TabsContent>
        <TabsContent value="health">
          <OperationConsole title="Server health" description="docker.getServerHealth for the selected server." serverId={serverId} loader={(query) => dokploy("GET", "docker.getServerHealth", undefined, { ...query, sinceHours: 24 })} />
        </TabsContent>
      </Tabs>
    </K5Page>
  )
}

function ContainersTab({ serverId }: { serverId: string }) {
  const [result, setResult] = useState<unknown>(null)
  const [config, setConfig] = useState<unknown>(null)
  const run = async (op: string, row: Row, reload: () => void) => {
    const containerId = idFrom(row, ["containerId", "Id", "ID", "id"])
    if (!containerId) {
      toast.error("Cannot infer containerId")
      return
    }
    const response = await mutate(() => dokploy("POST", op, { containerId, ...withServerId(serverId) }), `${op} accepted`, reload)
    setResult(response.result)
  }
  return (
    <div className="flex flex-col gap-4">
      <OperationConsole
        title="Containers"
        description="docker.getContainers with inspect/start/stop/restart/kill/remove lifecycle actions."
        serverId={serverId}
        loader={(query) => dokploy("GET", "docker.getContainers", undefined, query)}
        columns={[
          { key: "name", header: "Name", render: (row) => textValue(row, ["Names", "Name", "name", "containerName"]) },
          { key: "image", header: "Image", render: (row) => textValue(row, ["Image", "image"]) },
          { key: "state", header: "State", render: (row) => <StatusBadge value={textValue(row, ["State", "Status", "state", "status"], "unknown")} /> },
          { key: "ports", header: "Ports", render: (row) => textValue(row, ["Ports", "ports"]) },
        ]}
        actions={(row, reload) => {
          const containerId = idFrom(row, ["containerId", "Id", "ID", "id"])
          return (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" disabled={!containerId} onClick={() => void (async () => {
                if (!containerId) return
                setConfig(await dokploy("GET", "docker.getConfig", undefined, { containerId, ...withServerId(serverId) }))
              })()}>
                <EyeIcon data-icon="inline-start" />Inspect
              </Button>
              <Button variant="outline" size="sm" onClick={() => void run("docker.startContainer", row, reload)}><PlayIcon data-icon="inline-start" />Start</Button>
              <ConfirmButton label="Stop" title="Stop container?" description="Sends docker.stopContainer upstream." variant="outline" onConfirm={() => run("docker.stopContainer", row, reload)} />
              <Button variant="outline" size="sm" onClick={() => void run("docker.restartContainer", row, reload)}><RefreshCwIcon data-icon="inline-start" />Restart</Button>
              <ConfirmButton label="Kill" title="Kill container?" description="This force-kills the selected container." onConfirm={() => run("docker.killContainer", row, reload)} />
              <ConfirmButton label="Remove" title="Remove container?" description="This removes the selected container." onConfirm={() => run("docker.removeContainer", row, reload)} />
            </div>
          )
        }}
      />
      <RawResultCard title="Container inspect" result={config} />
      <RawResultCard title="Last container operation response" result={result} />
    </div>
  )
}

function ImagesTab({ serverId }: { serverId: string }) {
  const [config, setConfig] = useState<unknown>(null)
  return (
    <div className="flex flex-col gap-4">
      <OperationConsole
        title="Images"
        description="dockerImage.getImages with inspect and remove."
        serverId={serverId}
        loader={(query) => dokploy("GET", "dockerImage.getImages", undefined, query)}
        actions={(row, reload) => {
          const id = idFrom(row, ["Id", "ID", "id"])
          const repository = textValue(row, ["Repository", "repository"], "")
          const tag = textValue(row, ["Tag", "tag"], "latest")
          const imageRef = repository && tag ? `${repository}:${tag}` : id
          return (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={!imageRef} onClick={() => void (async () => {
                if (!imageRef) return
                setConfig(await dokploy("GET", "dockerImage.getImageConfig", undefined, { imageRef, ...withServerId(serverId) }))
              })()}>
                <EyeIcon data-icon="inline-start" />Inspect
              </Button>
              <ConfirmButton label="Remove" title="Remove image?" description="This removes the selected Docker image." disabled={!id || !repository} onConfirm={async () => { await mutate(() => dokploy("POST", "dockerImage.removeImage", { id, repository, tag, force: false, ...withServerId(serverId) }), "Image removed", reload) }} />
            </div>
          )
        }}
      />
      <RawResultCard title="Image config" result={config} />
    </div>
  )
}

function VolumesTab({ serverId }: { serverId: string }) {
  const [config, setConfig] = useState<unknown>(null)
  return (
    <div className="flex flex-col gap-4">
      <OperationConsole
        title="Volumes"
        description="dockerVolume.getVolumes with inspect and remove. File-manager ops stay in the generic explorer; this page keeps the core admin views real."
        serverId={serverId}
        loader={(query) => dokploy("GET", "dockerVolume.getVolumes", undefined, query)}
        actions={(row, reload) => {
          const volumeName = textValue(row, ["Name", "name", "volumeName"], "")
          return (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={!volumeName} onClick={() => void (async () => {
                if (!volumeName) return
                setConfig(await dokploy("GET", "dockerVolume.getVolumeConfig", undefined, { volumeName, ...withServerId(serverId) }))
              })()}>
                <EyeIcon data-icon="inline-start" />Inspect
              </Button>
              <ConfirmButton label="Remove" title="Remove volume?" description="This can delete persistent Docker volume data." disabled={!volumeName} onConfirm={async () => { await mutate(() => dokploy("POST", "dockerVolume.removeVolume", { volumeName, ...withServerId(serverId) }), "Volume removed", reload) }} />
            </div>
          )
        }}
      />
      <OperationConsole title="Volume sizes" serverId={serverId} loader={(query) => dokploy("GET", "dockerVolume.getVolumesSize", undefined, query)} />
      <RawResultCard title="Volume config" result={config} />
    </div>
  )
}

function NetworksTab({ serverId }: { serverId: string }) {
  const [inspect, setInspect] = useState<unknown>(null)
  const [network, setNetwork] = useState<unknown>(null)
  const [name, setName] = useState("")
  return (
    <div className="flex flex-col gap-4">
      <FieldCard title="Create network" description="Minimal network.create form; advanced IPAM/import remain available only through upstream endpoints.">
        <TextField label="Name" value={name} onChange={setName} placeholder="web" />
        <Button disabled={!name.trim()} onClick={() => void mutate(() => dokploy("POST", "network.create", { name: name.trim(), driver: "bridge", internal: false, attachable: true, enableIPv4: true, enableIPv6: false, ...withServerId(serverId) }), "Network created", () => setName(""))}>Create bridge network</Button>
      </FieldCard>
      <OperationConsole
        title="Networks"
        description="network.all with inspect, metadata read, recreate, and remove."
        serverId={serverId}
        loader={(query) => dokploy("GET", "network.all", undefined, query)}
        actions={(row, reload) => {
          const networkId = idFrom(row, ["networkId", "Id", "ID", "id"])
          return (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={!networkId} onClick={() => void (async () => {
                if (!networkId) return
                setInspect(await dokploy("GET", "network.inspect", undefined, { networkId }))
              })()}><EyeIcon data-icon="inline-start" />Inspect</Button>
              <Button variant="outline" size="sm" disabled={!networkId} onClick={() => void (async () => {
                if (!networkId) return
                setNetwork(await dokploy("GET", "network.one", undefined, { networkId }))
              })()}>Metadata</Button>
              <ConfirmButton label="Recreate" title="Recreate network?" description="This sends network.recreate upstream." variant="outline" disabled={!networkId} onConfirm={async () => { await mutate(() => dokploy("POST", "network.recreate", { networkId }), "Network recreated", reload) }} />
              <ConfirmButton label="Remove" title="Remove network?" description="This removes the selected Docker network." disabled={!networkId} onConfirm={async () => { await mutate(() => dokploy("POST", "network.remove", { networkId }), "Network removed", reload) }} />
            </div>
          )
        }}
      />
      <OperationConsole title="Networks to sync" serverId={serverId} loader={(query) => dokploy("GET", "network.networksToSync", undefined, query)} />
      <RawResultCard title="Network inspect" result={inspect} />
      <RawResultCard title="Network metadata" result={network} />
    </div>
  )
}

function DiskUsageTab({ serverId }: { serverId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <OperationConsole title="Disk usage" serverId={serverId} loader={(query) => dokploy("GET", "dockerDiskUsage.getDiskUsage", undefined, query)} />
      <OperationConsole
        title="Build cache"
        serverId={serverId}
        loader={(query) => dokploy("GET", "dockerDiskUsage.getBuildCache", undefined, query)}
        actions={(_row, reload) => (
          <ConfirmButton label="Prune" title="Prune build cache?" description="This removes Docker build cache for the selected server." onConfirm={async () => { await mutate(() => dokploy("POST", "dockerDiskUsage.pruneBuildCache", withServerId(serverId)), "Build cache pruned", reload) }} />
        )}
      />
    </div>
  )
}

function SwarmTab({ serverId }: { serverId: string }) {
  const [nodeId, setNodeId] = useState("")
  const [inspect, setInspect] = useState<unknown>(null)
  const [joinWorker, setJoinWorker] = useState<unknown>(null)
  const [joinManager, setJoinManager] = useState<unknown>(null)
  return (
    <div className="flex flex-col gap-4">
      <DisabledOpCard title="Swarm application info" description="Dokploy CE UI references swarm.getAppInfos, but v0.30.2 manifest does not include that operation." />
      <FieldCard title="Swarm cluster ops" description="Dokploy can return join instructions for workers/managers. Node removal is real; app summary still degrades because upstream op is missing.">
        <TextField label="Node ID" value={nodeId} onChange={setNodeId} placeholder="Inspect or remove a specific node" />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!nodeId.trim()} onClick={() => void (async () => setInspect(await dokploy("GET", "swarm.getNodeInfo", undefined, { nodeId: nodeId.trim(), ...withServerId(serverId) }))) }>
            <EyeIcon data-icon="inline-start" />Inspect node
          </Button>
          <Button variant="outline" onClick={() => void (async () => setJoinWorker(await dokploy("GET", "cluster.addWorker", undefined, withServerId(serverId))))}>
            <PlayIcon data-icon="inline-start" />Worker join token
          </Button>
          <Button variant="outline" onClick={() => void (async () => setJoinManager(await dokploy("GET", "cluster.addManager", undefined, withServerId(serverId))))}>
            <PlayIcon data-icon="inline-start" />Manager join token
          </Button>
          <ConfirmButton label="Remove worker" title="Remove worker node?" description="This sends cluster.removeWorker upstream for the typed node id." disabled={!nodeId.trim()} onConfirm={async () => { await mutate(() => dokploy("POST", "cluster.removeWorker", { nodeId: nodeId.trim(), ...withServerId(serverId) }), "Worker removed") }} />
        </div>
      </FieldCard>
      <OperationConsole title="Swarm nodes" serverId={serverId} loader={(query) => dokploy("GET", "swarm.getNodes", undefined, query)} />
      <OperationConsole title="Swarm node apps" serverId={serverId} loader={(query) => dokploy("GET", "swarm.getNodeApps", undefined, query)} />
      <OperationConsole title="Cluster nodes" serverId={serverId} loader={(query) => dokploy("GET", "cluster.getNodes", undefined, query)} />
      <RawResultCard title="Swarm node inspect" result={inspect} />
      <RawResultCard title="Worker join data" result={joinWorker} />
      <RawResultCard title="Manager join data" result={joinManager} />
    </div>
  )
}
