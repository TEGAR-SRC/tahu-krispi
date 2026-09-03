// VMware datastore browse — per-provider file listing for a single vSphere datastore.
// Endpoint: GET /admin/vmware/:id/datastores/:ds/browse?path=/ (vmwareAdapterFor
// guard kind==vmware, requireStaff infra → NOC readable, finance 403). Polling 5s
// via useInfraGet. Adapter uses HostDatastoreBrowser.SearchDatastore with
// HostDatastoreBrowserSearchSpec match "*" + FileQueryFlags, folder-first sorted.
// Route: /admin/vmware/:providerId/datastores/:ds/browse
import { useCallback, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { JsonBlock } from "@/features/admin/pages/shared"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { formatBytes, useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

interface BrowseFile {
  path: string
  friendly_name?: string
  file_size: number
  modification?: string | null
  owner?: string
  type?: string
  is_folder: boolean
}

interface BrowsePayload {
  code: string
  datastore: string
  path: string
  folder_path: string
  files: BrowseFile[]
  total: number
}

function formatTime(raw?: string | null): string {
  if (!raw) return "—"
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleString()
}

function joinPath(base: string, child: string): string {
  const a = base === "/" ? "" : base.replace(/\/+$/, "")
  const b = child.replace(/^\/+/, "")
  if (!a) return `/${b}`
  return `${a}/${b}`
}

function parentPath(p: string): string {
  if (p === "/" || p === "") return "/"
  const trimmed = p.replace(/\/+$/, "")
  const idx = trimmed.lastIndexOf("/")
  if (idx <= 0) return "/"
  return trimmed.slice(0, idx) || "/"
}

export default function VmwareDatastoreBrowsePage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const ds = (params.ds ?? (params as Record<string, string>).datastore ?? "") as string
  const decodedDs = useMemo(() => {
    try {
      return decodeURIComponent(ds)
    } catch {
      return ds
    }
  }, [ds])

  const [path, setPath] = useState("/")
  const [pendingPath, setPendingPath] = useState("/")
  const [selectedFile, setSelectedFile] = useState<BrowseFile | null>(null)

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(() => providers.data?.find((row) => row.id === providerId) ?? null, [providers.data, providerId])
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const browse = useInfraGet<BrowsePayload>(
    providerId && ds && isVmware ? `/admin/vmware/${providerId}/datastores/${encodeURIComponent(decodedDs)}/browse` : null,
    isVmware ? { path } : undefined,
    { intervalMs: 5000 },
  )

  const files: BrowseFile[] = Array.isArray(browse.data?.files) ? browse.data!.files : []
  const effectivePath = browse.data?.path ?? path
  const folderPath = browse.data?.folder_path ?? ` [${decodedDs}] ${path}`

  const goUp = useCallback(() => {
    const up = parentPath(path)
    setPath(up)
    setPendingPath(up)
    setSelectedFile(null)
  }, [path])

  const onEnterFolder = useCallback(
    (row: BrowseFile) => {
      const next = joinPath(path, row.path)
      setPath(next)
      setPendingPath(next)
      setSelectedFile(null)
    },
    [path],
  )

  if (!providerId || !ds) {
    return (
      <ProviderShell providerId={providerId} title="VMware datastore browse" description="Browse files inside a vSphere datastore via HostDatastoreBrowser.">
        <ErrorBanner error={new Error("Missing providerId or ds in route params")} />
      </ProviderShell>
    )
  }

  if (browse.error instanceof ApiError && browse.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="VMware datastore browse" description="Browse files inside a vSphere datastore via HostDatastoreBrowser.">
        <EmptyState
          message="Datastore browse is only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Switch to a vmware provider and retry GET /v1/admin/vmware/:id/datastores/:ds/browse."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — datastore browse at{" "}
              <span className="font-mono">/admin/vmware/:id/datastores/:ds/browse</span> requires <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`VMware datastore browse — ${decodedDs}`}
      description={`Browse inside datastore ${decodedDs} via GET /v1/admin/vmware/:id/datastores/:ds/browse?path= — polling every 5s.`}
    >
      {providers.error ? <ErrorBanner error={providers.error} /> : null}

      {match ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
              Provider lookup
              <Badge variant="outline">{match.code}</Badge>
              <Badge variant={isVmware ? "secondary" : "destructive"}>{match.kind}</Badge>
              {match.enabled ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">disabled</Badge>}
              <span className="font-mono text-xs text-muted-foreground">{match.id.slice(0, 8)}…</span>
              <Badge variant="outline">{match.health_status || "unknown"}</Badge>
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              api_base_url {match.api_base_url || "—"} · has_credentials {String(match.has_credentials)} · endpoint{" "}
              <span className="font-mono">GET /v1/admin/vmware/:id/datastores/:ds/browse?path=</span> — RBAC{" "}
              <span className="font-mono">requireStaff infra</span> (NOC read, finance 403) · poll{" "}
              <span className="font-mono">useInfraGet intervalMs 5000</span> · folder_first sorted via{" "}
              <span className="font-mono">HostDatastoreBrowser</span>
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState
                message="This provider is not vmware."
                description={`Kind is ${match.kind} — datastore browse at /admin/vmware/:id/datastores/:ds/browse answers 501.`}
              />
            </CardContent>
          ) : null}
          {!match.has_credentials && match.kind === "vmware" ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — datastore browse answers HTTP 503 until an API key is configured via the provider editor.
              </p>
            </CardContent>
          ) : null}
        </Card>
      ) : providers.loading ? (
        <p className="text-sm text-muted-foreground">Resolving provider…</p>
      ) : null}

      {!kindMismatch ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => browse.reload()} disabled={browse.loading}>
              {browse.loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/datastores`}>Datastores</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/datastores/${encodeURIComponent(decodedDs)}`}>Detail</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/inventory`}>Inventory</Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Polling <span className="font-mono">GET /admin/vmware/:id/datastores/:ds/browse?path=</span> every 5s via{" "}
              <span className="font-mono">useInfraGet</span>.
            </span>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Path</CardTitle>
              <CardDescription>
                Datastore-relative path inside <span className="font-mono">[{decodedDs}]</span> — empty or <span className="font-mono">/</span> is the
                datastore root. Folders render first.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="browse-path" className="text-xs">
                    Datastore path
                  </Label>
                  <Input
                    id="browse-path"
                    value={pendingPath}
                    onChange={(e) => setPendingPath(e.target.value)}
                    placeholder="/"
                    className="font-mono text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const next = pendingPath.trim() || "/"
                        setPath(next)
                        setPendingPath(next)
                        setSelectedFile(null)
                      }
                    }}
                  />
                  <p className="font-mono text-xs text-muted-foreground">
                    Effective <span className="font-mono">{effectivePath}</span> · folder{" "}
                    <span className="font-mono">{folderPath}</span> · {files.length} entries
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    const next = pendingPath.trim() || "/"
                    setPath(next)
                    setPendingPath(next)
                    setSelectedFile(null)
                  }}
                >
                  Browse
                </Button>
                <Button variant="outline" size="sm" disabled={path === "/"} onClick={goUp}>
                  Up
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Quick:</span>
                <Button variant="outline" size="sm" onClick={() => { setPath("/"); setPendingPath("/"); setSelectedFile(null) }}>
                  /
                </Button>
                <span className="font-mono text-muted-foreground">· current</span>
                <Badge variant="outline" className="font-mono">
                  {path}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <ErrorBanner error={browse.error} />

          {browse.loading ? (
            <p className="text-sm text-muted-foreground">Loading browse…</p>
          ) : browse.error ? null : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Files — [{decodedDs}] {effectivePath}
                  </CardTitle>
                  <CardDescription>
                    SearchDatastore with match <span className="font-mono">*</span> + FileQueryFlags. Click a folder to descend.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SimpleDataTable<BrowseFile>
                    columns={[
                      {
                        key: "path",
                        header: "Name",
                        render: (row) =>
                          row.is_folder ? (
                            <button
                              type="button"
                              onClick={() => onEnterFolder(row)}
                              className="text-left font-mono text-xs font-medium text-primary hover:underline"
                            >
                              {row.path} /
                            </button>
                          ) : (
                            <span className="font-mono text-xs">{row.path}</span>
                          ),
                      },
                      {
                        key: "type",
                        header: "Type",
                        render: (row) => <Badge variant={row.is_folder ? "secondary" : "outline"}>{row.type || (row.is_folder ? "Folder" : "—")}</Badge>,
                      },
                      {
                        key: "file_size",
                        header: "Size",
                        render: (row) => (row.is_folder ? "—" : formatBytes(row.file_size)),
                      },
                      {
                        key: "modification",
                        header: "Modified",
                        render: (row) => <span className="font-mono text-xs">{formatTime(row.modification)}</span>,
                      },
                      {
                        key: "owner",
                        header: "Owner",
                        className: "hidden md:table-cell",
                        render: (row) => <span className="font-mono text-xs">{row.owner || "—"}</span>,
                      },
                      {
                        key: "actions",
                        header: "",
                        className: "w-28 text-right",
                        render: (row) => (
                          <div className="flex justify-end gap-1">
                            {row.is_folder ? (
                              <Button variant="outline" size="sm" onClick={() => onEnterFolder(row)}>
                                Open
                              </Button>
                            ) : null}
                            <Button variant="outline" size="sm" onClick={() => setSelectedFile(row)}>
                              Inspect
                            </Button>
                          </div>
                        ),
                      },
                    ]}
                    rows={files}
                    loading={browse.loading}
                    error={null}
                    getRowKey={(row) => `${String(row.path)}:${row.is_folder ? "d" : "f"}`}
                    emptyMessage={path === "/" ? "Datastore is empty." : `No entries under ${path}.`}
                    skeletonRows={6}
                  />
                </CardContent>
              </Card>

              {selectedFile ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Inspect — {selectedFile.path}</CardTitle>
                    <CardDescription>Raw HostDatastoreBrowser entry.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <SimpleDataTable<Record<string, string>>
                      columns={[
                        { key: "k", header: "Field" },
                        { key: "v", header: "Value", render: (r) => <span className="font-mono text-xs">{r.v}</span> },
                      ]}
                      rows={[
                        { k: "path", v: selectedFile.path },
                        { k: "friendly_name", v: selectedFile.friendly_name || "—" },
                        { k: "type", v: selectedFile.type || "—" },
                        { k: "is_folder", v: String(selectedFile.is_folder) },
                        { k: "file_size", v: `${selectedFile.file_size} (${formatBytes(selectedFile.file_size)})` },
                        { k: "modification", v: formatTime(selectedFile.modification) },
                        { k: "owner", v: selectedFile.owner || "—" },
                      ]}
                      getRowKey={(r) => r.k}
                      emptyMessage="No fields."
                      skeletonRows={4}
                    />
                    <JsonBlock value={selectedFile} />
                    <Button variant="outline" size="sm" onClick={() => setSelectedFile(null)}>
                      Clear selection
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <p className="text-xs text-muted-foreground">Select a row above to see its raw payload. Folders can be opened to browse deeper.</p>
              )}

              <JsonBlock value={browse.data} />
            </>
          )}
        </>
      ) : null}
    </ProviderShell>
  )
}
