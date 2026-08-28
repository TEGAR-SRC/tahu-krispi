// Shared contracts for the Dokploy admin hub and mirror browser. Verified
// against the live backend (2026-08-26):
//   POST /v1/admin/dokploy/sync {entity, op_path?, query?}
//     -> {entity, targeted, synced, failed, removed[, by_type, skipped_types]}
//   GET  /v1/admin/dokploy/db/:entity?limit=&offset=
//     -> {entity, items[], limit, offset, total}   (items' fields are strings;
//        only "data" comes back parsed)
//   DELETE /v1/admin/dokploy/db/:entity/:remote_id -> 204
import { apiPost } from "@/lib/api"

export interface DokployMirrorEntity {
  name: string
  description: string
  /** Sync runs without extra arguments: global list op or multi-source path. */
  syncable: boolean
}

/** Every entity accepted by the mirror read/delete endpoints. */
export const DOKPLOY_MIRROR_ENTITIES: DokployMirrorEntity[] = [
  { name: "projects", description: "Upstream projects.", syncable: true },
  { name: "environments", description: "Project environments.", syncable: true },
  { name: "applications", description: "Deployed applications.", syncable: true },
  { name: "composes", description: "Docker compose stacks.", syncable: true },
  { name: "databases", description: "Managed databases, all engine types.", syncable: true },
  { name: "domains", description: "Domains attached to apps and composes.", syncable: true },
  {
    name: "deployments",
    description: "Deployment history — targeted sync only.",
    syncable: false,
  },
  { name: "backups", description: "Database backup schedules.", syncable: true },
  { name: "servers", description: "Registered remote/build servers.", syncable: true },
  { name: "registries", description: "Docker registries.", syncable: true },
  { name: "sshkeys", description: "SSH keys.", syncable: true },
  { name: "certificates", description: "TLS certificates.", syncable: true },
]

export function findDokployEntity(
  name: string | undefined,
): DokployMirrorEntity | undefined {
  return DOKPLOY_MIRROR_ENTITIES.find((entity) => entity.name === name)
}

export interface DokploySyncResult {
  entity: string
  targeted?: boolean
  synced: number
  failed: number
  removed: number
  by_type?: Record<string, { synced: number; failed: number; removed: number }>
  skipped_types?: string[]
}

/**
 * Triggers a mirror sync. Without options this is the plain global pull; pass
 * opPath/query for targeted fills (e.g. deployments via deployment.all +
 * applicationId). Targeted syncs upsert only — they never reconcile deletions.
 */
export function syncDokployEntity(
  entity: string,
  options?: { opPath?: string; query?: Record<string, string> },
): Promise<DokploySyncResult> {
  return apiPost<DokploySyncResult>("/admin/dokploy/sync", {
    entity,
    ...(options?.opPath ? { op_path: options.opPath } : {}),
    ...(options?.query ? { query: options.query } : {}),
  }).then((envelope) => envelope.data).catch(() => { throw new Error("sync failed") })
}

/** One-line human summary for the sync toast. */
export function describeSyncResult(result: DokploySyncResult): string {
  const parts = [
    `${result.synced} synced`,
    `${result.failed} failed`,
    `${result.removed} removed`,
  ]
  if (result.skipped_types && result.skipped_types.length > 0) {
    parts.push(`skipped: ${result.skipped_types.join(", ")}`)
  }
  return parts.join(" · ")
}
