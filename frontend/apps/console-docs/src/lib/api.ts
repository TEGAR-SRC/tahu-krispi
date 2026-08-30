// Thin HTTP client for the Kilat Cloud backend (Fiber). In Vite dev the
// client calls `/api/v1/...` and the proxy strips `/api` before forwarding to
// the backend's `/v1/...`; outside Vite dev the app talks to the backend
// directly via VITE_API_BASE_URL (set to https://api.kilat-cloud.com in prod).
import type { PagedMeta } from "./types"

export const API_BASE = import.meta.env.DEV
  ? "/api/v1"
  : `${import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "") : ""}/v1`

// API_ORIGIN is the backend origin without the /v1 suffix, used to turn
// relative media paths (e.g. "/v1/media/<id>") into absolute URLs for <img>.
export const API_ORIGIN = (() => {
  if (import.meta.env.DEV) {
    const target = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080"
    return target.replace(/\/+$/, "")
  }
  const base = import.meta.env.VITE_API_BASE_URL
  return base ? base.replace(/\/+$/, "") : ""
})()

/** Resolves a media value (relative /v1/media/… or any absolute URL) to an absolute URL. */
export function resolveMediaUrl(value: string): string {
  if (!value) return ""
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value
  }
  const clean = value.startsWith("/") ? value : `/${value}`
  return `${API_ORIGIN}${clean}`
}

const TOKEN_KEY = "kilat_token"

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

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  } catch {
    // Storage unavailable (private mode etc.); token stays in memory only.
  }
}

/**
 * Paths that legitimately answer 401 on bad credentials / expired links and
 * must NOT trigger the global "session expired" redirect.
 */
const AUTH_ONLY_PATHS = ["/auth/", "/contact-change/confirm"]

/**
 * Clears the persisted session and bounces the user to the login page. Called
 * on any 401 from a request that carried a token (i.e. the session expired).
 */
function handleSessionExpired(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem("kilat_role")
    localStorage.removeItem("kilat_profile")
    localStorage.removeItem("kilat_org_id")
  } catch {
    // ignore storage errors
  }
  if (window.location.pathname !== "/login") {
    const target = `${window.location.pathname}${window.location.search}`
    window.location.assign(`/login?next=${encodeURIComponent(target)}`)
  }
}

/** Headers carrying the bearer token when one is stored. */
export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
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
  const hadToken = Boolean(getToken())
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...authHeaders(),
    ...opts?.headers,
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json"
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
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
    // A 401 on a token-bearing request means the session expired — clear it
    // and bounce to /login (unless it's an auth-only path, e.g. bad login).
    if (response.status === 401 && hadToken && !AUTH_ONLY_PATHS.some((p) => path.startsWith(p))) {
      handleSessionExpired()
    }
    const err =
      typeof payload === "object" && payload !== null && "error" in payload
        ? (payload as { error: ErrorBody }).error
        : undefined
    throw new ApiError(
      err?.code ?? "unknown_error",
      err?.message ?? `Request failed with status ${response.status}`,
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
