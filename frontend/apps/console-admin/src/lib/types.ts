// Shared types used across customer, NOC, finance and admin features.
// Role-specific agents may extend these locally; do not rename existing fields.

export interface PagedMeta {
  page: number
  per_page: number
  total?: number
}

export interface Paged<T> {
  data: T[]
  meta?: PagedMeta
}

export interface User {
  id: string
  email: string
  full_name: string
  created_at: string
}

export interface AuditLog {
  id: string
  actor_id: string
  actor_email?: string
  action: string
  resource_type: string
  resource_id?: string
  ip_address?: string
  details?: Record<string, unknown>
  created_at: string
}

export type TicketStatus = "open" | "pending" | "closed" | (string & {})

export interface Ticket {
  id: string
  subject: string
  status: TicketStatus
  priority?: string
  user_id?: string
  assignee_id?: string
  created_at: string
  updated_at?: string
}
