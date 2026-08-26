// Multipart upload helper with progress reporting. The JSON helpers in
// src/lib/api.ts cannot stream FormData with progress events, so uploads
// (ISOs, avatars, ticket attachments) go through XMLHttpRequest here and keep
// using the same /api/v1 prefix + bearer token as the rest of the app.
import { getToken } from "@/lib/api"

export class UploadError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = "upload_error") {
    super(message)
    this.name = "UploadError"
    this.status = status
    this.code = code
  }
}

export interface UploadResult {
  status: number
  // Parsed JSON body when the server answered with JSON, raw text otherwise.
  body: unknown
}

/**
 * POSTs `form` to `/api/v1<path>` with the bearer token attached.
 * `onProgress` receives 0–100 once upload bytes start moving.
 */
export function uploadMultipart(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `/api/v1${path.startsWith("/") ? path : `/${path}`}`)
    xhr.responseType = "text"
    const token = getToken()
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onerror = () => reject(new UploadError("Network error during upload", 0))
    xhr.onload = () => {
      let payload: unknown = null
      const text = xhr.responseText
      if (text) {
        try {
          payload = JSON.parse(text)
        } catch {
          payload = text // non-JSON body; surfaced through the generic message
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ status: xhr.status, body: payload })
        return
      }
      const err =
        payload && typeof payload === "object" && "error" in payload
          ? (payload as { error: { code?: string; message?: string } }).error
          : undefined
      reject(
        new UploadError(
          err?.message ?? `Upload failed with status ${xhr.status}`,
          xhr.status,
          err?.code ?? "upload_error",
        ),
      )
    }
    xhr.send(form)
  })
}
