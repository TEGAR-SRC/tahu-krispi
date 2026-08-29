// Upstream Dokploy registry console — registry.{all,create,update,remove}.
// The upstream schema requires imagePrefix to be present (may be empty) and
// pins registryType to "cloud"; both encoded via sendEmpty/defaultValue.
import type { DokployConsoleSpec } from "./engine"
import { DokployEngine } from "./engine"

const spec: DokployConsoleSpec = {
  title: "Dokploy registries",
  description:
    "Container registries connected to the live Dokploy server. Credentials stay on the upstream server.",
  entityLabel: "registry",
  rowIdKey: "registryId",
  columns: [
    { key: "registryName", label: "Name" },
    { key: "registryUrl", label: "Registry URL", mono: true },
    { key: "username", label: "Username" },
    { key: "imagePrefix", label: "Image prefix", mono: true },
    { key: "registryType", label: "Type" },
    { key: "registryId", label: "Registry ID", mono: true },
  ],
  searchKeys: ["registryName", "registryUrl", "username", "imagePrefix"],
  listOp: { key: "all", label: "Refresh", method: "GET", path: "registry.all", role: "list" },
  createOp: {
    key: "create",
    label: "New registry",
    method: "POST",
    path: "registry.create",
    role: "create",
    successMessage: "Registry created on upstream.",
    fields: [
      { key: "registryName", label: "Name", kind: "text", required: true },
      {
        key: "registryUrl",
        label: "Registry URL",
        kind: "text",
        required: true,
        placeholder: "registry.example.com",
        hint: "Hostname or hostname:port only — no scheme.",
      },
      { key: "username", label: "Username", kind: "text", required: true },
      { key: "password", label: "Password / token", kind: "password", required: true },
      {
        key: "imagePrefix",
        label: "Image prefix",
        kind: "text",
        sendEmpty: true,
        hint: "Optional prefix for pushed images (e.g. registry.example.com/team).",
      },
      {
        key: "registryType",
        label: "Registry type",
        kind: "select",
        options: ["cloud"],
        defaultValue: "cloud",
      },
      { key: "serverId", label: "Server ID", kind: "text" },
    ],
  },
  updateOp: {
    key: "update",
    label: "Edit registry",
    method: "POST",
    path: "registry.update",
    role: "update",
    successMessage: "Registry updated on upstream.",
    fields: [
      { key: "registryId", label: "Registry ID", kind: "text", fromRow: true },
      { key: "registryName", label: "Name", kind: "text", required: true },
      { key: "registryUrl", label: "Registry URL", kind: "text", required: true },
      { key: "username", label: "Username", kind: "text" },
      { key: "password", label: "Password / token (leave blank to keep)", kind: "password" },
      { key: "imagePrefix", label: "Image prefix", kind: "text" },
    ],
  },
  rowActions: [
    {
      key: "remove",
      label: "Delete",
      method: "POST",
      path: "registry.remove",
      role: "action",
      confirm: true,
      destructive: true,
      successMessage: "Registry deleted from upstream.",
      fields: [{ key: "registryId", label: "Registry ID", kind: "text", fromRow: true }],
    },
  ],
  emptyHint: "No container registries are connected on the Dokploy server yet.",
}

export default function DokployRegistryConsole() {
  return <DokployEngine spec={spec} />
}
