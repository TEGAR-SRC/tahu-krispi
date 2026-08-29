// Upstream Dokploy databases console — one engine instance per database
// engine. The selector swaps the op prefix (postgres/mysql/mariadb/mongo/
// redis); every family exposes an identical op surface (.search, .create,
// .update, .remove, .start, .stop, .deploy, .reload), verified against the
// live relay and the bundled Dokploy v0.30.2 OpenAPI spec.
import { useState } from "react"
import type { DokployConsoleSpec } from "./engine"
import { DokployEngine } from "./engine"
import { loadEnvironmentOptions } from "./upstream"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const DB_KINDS = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const
type DbKind = (typeof DB_KINDS)[number]

const KIND_LABELS: Record<DbKind, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongo: "MongoDB",
  redis: "Redis",
}

function specFor(kind: DbKind): DokployConsoleSpec {
  const idKey = `${kind}Id`
  return {
    title: `Dokploy ${KIND_LABELS[kind]} databases`,
    description: `Databases of this engine on the live Dokploy server, managed through ${kind}.{search,create,update,remove,…}.`,
    entityLabel: `${kind} database`,
    rowIdKey: idKey,
    columns: [
      { key: "name", label: "Name" },
      { key: "appName", label: "App name", mono: true },
      { key: "databaseName", label: "Database" },
      { key: "databaseUser", label: "User" },
      {
        key: "applicationStatus",
        label: "Status",
        render: (row) => (
          <span className="font-mono text-xs">{String(row.applicationStatus ?? "—")}</span>
        ),
      },
      { key: "createdAt", label: "Created" },
      { key: idKey, label: "ID", mono: true },
    ],
    searchKeys: ["name", "appName", "databaseName", idKey],
    listOp: {
      key: "search",
      label: "Refresh",
      method: "GET",
      path: `${kind}.search`,
      role: "list",
    },
    createOp: {
      key: "create",
      label: "New database",
      method: "POST",
      path: `${kind}.create`,
      role: "create",
      successMessage: "Database created on upstream.",
      fields: [
        { key: "name", label: "Name", kind: "text", required: true },
        { key: "databaseName", label: "Database name", kind: "text", required: true },
        { key: "databaseUser", label: "Database user", kind: "text", required: true },
        { key: "databasePassword", label: "Database password", kind: "password", required: true },
        {
          key: "environmentId",
          label: "Environment",
          kind: "select",
          required: true,
          dynamicOptions: loadEnvironmentOptions,
          hint: "Loaded from your upstream projects' environments.",
        },
        { key: "dockerImage", label: "Docker image", kind: "text", hint: "Optional — defaults to the upstream default image." },
        { key: "description", label: "Description", kind: "multiline" },
        { key: "serverId", label: "Server ID", kind: "text" },
      ],
    },
    updateOp: {
      key: "update",
      label: "Edit database",
      method: "POST",
      path: `${kind}.update`,
      role: "update",
      successMessage: "Database updated on upstream.",
      fields: [
        { key: idKey, label: "ID", kind: "text", fromRow: true },
        { key: "name", label: "Name", kind: "text", required: true },
        { key: "databaseName", label: "Database name", kind: "text" },
        { key: "databaseUser", label: "Database user", kind: "text" },
        { key: "databasePassword", label: "Database password", kind: "password" },
        { key: "dockerImage", label: "Docker image", kind: "text" },
        { key: "description", label: "Description", kind: "multiline" },
      ],
    },
    rowActions: [
      {
        key: "start",
        label: "Start",
        method: "POST",
        path: `${kind}.start`,
        role: "action",
        confirm: true,
        successMessage: "Start requested on upstream.",
        fields: [{ key: idKey, label: "ID", kind: "text", fromRow: true }],
      },
      {
        key: "stop",
        label: "Stop",
        method: "POST",
        path: `${kind}.stop`,
        role: "action",
        confirm: true,
        successMessage: "Stop requested on upstream.",
        fields: [{ key: idKey, label: "ID", kind: "text", fromRow: true }],
      },
      {
        key: "deploy",
        label: "Deploy",
        method: "POST",
        path: `${kind}.deploy`,
        role: "action",
        confirm: true,
        successMessage: "Deploy requested on upstream.",
        fields: [{ key: idKey, label: "ID", kind: "text", fromRow: true }],
      },
      {
        key: "reload",
        label: "Reload config",
        method: "POST",
        path: `${kind}.reload`,
        role: "action",
        confirm: true,
        successMessage: "Reload requested on upstream.",
        fields: [
          { key: idKey, label: "ID", kind: "text", fromRow: true },
          { key: "appName", label: "App name", kind: "text", fromRow: true },
        ],
      },
      {
        key: "remove",
        label: "Delete",
        method: "POST",
        path: `${kind}.remove`,
        role: "action",
        confirm: true,
        destructive: true,
        successMessage: "Database deleted from upstream.",
        fields: [{ key: idKey, label: "ID", kind: "text", fromRow: true }],
      },
    ],
    emptyHint: `No ${KIND_LABELS[kind]} databases exist on the Dokploy server yet.`,
  }
}

export default function DokployDatabaseConsole() {
  const [kind, setKind] = useState<DbKind>("postgres")
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <div className="grid w-full max-w-full min-w-0 max-w-56 gap-1.5">
        <Label htmlFor="dokploy-db-kind">Database engine</Label>
        <Select value={kind} onValueChange={(value) => setKind(value as DbKind)}>
          <SelectTrigger id="dokploy-db-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DB_KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {KIND_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Remount the engine so state resets when the op prefix changes. */}
      <DokployEngine key={kind} spec={specFor(kind)} />
    </div>
  )
}
