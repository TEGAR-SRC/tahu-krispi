// Raw upstream client + shared option loaders for the Dokploy manager
// consoles. Kept in a plain .ts so the react-refresh rule only sees
// components in ./engine.tsx.
import { API_BASE, getToken } from "@/lib/api"
import type { DokployMethod, DynOption, Row } from "./engine"

interface UpstreamResult {
  status: number
  ok: boolean
  durationMs: number
  /** Parsed JSON body when the response was JSON, else null. */
  body: unknown
  /** Raw response text, always present. */
  text: string
}

export class UpstreamError extends Error {
  status: number
  body: unknown
  text: string

  constructor(status: number, text: string, body: unknown) {
    super(upstreamMessage(status, body, text))
    this.name = "UpstreamError"
    this.status = status
    this.text = text
    this.body = body
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Best-effort human message from a verbatim upstream payload. */
export function upstreamMessage(status: number, body: unknown, text: string): string {
  if (isRecord(body)) {
    const message = body["message"]
    if (typeof message === "string" && message !== "") return message
    const error = body["error"]
    if (typeof error === "string" && error !== "") return error
  }
  const trimmed = text.trim()
  if (trimmed !== "") {
    return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed
  }
  return `Upstream returned HTTP ${status}`
}

interface CallOptions {
  query?: Record<string, string>
  body?: unknown
}

/** Raw relay call — mirrors the DokployHub explorer's fetch approach. */
export async function dokployCall(
  method: DokployMethod,
  opPath: string,
  opts: CallOptions = {},
): Promise<UpstreamResult> {
  let url = `${API_BASE}/dokploy/${opPath.replace(/^\/+/, "")}`
  if (opts.query) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(opts.query)) {
      if (value !== "") params.set(key, value)
    }
    const qs = params.toString()
    if (qs !== "") url += `?${qs}`
  }
  const token = getToken()
  const startedAt = performance.now()
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  const result: UpstreamResult = {
    status: res.status,
    ok: res.ok,
    durationMs: Math.round(performance.now() - startedAt),
    body: parsed,
    text,
  }
  if (!res.ok) throw new UpstreamError(result.status, result.text, result.body)
  return result
}

function extractRows(body: unknown): Row[] {
  if (Array.isArray(body)) {
    return body.filter(isRecord)
  }
  if (isRecord(body) && Array.isArray(body["items"])) {
    return (body["items"] as unknown[]).filter(isRecord)
  }
  return []
}

let defaultsPromise: Promise<{ organizationId: string | null }> | null = null

/**
 * The upstream organizationId required by sshKey/certificate creation is not
 * exposed by any dedicated endpoint here; derive it once from the first
 * project row (every project embeds organizationId).
 */
export function loadDokployDefaults(): Promise<{ organizationId: string | null }> {
  if (!defaultsPromise) {
    defaultsPromise = dokployCall("GET", "project.all")
      .then((res) => {
        for (const row of extractRows(res.body)) {
          const org = row["organizationId"]
          if (typeof org === "string" && org !== "") return { organizationId: org }
        }
        return { organizationId: null }
      })
      .catch(() => ({ organizationId: null }))
  }
  return defaultsPromise
}

/** Environments across all projects, labeled "project / environment". */
export async function loadEnvironmentOptions(): Promise<DynOption[]> {
  const res = await dokployCall("GET", "project.all")
  const out: DynOption[] = []
  for (const project of extractRows(res.body)) {
    const envs = project["environments"]
    if (!Array.isArray(envs)) continue
    const projectName = typeof project["name"] === "string" ? project["name"] : "project"
    for (const env of envs) {
      if (!isRecord(env)) continue
      const id = env["environmentId"]
      if (typeof id !== "string" || id === "") continue
      const envName = typeof env["name"] === "string" ? env["name"] : id
      out.push({ value: id, label: `${projectName} / ${envName}` })
    }
  }
  return out
}

export async function loadApplicationOptions(): Promise<DynOption[]> {
  const res = await dokployCall("GET", "application.search")
  return extractRows(res.body)
    .map((row) => ({
      value: typeof row["applicationId"] === "string" ? row["applicationId"] : "",
      label:
        typeof row["name"] === "string" && row["name"] !== ""
          ? row["name"]
          : typeof row["appName"] === "string"
            ? row["appName"]
            : String(row["applicationId"] ?? ""),
    }))
    .filter((option) => option.value !== "")
}
