import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/shared/PageHeader"
import { dokploy, useUpstream } from "./shared"
import {
  EmptyList,
  EntityCard,
  ErrorAlert,
  LoadingCards,
  RawJsonCard,
  firstString,
  rows,
  s,
  type Row,
} from "./k1-helpers"

interface HomePayload {
  stats: unknown
  deployments: unknown
  user: unknown
  permissions: unknown
}

export default function DokployHomePage() {
  const home = useUpstream<HomePayload>(
    async () => {
      const [stats, deployments, user, permissions] = await Promise.all([
        dokploy("GET", "project.homeStats"),
        dokploy("GET", "deployment.allCentralized"),
        dokploy("GET", "user.get"),
        dokploy("GET", "user.getPermissions"),
      ])
      return { stats, deployments, user, permissions }
    },
    [],
  )

  const statRows = flattenStats(home.data?.stats)
  const deploymentRows = rows(home.data?.deployments)
  const user = home.data?.user && typeof home.data.user === "object" ? (home.data.user as Row) : null
  const permissionRows = rows(home.data?.permissions)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dokploy home"
        description="Live project stats, recent centralized deployments, and current upstream user context."
        actions={
          <Button variant="outline" asChild>
            <Link to="/admin/dokploy/app/projects">Open projects</Link>
          </Button>
        }
      />

      {home.loading ? <LoadingCards count={6} /> : null}
      {home.error ? <ErrorAlert error={home.error} /> : null}

      {home.data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {statRows.length ? (
              statRows.map((stat) => (
                <Card key={stat.label}>
                  <CardHeader>
                    <CardDescription>{stat.label}</CardDescription>
                    <CardTitle className="text-lg sm:text-2xl">{stat.value}</CardTitle>
                  </CardHeader>
                </Card>
              ))
            ) : (
              <RawJsonCard title="project.homeStats" value={home.data.stats} />
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Recent deployments</CardTitle>
                <CardDescription>From deployment.allCentralized.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {deploymentRows.length ? (
                  deploymentRows.slice(0, 12).map((deployment, index) => (
                    <EntityCard
                      key={firstString(deployment, ["deploymentId", "id"]) || index.toString()}
                      title={firstString(deployment, ["title", "name", "appName", "serviceName"]) || "Deployment"}
                      description={firstString(deployment, ["message", "commitMessage", "createdAt", "startedAt"])}
                      badge={firstString(deployment, ["status", "deploymentStatus", "type"])}
                    >
                      <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs">
                        {JSON.stringify(deployment, null, 2)}
                      </pre>
                    </EntityCard>
                  ))
                ) : (
                  <EmptyList message="No centralized deployments" description="The upstream deployment list returned no rows." />
                )}
              </CardContent>
            </Card>

            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Current user</CardTitle>
                  <CardDescription>From user.get.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div>{firstString(user, ["name", "email", "username"]) || "Unknown user"}</div>
                  {user ? (
                    <pre className="max-h-52 overflow-auto rounded-md bg-muted p-2 text-xs">
                      {JSON.stringify(user, null, 2)}
                    </pre>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Permissions</CardTitle>
                  <CardDescription>From user.getPermissions.</CardDescription>
                </CardHeader>
                <CardContent>
                  {permissionRows.length ? (
                    <div className="flex flex-col gap-2 text-sm">
                      {permissionRows.slice(0, 20).map((permission, index) => (
                        <div key={index} className="rounded-md bg-muted p-2">
                          {s(permission.action) || s(permission.permission) || JSON.stringify(permission)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <pre className="max-h-52 overflow-auto rounded-md bg-muted p-2 text-xs">
                      {JSON.stringify(home.data.permissions, null, 2)}
                    </pre>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function flattenStats(value: unknown): Array<{ label: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value as Row)
    .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
    .map(([label, item]) => ({ label, value: String(item) }))
}
