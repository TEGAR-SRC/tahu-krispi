import { Link } from "react-router-dom"
import { PlusIcon } from "lucide-react"
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
  ConfirmMutation,
  EmptyList,
  EntityCard,
  ErrorAlert,
  JsonMutationDialog,
  LoadingCards,
  firstString,
  rows,
  s,
  type Row,
} from "./k1-helpers"

interface ProjectsPayload {
  projects: unknown
  tags: unknown
}

export default function DokployProjectsPage() {
  const upstream = useUpstream<ProjectsPayload>(
    async () => {
      const [projects, tags] = await Promise.all([
        dokploy("GET", "project.all"),
        dokploy("GET", "tag.all"),
      ])
      return { projects, tags }
    },
    [],
  )

  const projects = rows(upstream.data?.projects)
  const tags = rows(upstream.data?.tags)

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Real upstream Dokploy projects with project CRUD and tag bulk-assignment."
        actions={
          <JsonMutationDialog
            title="Create project"
            description="Submits project.create to the Dokploy proxy. Adjust the JSON to match your upstream server."
            op="project.create"
            initial={{ name: "New project", description: "" }}
            onSuccess={upstream.reload}
            trigger={
              <Button>
                <PlusIcon data-icon="inline-start" />
                Create project
              </Button>
            }
          />
        }
      />

      {upstream.loading ? <LoadingCards count={6} /> : null}
      {upstream.error ? <ErrorAlert error={upstream.error} /> : null}

      {upstream.data ? (
        <>
          {tags.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Available tags</CardTitle>
                <CardDescription>Fetched with tag.all. Use each project card to submit tag.bulkAssign.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 text-sm">
                {tags.map((tag, index) => (
                  <span key={firstString(tag, ["tagId", "id"]) || index.toString()} className="rounded-md bg-muted px-2 py-1">
                    {firstString(tag, ["name", "label", "tagId", "id"]) || "Tag"}
                  </span>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {projects.length ? (
            <div className="grid w-full max-w-full min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((project, index) => {
                const projectId = firstString(project, ["projectId", "id"])
                const firstEnvironment = getFirstEnvironment(project)
                const environmentId = firstString(firstEnvironment, ["environmentId", "id"])
                const boardPath = projectId && environmentId ? `/admin/dokploy/app/p/${projectId}/e/${environmentId}` : undefined

                return (
                  <EntityCard
                    key={projectId || index.toString()}
                    title={firstString(project, ["name", "projectName"]) || "Project"}
                    description={firstString(project, ["description", "createdAt"])}
                    badge={projectId || undefined}
                    to={boardPath}
                    actions={
                      <>
                        {boardPath ? (
                          <Button variant="outline" size="sm" asChild>
                            <Link to={boardPath}>Open board</Link>
                          </Button>
                        ) : null}
                        <JsonMutationDialog
                          title="Update project"
                          op="project.update"
                          initial={{ projectId, name: firstString(project, ["name", "projectName"]), description: s(project.description) }}
                          onSuccess={upstream.reload}
                          trigger={<Button variant="outline" size="sm">Update</Button>}
                        />
                        <JsonMutationDialog
                          title="Duplicate project"
                          op="project.duplicate"
                          initial={{ projectId, name: `${firstString(project, ["name", "projectName"]) || "Project"} copy` }}
                          onSuccess={upstream.reload}
                          trigger={<Button variant="outline" size="sm">Duplicate</Button>}
                        />
                        <JsonMutationDialog
                          title="Bulk assign tags"
                          description="Use tag IDs from tag.all; this sends tag.bulkAssign."
                          op="tag.bulkAssign"
                          initial={{ projectId, tagIds: tags.map((tag) => firstString(tag, ["tagId", "id"])).filter(Boolean) }}
                          onSuccess={upstream.reload}
                          trigger={<Button variant="outline" size="sm">Assign tags</Button>}
                        />
                        <ConfirmMutation
                          title="Remove project"
                          description="This submits project.remove for the selected project. This can delete upstream resources."
                          op="project.remove"
                          body={{ projectId }}
                          onSuccess={upstream.reload}
                          trigger={<Button variant="destructive" size="sm">Remove</Button>}
                        />
                      </>
                    }
                  >
                    <div className="text-sm text-muted-foreground">
                      Environments: {rows(project.environments).length || rows(project.environment).length || "unknown"}
                    </div>
                    <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs">
                      {JSON.stringify(project, null, 2)}
                    </pre>
                  </EntityCard>
                )
              })}
            </div>
          ) : (
            <EmptyList message="No projects" description="project.all returned an empty result." />
          )}
        </>
      ) : null}
    </div>
  )
}

function getFirstEnvironment(project: Row): Row | null {
  const environmentRows = rows(project.environments)
  if (environmentRows[0]) return environmentRows[0]
  const single = project.environment
  return single && typeof single === "object" && !Array.isArray(single) ? (single as Row) : null
}
