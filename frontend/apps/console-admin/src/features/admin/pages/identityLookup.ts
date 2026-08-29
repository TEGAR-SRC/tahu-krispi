// Lookup helpers for the admin identity detail pages. The API exposes no
// single-resource GET for users/organizations/tickets, so detail routes
// resolve their entity by walking the corresponding paginated admin list.
import { apiGet } from "@/lib/api"

export interface AdminUserRow {
  id: string
  public_id: string
  email: string
  username: string
  full_name: string
  status: string
  email_status: string
  is_platform_admin: boolean
  last_login_at: string
  created_at: string
}

export interface AdminOrgRow {
  id: string
  public_id: string
  slug: string
  name: string
  status: string
  billing_email: string
  member_count: number
  created_at: string
}

export interface AdminTicketRow {
  id: string
  ticket_number: string
  organization_id: string
  org_slug: string
  subject: string
  category: string
  status: string
  priority: string
  assigned_to: string
  created_at: string
  last_reply_at: string
  closed_at: string
}

interface ScanOptions {
  /** Page size used while walking; 100 keeps typical lookups to one request. */
  perPage?: number
  /** Safety cap so a missing row cannot loop forever. */
  maxPages?: number
}

/**
 * Walks a paginated list endpoint until `match` returns true.
 * Returns null when the row is not found within `maxPages` pages.
 */
export async function scanAdminList<T>(
  path: string,
  match: (row: T) => boolean,
  opts: ScanOptions = {},
): Promise<T | null> {
  const perPage = opts.perPage ?? 100
  const maxPages = opts.maxPages ?? 10
  for (let page = 1; page <= maxPages; page++) {
    const envelope = await apiGet<T[]>(path, { query: { page, per_page: perPage } })
    const rows = Array.isArray(envelope.data) ? envelope.data : []
    const found = rows.find(match)
    if (found) return found
    const total = envelope.meta?.total
    if (rows.length < perPage || (typeof total === "number" && page * perPage >= total)) {
      return null
    }
  }
  return null
}

/**
 * Resolves a :userId route param to a user row. The list endpoint's `search`
 * matches email/username/public_id/full name but NOT the internal uuid, so try
 * the cheap search first and fall back to walking the full list.
 */
export async function findAdminUser(userIdParam: string): Promise<AdminUserRow | null> {
  const isTarget = (u: AdminUserRow) => u.id === userIdParam || u.public_id === userIdParam
  const searched = await apiGet<AdminUserRow[]>("/admin/users", {
    query: { page: 1, per_page: 20, search: userIdParam },
  })
  const rows = Array.isArray(searched.data) ? searched.data : []
  const hit = rows.find(isTarget)
  if (hit) return hit
  return scanAdminList<AdminUserRow>("/admin/users", isTarget)
}

/** Resolves an :orgId route param (internal id or public_id) via the list. */
export async function findAdminOrg(orgIdParam: string): Promise<AdminOrgRow | null> {
  return scanAdminList<AdminOrgRow>(
    "/admin/organizations",
    (o) => o.id === orgIdParam || o.public_id === orgIdParam,
  )
}

/** Resolves a :ticketId route param via the staff ticket queue list. */
export async function findAdminTicket(ticketIdParam: string): Promise<AdminTicketRow | null> {
  return scanAdminList<AdminTicketRow>(
    "/admin/tickets",
    (t) => t.id === ticketIdParam,
  )
}
