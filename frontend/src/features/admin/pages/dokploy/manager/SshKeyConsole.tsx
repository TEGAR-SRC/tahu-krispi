// Upstream Dokploy SSH key console — sshKey.{all,create,update,remove} (the
// tag is camelCase "sshKey"). The upstream schema requires organizationId and
// format-valid PEM/OpenSSH keys; organizationId is prefilled from the first
// project row.
import type { DokployConsoleSpec } from "./engine"
import { DokployEngine } from "./engine"

const spec: DokployConsoleSpec = {
  title: "Dokploy SSH keys",
  description:
    "SSH private keys stored on the live Dokploy server for connecting build/deploy hosts. They are relayed verbatim over the encrypted proxy.",
  entityLabel: "SSH key",
  rowIdKey: "sshKeyId",
  columns: [
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "lastUsedAt", label: "Last used" },
    { key: "createdAt", label: "Created" },
    { key: "sshKeyId", label: "Key ID", mono: true },
  ],
  searchKeys: ["name", "description", "sshKeyId"],
  listOp: { key: "all", label: "Refresh", method: "GET", path: "sshKey.all", role: "list" },
  createOp: {
    key: "create",
    label: "New SSH key",
    method: "POST",
    path: "sshKey.create",
    role: "create",
    successMessage: "SSH key created on upstream.",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      {
        key: "privateKey",
        label: "Private key (PEM/OpenSSH)",
        kind: "multiline",
        required: true,
        placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----\n…",
      },
      {
        key: "publicKey",
        label: "Public key (authorized_keys line)",
        kind: "multiline",
        required: true,
        placeholder: "ssh-ed25519 AAAA… comment",
      },
      {
        key: "organizationId",
        label: "Organization ID",
        kind: "text",
        required: true,
        hint: "Prefilled from your upstream organization.",
      },
      { key: "description", label: "Description", kind: "text" },
    ],
  },
  updateOp: {
    key: "update",
    label: "Edit SSH key",
    method: "POST",
    path: "sshKey.update",
    role: "update",
    successMessage: "SSH key updated on upstream.",
    fields: [
      { key: "sshKeyId", label: "Key ID", kind: "text", fromRow: true },
      { key: "name", label: "Name", kind: "text" },
      { key: "description", label: "Description", kind: "text" },
    ],
  },
  rowActions: [
    {
      key: "remove",
      label: "Delete",
      method: "POST",
      path: "sshKey.remove",
      role: "action",
      confirm: true,
      destructive: true,
      successMessage: "SSH key deleted from upstream.",
      fields: [{ key: "sshKeyId", label: "Key ID", kind: "text", fromRow: true }],
    },
  ],
  emptyHint: "No SSH keys are stored on the Dokploy server yet.",
}

export default function DokploySshKeyConsole() {
  return <DokployEngine spec={spec} />
}
