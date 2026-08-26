// Upstream Dokploy applications console — application.search list plus
// create/update/delete and lifecycle actions (deploy, redeploy, reload,
// start, stop, refreshToken). Op names verified against the live relay
// (existence confirmed via upstream zod validation errors) and the bundled
// Dokploy v0.30.2 OpenAPI spec.
import type { DokployConsoleSpec } from "./engine"
import { DokployEngine, StatusBadge, loadEnvironmentOptions } from "./engine"

function lifecycle(key: string, label: string, path: string) {
  return {
    key,
    label,
    method: "POST" as const,
    path,
    role: "action" as const,
    confirm: true,
    successMessage: `${label}: request sent to upstream.`,
    fields: [{ key: "applicationId", label: "Application ID", kind: "text" as const, fromRow: true }],
  }
}

const spec: DokployConsoleSpec = {
  title: "Dokploy applications",
  description:
    "Applications across all projects on the live Dokploy server; lifecycle actions hit the real server immediately.",
  entityLabel: "application",
  rowIdKey: "applicationId",
  columns: [
    { key: "name", label: "Name" },
    { key: "appName", label: "App name", mono: true },
    {
      key: "applicationStatus",
      label: "Status",
      render: (row) => <StatusBadge value={row.applicationStatus} />,
    },
    { key: "sourceType", label: "Source" },
    { key: "createdAt", label: "Created" },
    { key: "applicationId", label: "Application ID", mono: true },
  ],
  searchKeys: ["name", "appName", "description", "sourceType", "applicationId"],
  listOp: {
    key: "search",
    label: "Refresh",
    method: "GET",
    path: "application.search",
    role: "list",
  },
  createOp: {
    key: "create",
    label: "New application",
    method: "POST",
    path: "application.create",
    role: "create",
    successMessage: "Application created on upstream.",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      {
        key: "sourceType",
        label: "Source type",
        kind: "select",
        options: ["github", "docker", "git", "gitlab", "bitbucket", "gitea", "drop"],
        defaultValue: "docker",
        hint: "Git/Docker source details are completed later in the upstream UI.",
      },
      {
        key: "environmentId",
        label: "Environment",
        kind: "select",
        required: true,
        dynamicOptions: loadEnvironmentOptions,
        hint: "Loaded from your upstream projects' environments.",
      },
      { key: "serverId", label: "Server ID", kind: "text", hint: "Optional — target server for the deployment." },
      { key: "description", label: "Description", kind: "multiline" },
    ],
  },
  updateOp: {
    key: "update",
    label: "Edit application",
    method: "POST",
    path: "application.update",
    role: "update",
    successMessage: "Application updated on upstream.",
    fields: [
      { key: "applicationId", label: "Application ID", kind: "text", fromRow: true },
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "appName", label: "App name (compose suffix)", kind: "text" },
      { key: "description", label: "Description", kind: "multiline" },
    ],
  },
  rowActions: [
    lifecycle("deploy", "Deploy now", "application.deploy"),
    lifecycle("redeploy", "Redeploy", "application.redeploy"),
    lifecycle("reload", "Reload", "application.reload"),
    lifecycle("start", "Start", "application.start"),
    lifecycle("stop", "Stop", "application.stop"),
    lifecycle("refreshToken", "Refresh token", "application.refreshToken"),
    {
      key: "delete",
      label: "Delete",
      method: "POST",
      path: "application.delete",
      role: "action",
      confirm: true,
      destructive: true,
      successMessage: "Application deleted from upstream.",
      fields: [{ key: "applicationId", label: "Application ID", kind: "text", fromRow: true }],
    },
  ],
  emptyHint: "No applications exist on the Dokploy server yet.",
}

export default function DokployApplicationConsole() {
  return <DokployEngine spec={spec} />
}
