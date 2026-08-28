// Network: VPCs, firewall groups, IP lists and reserved IPs — every tab
// backed by the live customer-plane endpoints. Firewall groups and IP lists
// deep-link to their detail pages for rule / entry management.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { StatusBadge } from "../components"
import { formatDateTime } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface Vpc {
  id: string
  name: string
  description: string
  status: string
  ipv4_cidr: string
  created_at?: string
}

interface FirewallGroup {
  id: string
  name: string
  description: string
  instance_count: number
  rule_count: number
  created_at?: string
}

interface IpList {
  id: string
  name: string
  description: string
  entry_count: number
  created_at?: string
}

interface ReservedIp {
  id: string
  name: string
  ip_addr: string
  status: string
  attachment_instance?: string | null
  created_at?: string
}

export default function CustomerNetworkPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Network"
        description="VPCs, firewalls, IP lists and reserved addresses for this organization."
      />
      <Tabs defaultValue="vpcs">
        <TabsList className="flex-wrap">
          <TabsTrigger value="vpcs">VPCs</TabsTrigger>
          <TabsTrigger value="firewalls">Firewalls</TabsTrigger>
          <TabsTrigger value="ip-lists">IP lists</TabsTrigger>
          <TabsTrigger value="reserved-ips">Reserved IPs</TabsTrigger>
        </TabsList>
        <TabsContent value="vpcs">
          <VpcSection />
        </TabsContent>
        <TabsContent value="firewalls">
          <FirewallSection />
        </TabsContent>
        <TabsContent value="ip-lists">
          <IpListSection />
        </TabsContent>
        <TabsContent value="reserved-ips">
          <ReservedIpSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---- VPCs ---------------------------------------------------------------------

function VpcSection() {
  const { orgId } = useOrg()
  const [vpcs, setVpcs] = useState<Vpc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Vpc | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<Vpc[]>("/vpcs", { headers: orgHeaders(orgId) })
      setVpcs(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const runDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await apiDelete(`/vpcs/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success(`VPC "${deleteTarget.name}" deleted`)
      setDeleteTarget(null)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete VPC")
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<SimpleColumn<Vpc>> = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.description || "—"}</p>
        </div>
      ),
    },
    { key: "ipv4_cidr", header: "CIDR", render: (row) => <span className="font-mono text-sm">{row.ipv4_cidr || "—"}</span> },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "created_at", header: "Created", render: (row) => formatDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-16",
      render: (row) => (
        <div className="flex justify-end">
          <Button size="icon" variant="ghost" title="Delete…" onClick={() => setDeleteTarget(row)}>
            <Trash2Icon />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon /> New VPC
        </Button>
      </div>
      <SimpleDataTable
        columns={columns}
        rows={vpcs}
        loading={loading}
        error={error}
        emptyMessage={error ? undefined : "No VPCs yet."}
        getRowKey={(row) => row.id}
      />

      <CreateVpcDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete VPC “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Instances attached to it may lose connectivity.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CreateVpcDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { orgId } = useOrg()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [cidr, setCidr] = useState("10.10.0.0/16")
  const [regionId, setRegionId] = useState("")
  const [regions, setRegions] = useState<Array<{ id: string; name: string; code: string }>>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    apiGet<Array<{ id: string; name: string; code: string; enabled: boolean }>>("/regions")
      .then(({ data }) =>
        setRegions((data ?? []).filter((region) => region.enabled !== false)),
      )
      .catch(() => undefined)
  }, [open])

  useEffect(() => {
    if (regions.length > 0 && !regionId) {
      const t = setTimeout(() => setRegionId(regions[0].id), 0)
      return () => clearTimeout(t)
    }
  }, [regions, regionId])

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    if (!regionId) {
      toast.error("Region is required")
      return
    }
    setBusy(true)
    try {
      await apiPost(
        "/vpcs",
        {
          name: name.trim(),
          description: description.trim(),
          ipv4_cidr: cidr.trim() || undefined,
          region_id: regionId,
        },
        { headers: orgHeaders(orgId) },
      )
      toast.success("VPC created")
      setName("")
      setDescription("")
      onOpenChange(false)
      onCreated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create VPC")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New VPC</DialogTitle>
          <DialogDescription>A private network in one region.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="vpc-name">Name *</Label>
            <Input id="vpc-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vpc-region">Region *</Label>
            <Select value={regionId} onValueChange={setRegionId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose region" />
              </SelectTrigger>
              <SelectContent>
                {regions.map((region) => (
                  <SelectItem key={region.id} value={region.id}>
                    {region.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vpc-cidr">IPv4 CIDR</Label>
            <Input id="vpc-cidr" value={cidr} onChange={(event) => setCidr(event.target.value)} placeholder="10.10.0.0/16" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vpc-desc">Description</Label>
            <Input id="vpc-desc" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Firewalls ----------------------------------------------------------------

function FirewallSection() {
  const { orgId } = useOrg()
  const [groups, setGroups] = useState<FirewallGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FirewallGroup | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<FirewallGroup[]>("/firewall-groups", {
        headers: orgHeaders(orgId),
      })
      setGroups(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const runDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await apiDelete(`/firewall-groups/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success(`Firewall "${deleteTarget.name}" deleted`)
      setDeleteTarget(null)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete firewall")
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<SimpleColumn<FirewallGroup>> = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <Link
          to={`/app/network/firewall/${row.id}`}
          className="block max-w-72 truncate font-medium underline-offset-2 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    { key: "description", header: "Description" },
    { key: "rule_count", header: "Rules", render: (row) => String(row.rule_count ?? 0) },
    { key: "instance_count", header: "Instances", render: (row) => String(row.instance_count ?? 0) },
    { key: "created_at", header: "Created", render: (row) => formatDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-16",
      render: (row) => (
        <div className="flex justify-end">
          <Button size="icon" variant="ghost" title="Delete…" onClick={() => setDeleteTarget(row)}>
            <Trash2Icon />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon /> New firewall group
        </Button>
      </div>
      <SimpleDataTable
        columns={columns}
        rows={groups}
        loading={loading}
        error={error}
        emptyMessage={error ? undefined : "No firewall groups yet."}
        getRowKey={(row) => row.id}
      />

      <CreateFirewallDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete firewall “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>All its rules are removed as well.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CreateFirewallDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { orgId } = useOrg()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim() && !description.trim()) {
      toast.error("Name or description is required")
      return
    }
    setBusy(true)
    try {
      await apiPost(
        "/firewall-groups",
        { name: name.trim(), description: description.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Firewall group created")
      setName("")
      setDescription("")
      onOpenChange(false)
      onCreated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create firewall")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New firewall group</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fw-name">Name *</Label>
            <Input id="fw-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fw-desc">Description</Label>
            <Input id="fw-desc" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- IP lists -----------------------------------------------------------------

function IpListSection() {
  const { orgId } = useOrg()
  const [lists, setLists] = useState<IpList[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<IpList | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<IpList[]>("/ip-lists", { headers: orgHeaders(orgId) })
      setLists(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const runDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await apiDelete(`/ip-lists/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success(`IP list "${deleteTarget.name}" deleted`)
      setDeleteTarget(null)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete list")
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<SimpleColumn<IpList>> = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <Link
          to={`/app/ip-lists/${row.id}`}
          className="block max-w-72 truncate font-medium underline-offset-2 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    { key: "description", header: "Description" },
    { key: "entry_count", header: "Entries", render: (row) => String(row.entry_count ?? 0) },
    { key: "created_at", header: "Created", render: (row) => formatDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-16",
      render: (row) => (
        <div className="flex justify-end">
          <Button size="icon" variant="ghost" title="Delete…" onClick={() => setDeleteTarget(row)}>
            <Trash2Icon />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon /> New IP list
        </Button>
      </div>
      <SimpleDataTable
        columns={columns}
        rows={lists}
        loading={loading}
        error={error}
        emptyMessage={error ? undefined : "No IP lists yet."}
        getRowKey={(row) => row.id}
      />

      <CreateIpListDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete IP list “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>All entries go away with it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CreateIpListDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { orgId } = useOrg()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    setBusy(true)
    try {
      await apiPost(
        "/ip-lists",
        { name: name.trim(), description: description.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("IP list created")
      setName("")
      setDescription("")
      onOpenChange(false)
      onCreated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create list")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New IP list</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ipl-name">Name *</Label>
            <Input id="ipl-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ipl-desc">Description</Label>
            <Input id="ipl-desc" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// ---- Reserved IPs ---------------------------------------------------------------

function ReservedIpSection() {
  const { orgId } = useOrg()
  const [ips, setIps] = useState<ReservedIp[]>([])
  const [instances, setInstances] = useState<Array<{ id: string; name: string; primary_ipv4?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ReservedIp | null>(null)
  const [attachTarget, setAttachTarget] = useState<ReservedIp | null>(null)
  const [attachInstanceId, setAttachInstanceId] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const [ipsRes, instancesRes] = await Promise.all([
        apiGet<ReservedIp[]>("/reserved-ips", { headers: orgHeaders(orgId) }),
        apiGet<Array<{ id: string; name: string; primary_ipv4?: string }>>("/instances", {
          headers: orgHeaders(orgId),
        }),
      ])
      setIps(ipsRes.data ?? [])
      setInstances(instancesRes.data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const instanceName = (id: string | null | undefined) => {
    if (!id) return ""
    return instances.find((instance) => instance.id === id)?.name ?? id.slice(0, 8)
  }

  const runDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await apiDelete(`/reserved-ips/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success(`Reserved IP ${deleteTarget.ip_addr} released`)
      setDeleteTarget(null)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to release IP")
    } finally {
      setBusy(false)
    }
  }

  const attach = async () => {
    if (!attachTarget || !attachInstanceId) return
    setBusy(true)
    try {
      await apiPatch(
        `/reserved-ips/${attachTarget.id}`,
        { anchor_ip: attachInstanceId },
        { headers: orgHeaders(orgId) },
      )
      toast.success("IP attached to instance")
      setAttachTarget(null)
      setAttachInstanceId("")
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Attach failed")
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<SimpleColumn<ReservedIp>> = [
    { key: "ip_addr", header: "Address", render: (row) => <span className="font-mono text-sm">{row.ip_addr}</span> },
    { key: "name", header: "Name" },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "attachment_instance",
      header: "Attached to",
      render: (row) => (row.attachment_instance ? instanceName(row.attachment_instance) : "—"),
    },
    { key: "created_at", header: "Created", render: (row) => formatDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-32",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {!row.attachment_instance ? (
            <Button size="sm" variant="outline" onClick={() => setAttachTarget(row)}>
              Attach…
            </Button>
          ) : null}
          <Button size="icon" variant="ghost" title="Release…" onClick={() => setDeleteTarget(row)}>
            <Trash2Icon />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setConvertOpen(true)} disabled={instances.length === 0}>
          Convert VM IP…
        </Button>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon /> Reserve IP
        </Button>
      </div>
      <SimpleDataTable
        columns={columns}
        rows={ips}
        loading={loading}
        error={error}
        emptyMessage={error ? undefined : "No reserved IPs."}
        getRowKey={(row) => row.id}
      />

      <ReserveIpDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />
      <ConvertIpDialog open={convertOpen} onOpenChange={setConvertOpen} instances={instances} onConverted={() => void load()} />

      {/* Attach picker */}
      <Dialog open={attachTarget !== null} onOpenChange={(open) => !open && setAttachTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attach {attachTarget?.ip_addr}</DialogTitle>
            <DialogDescription>Pick the VM that should receive this address.</DialogDescription>
          </DialogHeader>
          <Select value={attachInstanceId} onValueChange={setAttachInstanceId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose instance" />
            </SelectTrigger>
            <SelectContent>
              {instances.map((instance) => (
                <SelectItem key={instance.id} value={instance.id}>
                  {instance.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachTarget(null)}>
              Cancel
            </Button>
            <Button disabled={!attachInstanceId || busy} onClick={() => void attach()}>
              Attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release {deleteTarget?.ip_addr}?</AlertDialogTitle>
            <AlertDialogDescription>The address returns to the pool and may not be reserved again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              Release
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ReserveIpDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { orgId } = useOrg()
  const [address, setAddress] = useState("")
  const [name, setName] = useState("")
  const [regionId, setRegionId] = useState("")
  const [regions, setRegions] = useState<Array<{ id: string; name: string; enabled: boolean }>>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    apiGet<Array<{ id: string; name: string; enabled: boolean }>>("/regions")
      .then(({ data }) => setRegions((data ?? []).filter((region) => region.enabled)))
      .catch(() => undefined)
  }, [open])

  const submit = async () => {
    if (!address.trim()) {
      toast.error("Address is required")
      return
    }
    setBusy(true)
    try {
      await apiPost(
        "/reserved-ips",
        { address: address.trim(), name: name.trim(), region_id: regionId || undefined },
        { headers: orgHeaders(orgId) },
      )
      toast.success("IP reserved")
      setAddress("")
      setName("")
      onOpenChange(false)
      onCreated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to reserve IP")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reserve an IP</DialogTitle>
          <DialogDescription>Reserve a specific address in a region for later attachment.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rip-address">Address *</Label>
            <Input id="rip-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="203.0.113.50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rip-name">Name</Label>
            <Input id="rip-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Region</Label>
            <Select value={regionId} onValueChange={setRegionId}>
              <SelectTrigger>
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                {regions.map((region) => (
                  <SelectItem key={region.id} value={region.id}>
                    {region.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            Reserve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConvertIpDialog({
  open,
  onOpenChange,
  instances,
  onConverted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  instances: Array<{ id: string; name: string; primary_ipv4?: string }>
  onConverted: () => void
}) {
  const { orgId } = useOrg()
  const [instanceId, setInstanceId] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      if (open && instances.length > 0 && !instanceId) setInstanceId(instances[0].id)
      if (!open) setInstanceId("")
    }, 0)
    return () => clearTimeout(t)
  }, [open, instances, instanceId])

  const selected = instances.find((instance) => instance.id === instanceId)

  const submit = async () => {
    if (!selected?.primary_ipv4) {
      toast.error("Selected instance has no primary IPv4")
      return
    }
    setBusy(true)
    try {
      await apiPost(
        "/reserved-ips/convert",
        { ip_address: selected.primary_ipv4, instance_id: instanceId, name: name.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Primary IP converted to a reserved IP")
      setName("")
      onOpenChange(false)
      onConverted()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Conversion failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert VM primary IP</DialogTitle>
          <DialogDescription>
            Keeps the address when the VM is destroyed by reserving it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Instance *</Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose instance" />
              </SelectTrigger>
              <SelectContent>
                {instances.map((instance) => (
                  <SelectItem key={instance.id} value={instance.id}>
                    {instance.name} ({instance.primary_ipv4 || "no IPv4"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rip-conv-name">Name</Label>
            <Input id="rip-conv-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !instanceId}>
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
