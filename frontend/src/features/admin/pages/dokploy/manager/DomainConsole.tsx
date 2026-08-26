// Upstream Dokploy domains console — domains are scoped to an application
// (domain.byApplicationId), so the toolbar selects one first. Create/update/
// toggleEnable/delete verified by contract via the live relay's zod errors
// and the bundled Dokploy v0.30.2 OpenAPI spec.
import type { DokployConsoleSpec } from "./engine"
import { DokployEngine, StatusBadge, loadApplicationOptions } from "./engine"
import { Badge } from "@/components/ui/badge"

const spec: DokployConsoleSpec = {
  title: "Dokploy domains",
  description:
    "Domains attached to an application on the live Dokploy server. Pick an application to list its domains.",
  entityLabel: "domain",
  rowIdKey: "domainId",
  columns: [
    { key: "host", label: "Host" },
    { key: "path", label: "Path", mono: true },
    { key: "port", label: "Port" },
    {
      key: "https",
      label: "HTTPS",
      render: (row) => (
        <Badge variant="secondary" className="font-mono text-[11px]">
          {row.https === true ? "on" : "off"}
        </Badge>
      ),
    },
    {
      key: "certificateType",
      label: "Certificate",
      render: (row) => <StatusBadge value={row.certificateType} />,
    },
    {
      key: "enabled",
      label: "Enabled",
      render: (row) =>
        row.enabled === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <StatusBadge value={row.enabled ? "done" : "idle"} />
        ),
    },
    { key: "domainId", label: "Domain ID", mono: true },
  ],
  searchKeys: ["host", "path", "domainId"],
  listOp: {
    key: "byApplicationId",
    label: "Refresh",
    method: "GET",
    path: "domain.byApplicationId",
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
  createOp: {
    key: "create",
    label: "New domain",
    method: "POST",
    path: "domain.create",
    role: "create",
    successMessage: "Domain created on upstream.",
    fields: [
      // applicationId is seeded from the toolbar selection above.
      { key: "applicationId", label: "Application ID", kind: "text", required: true, hint: "Seeded from the selected application." },
      { key: "host", label: "Host", kind: "text", required: true, placeholder: "app.example.com" },
      { key: "port", label: "Port", kind: "number", placeholder: "3000" },
      { key: "path", label: "Path", kind: "text", placeholder: "/" },
      { key: "https", label: "HTTPS", kind: "switch" },
      {
        key: "certificateType",
        label: "Certificate type",
        kind: "select",
        options: ["letsencrypt", "none", "custom"],
        defaultValue: "letsencrypt",
      },
      { key: "internalPath", label: "Internal path", kind: "text" },
    ],
  },
  updateOp: {
    key: "update",
    label: "Edit domain",
    method: "POST",
    path: "domain.update",
    role: "update",
    successMessage: "Domain updated on upstream.",
    fields: [
      { key: "domainId", label: "Domain ID", kind: "text", fromRow: true },
      { key: "host", label: "Host", kind: "text", required: true },
      { key: "port", label: "Port", kind: "number" },
      { key: "path", label: "Path", kind: "text" },
      { key: "https", label: "HTTPS", kind: "switch" },
      {
        key: "certificateType",
        label: "Certificate type",
        kind: "select",
        options: ["letsencrypt", "none", "custom"],
      },
      { key: "internalPath", label: "Internal path", kind: "text" },
      { key: "enabled", label: "Enabled", kind: "switch" },
    ],
  },
  rowActions: [
    {
      key: "toggleEnable",
      label: "Toggle enable",
      method: "POST",
      path: "domain.toggleEnable",
      role: "action",
      confirm: true,
      successMessage: "Toggle requested on upstream.",
      fields: [{ key: "domainId", label: "Domain ID", kind: "text", fromRow: true }],
    },
    {
      key: "delete",
      label: "Delete",
      method: "POST",
      path: "domain.delete",
      role: "action",
      confirm: true,
      destructive: true,
      successMessage: "Domain deleted from upstream.",
      fields: [{ key: "domainId", label: "Domain ID", kind: "text", fromRow: true }],
    },
  ],
  emptyHint: "This application has no domains yet — create the first one.",
}

export default function DokployDomainConsole() {
  return <DokployEngine spec={spec} />
}
