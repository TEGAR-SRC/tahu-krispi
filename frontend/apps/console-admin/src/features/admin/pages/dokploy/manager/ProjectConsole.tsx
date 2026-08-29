// Upstream Dokploy projects console — CRUD against the live server via
// project.{all,create,update,remove}. All three mutations were verified
// end-to-end against the live relay (create → rename → remove roundtrip).
import type { DokployConsoleSpec } from "./engine"
import { DokployEngine } from "./engine"
import { Badge } from "@/components/ui/badge"

const spec: DokployConsoleSpec = {
  title: "Dokploy projects",
  description:
    "Projects on the live Dokploy server, managed through the upstream API proxy.",
  entityLabel: "project",
  rowIdKey: "projectId",
  columns: [
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "createdAt", label: "Created" },
    {
      key: "environments",
      label: "Environments",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {Array.isArray(row.environments) && row.environments.length > 0 ? (
            (row.environments as Record<string, unknown>[]).map((env) =>
              typeof env.name === "string" ? (
                <Badge key={String(env.name)} variant="secondary" className="font-mono text-[11px]">
                  {env.name}
                </Badge>
              ) : null,
            )
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    { key: "projectId", label: "Project ID", mono: true },
  ],
  searchKeys: ["name", "description", "projectId"],
  listOp: { key: "all", label: "Refresh", method: "GET", path: "project.all", role: "list" },
  createOp: {
    key: "create",
    label: "New project",
    method: "POST",
    path: "project.create",
    role: "create",
    successMessage: "Project created on upstream.",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "description", label: "Description", kind: "multiline" },
      { key: "env", label: ".env content", kind: "multiline", hint: "Optional environment file contents." },
    ],
  },
  updateOp: {
    key: "update",
    label: "Edit project",
    method: "POST",
    path: "project.update",
    role: "update",
    successMessage: "Project updated on upstream.",
    fields: [
      { key: "projectId", label: "Project ID", kind: "text", fromRow: true },
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "description", label: "Description", kind: "multiline" },
      { key: "env", label: ".env content", kind: "multiline" },
    ],
  },
  rowActions: [
    {
      key: "remove",
      label: "Delete",
      method: "POST",
      path: "project.remove",
      role: "action",
      confirm: true,
      destructive: true,
      successMessage: "Project deleted from upstream.",
      fields: [{ key: "projectId", label: "Project ID", kind: "text", fromRow: true }],
    },
  ],
  emptyHint: "No projects exist on the Dokploy server yet.",
}

export default function DokployProjectConsole() {
  return <DokployEngine spec={spec} />
}
