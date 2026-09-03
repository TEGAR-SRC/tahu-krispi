// Thin HTTP client for the Kilat Cloud backend (Fiber). In Vite dev the
// client calls `/api/v1/...` and the proxy strips `/api` before forwarding to
// the backend's `/v1/...`; outside Vite dev the app talks to the backend
// directly via VITE_API_BASE_URL (set to https://api.kilat-cloud.com in prod).
import type { PagedMeta } from "./types"

export const API_BASE = import.meta.env.DEV
  ? "/api/v1"
  : `${import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "") : ""}/v1`

export class ApiError extends Error {
  code: string
  status: number
  details?: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = "ApiError"
    this.code = code
    this.status = status
    this.details = details
  }
}

// Deprecated stubs kept for compat — no longer store tokens in localStorage.
// Tokens are HttpOnly cookies; JS must not touch them.
export function getToken(): string | null {
  return null
}
export function setToken(_token: string | null): void { void _token }

/**
 * Paths that legitimately answer 401 on bad credentials / expired links and
 * must NOT trigger the global "session expired" redirect.
 */
const AUTH_ONLY_PATHS = ["/auth/", "/contact-change/confirm"]

function handleSessionExpired(): void {
  try {
    localStorage.removeItem("kilat_role")
    localStorage.removeItem("kilat_profile")
    localStorage.removeItem("kilat_org_id")
  } catch {
    // ignore
  }
  // Don't redirect while on handoff/callback — those pages handle 401 themselves
  if (
    window.location.pathname.startsWith("/oauth/callback") ||
    window.location.pathname.startsWith("/handoff")
  )
    return
  if (window.location.pathname !== "/login") {
    const target = `${window.location.pathname}${window.location.search}`
    window.location.assign(`/login?next=${encodeURIComponent(target)}`)
  }
}

export function authHeaders(): Record<string, string> {
  return {}
}

function csrfToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)kc_csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

type QueryValue = string | number | boolean | null | undefined

export interface ApiOptions {
  /** Extra headers, e.g. `{ "X-Organization-ID": id }`. */
  headers?: Record<string, string>
  /** Query params; `null`/`undefined` values are skipped. */
  query?: Record<string, QueryValue>
}

/** Successful backend envelope: `{ data, meta? }`. */
export interface ApiEnvelope<T> {
  data: T
  meta?: PagedMeta & Record<string, unknown>
}

interface ErrorBody {
  code?: string
  message?: string
  details?: unknown
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

function hasDataField(payload: unknown): payload is { data: unknown } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "data" in payload &&
    !Array.isArray(payload)
  )
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: ApiOptions,
): Promise<ApiEnvelope<T>> {
  const url = buildUrl(path, opts?.query)
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...authHeaders(),
    ...opts?.headers,
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json"
  }
  // CSRF double-submit
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrf = csrfToken()
    if (csrf) headers["X-CSRF-Token"] = csrf
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    throw new ApiError("network_error", "Network request failed", 0, cause)
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !AUTH_ONLY_PATHS.some((p) => path.startsWith(p))) {
      handleSessionExpired()
    }
    const err =
      typeof payload === "object" && payload !== null && "error" in payload
        ? (payload as { error: ErrorBody }).error
        : undefined
    throw new ApiError(
      err?.code ?? (response.status === 429 ? "rate_limited" : "unknown_error"),
      err?.message ??
        (response.status === 429
          ? "Terlalu banyak percobaan, coba lagi dalam 1 menit"
          : `Request failed with status ${response.status}`),
      response.status,
      err?.details,
    )
  }

  if (hasDataField(payload)) {
    const envelope = payload as { data: T; meta?: PagedMeta & Record<string, unknown> }
    return { data: envelope.data, meta: envelope.meta }
  }
  // Endpoints that reply without an envelope still resolve to `.data`.
  return { data: payload as T }
}

/** Extracts the payload from a successful envelope. */
export function unwrap<T>(envelope: ApiEnvelope<T>): T {
  return envelope.data
}

export function apiGet<T>(path: string, opts?: ApiOptions): Promise<ApiEnvelope<T>> {
  return request<T>("GET", path, undefined, opts)
}

export function apiPost<T>(path: string, body?: unknown, opts?: ApiOptions): Promise<ApiEnvelope<T>> {
  return request<T>("POST", path, body, opts)
}

export function apiPut<T>(path: string, body?: unknown, opts?: ApiOptions): Promise<ApiEnvelope<T>> {
  return request<T>("PUT", path, body, opts)
}

export function apiPatch<T>(path: string, body?: unknown, opts?: ApiOptions): Promise<ApiEnvelope<T>> {
  return request<T>("PATCH", path, body, opts)
}

export function apiDelete<T>(path: string, opts?: ApiOptions): Promise<ApiEnvelope<T>> {
  return request<T>("DELETE", path, undefined, opts)
}
