// Upstream Dokploy server console — server.{all,create,update,remove}.
// The upstream create/update schemas require description/username/sshKeyId
// to be present (empty string allowed), encoded via sendEmpty. Creating a
// server makes Dokploy probe the host over SSH — never fired casually.
import type { DokployConsoleSpec } from "./engine"
import { DokployEngine } from "./engine"
import { Badge } from "@/components/ui/badge"

const spec: DokployConsoleSpec = {
  title: "Dokploy servers",
  description:
    "Deployment/build hosts connected to the live Dokploy server. Creating one makes the upstream server probe it via SSH.",
  entityLabel: "server",
  rowIdKey: "serverId",
  columns: [
    { key: "name", label: "Name" },
    { key: "ipAddress", label: "IP address", mono: true },
    { key: "port", label: "Port" },
    { key: "username", label: "Username" },
    {
      key: "serverType",
      label: "Type",
      render: (row) => (
        <Badge variant="secondary" className="font-mono text-[11px]">
          {String(row.serverType ?? "—")}
        </Badge>
      ),
    },
    {
      key: "enableDockerCleanup",
      label: "Docker cleanup",
      render: (row) => (row.enableDockerCleanup === true ? "on" : "off"),
    },
    { key: "serverId", label: "Server ID", mono: true },
  ],
  searchKeys: ["name", "ipAddress", "username", "serverId"],
  listOp: { key: "all", label: "Refresh", method: "GET", path: "server.all", role: "list" },
  createOp: {
    key: "create",
    label: "New server",
    method: "POST",
    path: "server.create",
    role: "create",
    successMessage: "Server created on upstream.",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "ipAddress", label: "IP address / host", kind: "text", required: true },
      { key: "port", label: "SSH port", kind: "number", required: true, defaultValue: "22" },
      { key: "username", kind: "text", label: "SSH username", required: true, sendEmpty: true },
      {
        key: "sshKeyId",
        label: "SSH key ID",
        kind: "text",
        sendEmpty: true,
        hint: "ID of an SSH key registered in the SSH keys console (optional).",
      },
      {
        key: "serverType",
        label: "Server type",
        kind: "select",
        options: ["deploy", "build"],
        defaultValue: "deploy",
        required: true,
      },
      { key: "description", label: "Description", kind: "multiline", sendEmpty: true },
      { key: "enableDockerCleanup", label: "Enable Docker cleanup", kind: "switch" },
    ],
  },
  updateOp: {
    key: "update",
    label: "Edit server",
    method: "POST",
    path: "server.update",
    role: "update",
    successMessage: "Server updated on upstream.",
    fields: [
      { key: "serverId", label: "Server ID", kind: "text", fromRow: true },
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "ipAddress", label: "IP address / host", kind: "text", required: true },
      { key: "port", label: "SSH port", kind: "number", required: true },
      { key: "username", label: "SSH username", kind: "text", required: true, sendEmpty: true },
      { key: "sshKeyId", label: "SSH key ID", kind: "text", sendEmpty: true },
      {
        key: "serverType",
        label: "Server type",
        kind: "select",
        options: ["deploy", "build"],
        required: true,
      },
      { key: "description", label: "Description", kind: "multiline", sendEmpty: true },
      { key: "enableDockerCleanup", label: "Enable Docker cleanup", kind: "switch" },
    ],
  },
  rowActions: [
    {
      key: "remove",
      label: "Delete",
      method: "POST",
      path: "server.remove",
      role: "action",
      confirm: true,
      destructive: true,
      successMessage: "Server deleted from upstream.",
      fields: [{ key: "serverId", label: "Server ID", kind: "text", fromRow: true }],
    },
  ],
  emptyHint: "No extra servers are attached to the Dokploy server yet.",
}

export default function DokployServerConsole() {
  return <DokployEngine spec={spec} />
}
