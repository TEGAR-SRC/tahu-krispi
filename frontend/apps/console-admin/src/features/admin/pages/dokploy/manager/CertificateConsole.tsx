// Upstream Dokploy certificates console — certificates.{all,create,update,
// remove} (note the plural tag, verified live). organizationId is required
// by the upstream schema; it is prefilled from the first project row.
import type { DokployConsoleSpec } from "./engine"
import { DokployEngine } from "./engine"
import { Badge } from "@/components/ui/badge"

const spec: DokployConsoleSpec = {
  title: "Dokploy certificates",
  description:
    "Custom TLS certificates stored on the live Dokploy server. Private keys are relayed verbatim over the encrypted proxy.",
  entityLabel: "certificate",
  rowIdKey: "certificateId",
  columns: [
    { key: "name", label: "Name" },
    { key: "certificatePath", label: "Path", mono: true },
    {
      key: "autoRenew",
      label: "Auto-renew",
      render: (row) =>
        row.autoRenew === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Badge variant="secondary" className="font-mono text-[11px]">
            {row.autoRenew === true ? "on" : "off"}
          </Badge>
        ),
    },
    { key: "organizationId", label: "Organization ID", mono: true },
    { key: "certificateId", label: "Certificate ID", mono: true },
  ],
  searchKeys: ["name", "certificatePath", "organizationId", "certificateId"],
  listOp: { key: "all", label: "Refresh", method: "GET", path: "certificates.all", role: "list" },
  createOp: {
    key: "create",
    label: "New certificate",
    method: "POST",
    path: "certificates.create",
    role: "create",
    successMessage: "Certificate created on upstream.",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      {
        key: "certificateData",
        label: "Certificate (PEM)",
        kind: "multiline",
        required: true,
        placeholder: "-----BEGIN CERTIFICATE-----\n…",
      },
      {
        key: "privateKey",
        label: "Private key (PEM)",
        kind: "multiline",
        required: true,
        placeholder: "-----BEGIN PRIVATE KEY-----\n…",
      },
      {
        key: "organizationId",
        label: "Organization ID",
        kind: "text",
        required: true,
        hint: "Prefilled from your upstream organization.",
      },
      { key: "serverId", label: "Server ID", kind: "text" },
      { key: "autoRenew", label: "Auto-renew", kind: "switch" },
    ],
  },
  updateOp: {
    key: "update",
    label: "Edit certificate",
    method: "POST",
    path: "certificates.update",
    role: "update",
    successMessage: "Certificate updated on upstream.",
    fields: [
      { key: "certificateId", label: "Certificate ID", kind: "text", fromRow: true },
      { key: "name", label: "Name", kind: "text" },
      { key: "certificateData", label: "Certificate (PEM)", kind: "multiline" },
      { key: "privateKey", label: "Private key (PEM)", kind: "multiline" },
    ],
  },
  rowActions: [
    {
      key: "remove",
      label: "Delete",
      method: "POST",
      path: "certificates.remove",
      role: "action",
      confirm: true,
      destructive: true,
      successMessage: "Certificate deleted from upstream.",
      fields: [{ key: "certificateId", label: "Certificate ID", kind: "text", fromRow: true }],
    },
  ],
  emptyHint: "No custom certificates exist on the Dokploy server yet.",
}

export default function DokployCertificateConsole() {
  return <DokployEngine spec={spec} />
}
