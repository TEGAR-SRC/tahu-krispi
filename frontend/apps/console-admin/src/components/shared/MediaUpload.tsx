// Reusable logo/image upload for landing content & docs. Uploads via the
// staff media endpoint and returns the public URL. Used in landing and docs
// editors to attach logos, hero images, etc. without hardcoding.
import { useRef, useState } from "react"
import { toast } from "sonner"
import { apiPost, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface MediaRow {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  url: string
  created_at?: string
}

interface MediaUploadProps {
  value: string
  onChange: (url: string) => void
  label?: string
}

export function MediaUpload({ value, onChange, label = "Media URL" }: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    const form = new FormData()
    form.append("file", file)
    setUploading(true)
    try {
      const { data } = await apiPost<MediaRow>("/admin/media", form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      onChange(data.url)
      toast.success(`Uploaded ${data.filename}`)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Upload failed")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-2">
      <Label>{label}</Label>
      {value ? (
        <div className="flex min-w-0 items-center gap-3 rounded-md border p-2">
          <img src={value} alt="preview" className="h-12 w-12 shrink-0 rounded object-contain" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{value}</span>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,application/pdf"
          className="hidden"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <Button variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? "Uploading…" : "Upload file"}
        </Button>
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://… or paste a /v1/media/… URL"
          className="min-w-0 flex-1 font-mono text-xs"
        />
      </div>
    </div>
  )
}
