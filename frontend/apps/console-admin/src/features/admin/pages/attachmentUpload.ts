// Multipart staff-ticket-reply upload + attachment download helpers, shared by
// the admin and noc ticket threads. Modeled on src/features/customer/upload.ts
// (JSON helpers in src/lib/api.ts cannot stream FormData with progress events),
// but speaks the staff contract probed against the live API:
//   POST /v1/admin/tickets/:ticket_id/reply/attachments — fields `body`,
//     `internal_note`, repeated `files`; answers {data:{message_id,…}}.
//   GET /v1/admin/tickets/:ticket_id/messages/:message_id/attachments/
//     :attachment_id — answers JSON {data:{url}} presigned link or streams the
//     raw bytes depending on the storage backend.
import { API_BASE, getToken } from "@/lib/api"

/** Server-enforced reply limits, mirrored client-side before uploading. */
export const MAX_REPLY_FILES = 10
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024

export class AttachmentTransferError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = "attachment_error") {
    super(message)
    this.name = "AttachmentTransferError"
    this.status = status
    this.code = code
  }
}

export interface StaffReplyAttachment {
  id: string
  filename: string
  size_bytes: number
  content_type: string
}

export interface StaffReplyResult {
  message_id: string
  status: string
  internal_note: boolean
  attachments: StaffReplyAttachment[]
}

/** Rough per-part encoding overhead (boundary + headers) used to split the
 * aggregate XHR progress into approximate per-file percentages. */
const PART_OVERHEAD_BYTES = 256

/** Humanized byte size ("31 B", "1.5 MiB") for attachment listings. */
export function formatBytes(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/**
 * POSTs a staff reply with attachments to
 * `/api/v1/admin/tickets/{ticketId}/reply/attachments` with the bearer token
 * attached. `onProgress` receives one 0–100 percentage per entry of `files`
 * (same order); XHR only exposes aggregate bytes, so each file's slice is
 * derived from its share of the encoded request body, which streams in field
 * order.
 */
export function uploadStaffTicketReply(
  ticketId: string,
  options: { body: string; internalNote: boolean; files: File[] },
  onProgress?: (perFilePercent: number[]) => void,
): Promise<StaffReplyResult> {
  const { body, internalNote, files } = options
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append("body", body)
    form.append("internal_note", internalNote ? "true" : "false")
    for (const file of files) form.append("files", file)

    // Cumulative byte offsets of every file inside the encoded body.
    let consumed = body.length + PART_OVERHEAD_BYTES
    const spans = files.map((file) => {
      const size = file.size + PART_OVERHEAD_BYTES
      const span = { start: consumed, size }
      consumed += size
      return span
    })
    const reportProgress = (loaded: number) => {
      if (!onProgress) return
      onProgress(
        spans.map(({ start, size }) => {
          if (loaded >= start + size) return 100
          if (loaded <= start || size <= PART_OVERHEAD_BYTES) return 0
          return Math.min(100, Math.round(((loaded - start) / size) * 100))
        }),
      )
    }

    const xhr = new XMLHttpRequest()
    xhr.open(
      "POST",
      `${API_BASE}/admin/tickets/${encodeURIComponent(ticketId)}/reply/attachments`,
    )
    xhr.responseType = "text"
    const token = getToken()
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) reportProgress(event.loaded)
    }
    xhr.onerror = () =>
      reject(new AttachmentTransferError("Network error during upload", 0))
    xhr.onload = () => {
      let payload: unknown = null
      if (xhr.responseText) {
        try {
          payload = JSON.parse(xhr.responseText)
        } catch {
          payload = null
        }
      }
      const envelope =
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = envelope.data as StaffReplyResult | undefined
        if (data && typeof data.message_id === "string") {
          resolve(data)
          return
        }
        reject(new AttachmentTransferError("Unexpected reply-attachment response", xhr.status))
        return
      }
      const err = envelope.error as { code?: string; message?: string } | undefined
      reject(
        new AttachmentTransferError(
          err?.message ?? `Attachment upload failed with status ${xhr.status}`,
          xhr.status,
          err?.code ?? "attachment_error",
        ),
      )
    }
    xhr.send(form)
  })
}

interface DownloadTarget {
  messageId: string
  attachmentId: string
  filename: string
}

/**
 * Fetches one staff-visible attachment and hands it to the browser: presigned
 * JSON answers open in a new tab, binary streams are saved as a Blob. Throws
 * AttachmentTransferError so callers can toast the failure.
 */
export async function downloadStaffTicketAttachment(
  ticketId: string,
  target: DownloadTarget,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/admin/tickets/${encodeURIComponent(ticketId)}/messages/${encodeURIComponent(target.messageId)}/attachments/${encodeURIComponent(target.attachmentId)}`,
    { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
  )
  if (!response.ok) {
    throw new AttachmentTransferError(`Attachment download failed (${response.status})`, response.status)
  }
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as {
      data?: { url?: string }
      url?: string
    }
    const url = payload.data?.url ?? payload.url
    if (!url) throw new AttachmentTransferError("No download link returned", response.status)
    window.open(url, "_blank", "noopener,noreferrer")
    return
  }
  // Storage backend proxied the raw file through this backend.
  const blob = await response.blob()
  const disposition = response.headers.get("content-disposition") ?? ""
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = match?.[1] ?? target.filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}
