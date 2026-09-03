// Dokploy project detail — GET /admin/dokploy/projects/:id (mirror, infra readable, polling 5s)
// No provider :id segment — Dokploy is single-instance (murni dokploy).
// RBAC: GET infra (NOC readable), polled via useInfraGet intervalMs 5000.
// Related mirror tables (environments/applications) rendered with SimpleDataTable.
import { Link, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { JsonBlock } from "@/features/admin/pages/shared"
import { formatDateTime } from "@/features/admin/pages/format"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

interface DokployProjectRow {
  id: string
  remote_id: string
  org_id: string | null
  name: string
  description: string | null
  data: unknown
  created_at: string
  updated_at: string
}

interface MirrorList<T> {
  entity: string
  items: T[]
  total: number
  limit: number
  offset: number
}

interface EnvRow {
  remote_id: string
  project_remote_id: string
  name: string
  created_at: string
  data?: unknown
}

interface AppRow {
  remote_id: string
  project_remote_id: string | null
  environment_remote_id: string | null
  name: string
  status: string | null
  created_at: string
}

export default function DokployProjectDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const projectId = id.trim()

  const detail = useInfraGet<DokployProjectRow>(
    projectId ? `/admin/dokploy/projects/${encodeURIComponent(projectId)}` : null,
    undefined,
    { intervalMs: 5000 },
  )

  const envs = useInfraGet<MirrorList<EnvRow>>("/admin/dokploy/db/environments", { limit: 100, offset: 0 })
  const apps = useInfraGet<MirrorList<AppRow>>("/admin/dokploy/db/applications", { limit: 100, offset: 0 })

  const project = detail.data ?? null
  const relatedEnvs = project ? (envs.data?.items ?? []).filter((r) => r.project_remote_id === project.remote_id) : []
  const relatedApps = project ? (apps.data?.items ?? []).filter((r) => r.project_remote_id === project.remote_id) : []

  if (!projectId) {
    return (
      <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/admin/dokploy">Dokploy PaaS</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Project detail</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <PageHeader title="Dokploy project detail" description="GET /admin/dokploy/projects/:id — mirror row, infra readable, polling 5s." />
        <ErrorBanner error={new Error("Missing project id in route")} />
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/admin/dokploy">Dokploy PaaS</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/admin/dokploy/projects">Projects</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage className="font-mono">{projectId.slice(0, 12)}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={project ? project.name : "Dokploy project detail"}
        description={`GET /admin/dokploy/projects/:id — single mirror row, infra (NOC readable). Polling via useInfraGet intervalMs 5000. Related envs/apps filtered client-side from /admin/dokploy/db/* (limit 100).`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => detail.reload()} disabled={detail.loading}>
              {detail.loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/dokploy/db/projects">Mirror: projects</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/dokploy/app/projects">Upstream: Projects</Link>
            </Button>
          </div>
        }
      />

      {detail.error ? <ErrorBanner error={detail.error} /> : null}
      {envs.error ? <ErrorBanner error={envs.error} /> : null}
      {apps.error ? <ErrorBanner error={apps.error} /> : null}

      {detail.loading && !project ? (
        <p className="text-sm text-muted-foreground">Loading project…</p>
      ) : !project ? (
        <EmptyState message="Project not found." description={`No dokploy_projects row with id or remote_id ${projectId}. Run Sync from Dokploy first.`} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {project.name}
                <Badge variant="outline" className="font-mono text-xs">{project.remote_id.slice(0, 12)}</Badge>
                {project.org_id ? <Badge variant="secondary">org {project.org_id.slice(0, 8)}</Badge> : <Badge variant="outline">org —</Badge>}
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                id {project.id.slice(0, 8)}… · remote_id {project.remote_id} · GET /admin/dokploy/projects/:id · requireStaff infra · poll 5s
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Name</dt>
                  <dd className="font-medium">{project.name || "—"}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Description</dt>
                  <dd className="text-xs">{project.description || "—"}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Created</dt>
                  <dd className="font-mono text-xs">{formatDateTime(project.created_at)}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Updated</dt>
                  <dd className="font-mono text-xs">{formatDateTime(project.updated_at)}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">ID (uuid)</dt>
                  <dd className="font-mono text-xs break-all">{project.id}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Remote ID</dt>
                  <dd className="font-mono text-xs break-all">{project.remote_id}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Org</dt>
                  <dd className="font-mono text-xs">{project.org_id ?? "—"}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Polling</dt>
                  <dd className="font-mono text-xs">useInfraGet intervalMs 5000</dd>
                </div>
              </dl>

              <SimpleDataTable<Record<string, string>>
                columns={[
                  { key: "k", header: "Field" },
                  { key: "v", header: "Value", render: (r) => <span className="font-mono text-xs break-all">{r.v}</span> },
                ]}
                rows={[
                  { k: "id", v: project.id },
                  { k: "remote_id", v: project.remote_id },
                  { k: "org_id", v: project.org_id ?? "—" },
                  { k: "name", v: project.name || "—" },
                  { k: "description", v: project.description ?? "—" },
                  { k: "created_at", v: project.created_at || "—" },
                  { k: "updated_at", v: project.updated_at || "—" },
                ]}
                getRowKey={(r) => r.k}
                emptyMessage="No fields."
                skeletonRows={7}
              />

              <JsonBlock value={project.data ?? project} />

              <p className="text-xs text-muted-foreground">
                Endpoint: <span className="font-mono">GET /admin/dokploy/projects/:id</span> · RBAC{" "}
                <span className="font-mono">requireStaff infra</span> (NOC read, finance 403) · poll{" "}
                <span className="font-mono">useInfraGet intervalMs 5000</span> · storage{" "}
                <span className="font-mono">dokploy_projects</span> (remote_id UNIQUE, lookup by remote_id OR id::text).
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Environments — {relatedEnvs.length} for this project</CardTitle>
              <CardDescription>
                Filtered client-side from <span className="font-mono">GET /admin/dokploy/db/environments?limit=100</span> where{" "}
                <span className="font-mono">project_remote_id = {project.remote_id}</span>. Table via{" "}
                <span className="font-mono">SimpleDataTable</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<EnvRow>
                columns={[
                  { key: "name", header: "Name" },
                  { key: "remote_id", header: "Remote ID", render: (r) => <span className="font-mono text-xs">{r.remote_id.slice(0, 12)}</span> },
                  { key: "project_remote_id", header: "Project", render: (r) => <span className="font-mono text-xs">{r.project_remote_id.slice(0, 8)}</span> },
                  { key: "created_at", header: "Created", render: (r) => <span className="font-mono text-xs">{formatDateTime(r.created_at)}</span> },
                ]}
                rows={relatedEnvs}
                loading={envs.loading}
                error={envs.error}
                getRowKey={(r) => r.remote_id}
                emptyMessage="No environments for this project (mirror empty or project has none)."
                skeletonRows={3}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Applications — {relatedApps.length} for this project</CardTitle>
              <CardDescription>
                Filtered client-side from <span className="font-mono">GET /admin/dokploy/db/applications?limit=100</span> where{" "}
                <span className="font-mono">project_remote_id = {project.remote_id}</span>. Table via{" "}
                <span className="font-mono">SimpleDataTable</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<AppRow>
                columns={[
                  { key: "name", header: "Name" },
                  { key: "remote_id", header: "Remote ID", render: (r) => <span className="font-mono text-xs">{r.remote_id.slice(0, 12)}</span> },
                  { key: "status", header: "Status", render: (r) => r.status ? <Badge variant="secondary">{r.status}</Badge> : <span className="text-muted-foreground">—</span> },
                  { key: "environment_remote_id", header: "Env", render: (r) => <span className="font-mono text-xs">{r.environment_remote_id?.slice(0, 8) ?? "—"}</span> },
                  { key: "created_at", header: "Created", render: (r) => <span className="font-mono text-xs">{formatDateTime(r.created_at)}</span> },
                ]}
                rows={relatedApps}
                loading={apps.loading}
                error={apps.error}
                getRowKey={(r) => r.remote_id}
                emptyMessage="No applications for this project."
                skeletonRows={3}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
