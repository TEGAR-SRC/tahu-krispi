// Upstream Dokploy deployments console — read-only history per application
// (deployment.all requires applicationId; new deploys are triggered from the
// Applications console). Row actions killProcess/removeDeployment and the
// log viewer were verified by contract against the live relay and the bundled
// Dokploy v0.30.2 OpenAPI spec.
import type { DokployConsoleSpec } from "./engine"
import { DokployEngine, StatusBadge, loadApplicationOptions } from "./engine"

const spec: DokployConsoleSpec = {
  title: "Dokploy deployments",
  description:
    "Deployment history per application on the live Dokploy server. Pick an application to list its deployments; trigger new deploys from the Applications console.",
  entityLabel: "deployment",
  rowIdKey: "deploymentId",
  columns: [
    { key: "title", label: "Title" },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
    { key: "commitMessage", label: "Commit" },
    { key: "createdAt", label: "Created" },
    { key: "deploymentId", label: "Deployment ID", mono: true },
  ],
  searchKeys: ["title", "status", "commitMessage", "description", "deploymentId"],
  listOp: {
    key: "all",
    label: "Refresh",
    method: "GET",
    path: "deployment.all",
    role: "list",
    queryFields: [
      {
        key: "applicationId",
        label: "Application",
        kind: "select",
        required: true,
        dynamicOptions: loadApplicationOptions,
      },
    ],
  },
  rowActions: [
    {
      key: "logs",
      label: "View logs",
      method: "GET",
      path: "deployment.readLogs",
      role: "action",
      successMessage: "Logs loaded from upstream.",
      fields: [{ key: "deploymentId", label: "Deployment ID", kind: "text", fromRow: true }],
    },
    {
      key: "killProcess",
      label: "Kill process",
      method: "POST",
      path: "deployment.killProcess",
      role: "action",
      confirm: true,
      successMessage: "Kill signal sent upstream.",
      fields: [{ key: "deploymentId", label: "Deployment ID", kind: "text", fromRow: true }],
    },
    {
      key: "removeDeployment",
      label: "Delete record",
      method: "POST",
      path: "deployment.removeDeployment",
      role: "action",
      confirm: true,
      destructive: true,
      successMessage: "Deployment record deleted from upstream.",
      fields: [{ key: "deploymentId", label: "Deployment ID", kind: "text", fromRow: true }],
    },
  ],
  emptyHint: "This application has no deployments yet — deploy it from the Applications console.",
}

export default function DokployDeploymentConsole() {
  return <DokployEngine spec={spec} />
}
