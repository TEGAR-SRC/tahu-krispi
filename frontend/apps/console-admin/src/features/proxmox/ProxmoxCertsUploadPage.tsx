import { useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiPost, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { EmptyState } from "@/components/shared/EmptyState"
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

interface CertRow {
  filename?: string
  subject?: string
  issuer?: string
  "not-after"?: string
  "not-before"?: string
  fingerprint?: string
  san?: string[]
  "public-key-type"?: string
  "public-key-bits"?: number
  pem?: string
  [key: string]: unknown
}

function formatDateTime(raw?: string | null): string {
  if (!raw) return "—"
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleString()
}

export default function ProxmoxCertsUploadPage() {
  const { providerId = "", node = "" } = useParams<{ providerId: string; node: string }>()
  const base = providerId && node ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/certs` : null
  const certs = useInfraGet<CertRow[]>(base, undefined, { intervalMs: 5000 })

  const [certificates, setCertificates] = useState("")
  const [key, setKey] = useState("")
  const [force, setForce] = useState(false)
  const [restart, setRestart] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!providerId || !node) {
    return (
      <ProviderShell providerId={providerId || ""} title="Certs" description="Per-node custom TLS certificates.">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Missing route params</CardTitle>
            <CardDescription>providerId and node are required.</CardDescription>
          </CardHeader>
        </Card>
      </ProviderShell>
    )
  }

  const upload = async () => {
    if (!base) return
    if (!certificates.trim()) {
      toast.error("PEM certificate chain is required.")
      return
    }
    if (!key.trim()) {
      toast.error("PEM private key is required.")
      return
    }
    setUploading(true)
    try {
      await apiPost(base, { certificates: certificates.trim(), key: key.trim(), force, restart })
      toast.success("Certificate uploaded")
      certs.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const doDelete = async () => {
    if (!base) return
    setDeleting(true)
    try {
      await apiDelete(base)
      toast.success("Custom certificate deleted")
      setConfirmDelete(false)
      certs.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Delete failed")
    } finally {
      setDeleting(false)
    }
  }

  const rows: CertRow[] = Array.isArray(certs.data) ? (certs.data as CertRow[]) : []

  return (
    <ProviderShell
      providerId={providerId}
      title={`Node ${node} — Certificates`}
      description={`Custom TLS certificates on ${node}. GET polled every 5s via useInfraGet; POST upload and DELETE require platform_admin. POST /admin/proxmox/:id/nodes/:node/certs {certificates,key,force,restart}`}
      actions={
        <Button variant="outline" size="sm" onClick={() => certs.reload()} disabled={certs.loading}>
          Refresh
        </Button>
      }
    >
      {certs.error ? <ErrorBanner error={certs.error} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current certificates</CardTitle>
          <CardDescription>
            Read-only table — infra-readable (NOC) via GET /admin/proxmox/:id/nodes/:node/certs, polled every 5s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {certs.loading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading certificates…</p>
          ) : rows.length === 0 ? (
            <EmptyState message="No custom certificates reported." />
          ) : (
            <SimpleDataTable<CertRow>
              columns={[
                { key: "filename", header: "File", render: (c) => String(c.filename ?? "—") },
                { key: "subject", header: "Subject", render: (c) => String(c.subject ?? "—") },
                { key: "issuer", header: "Issuer", render: (c) => String(c.issuer ?? "—") },
                { key: "not-after", header: "Valid until", render: (c) => formatDateTime(c["not-after"] as string) },
                { key: "san", header: "SANs", className: "hidden max-w-72 truncate lg:table-cell", render: (c) => (c.san ?? []).join(", ") || "—" },
              ]}
              rows={rows}
              getRowKey={(c, index) => String(c.filename ?? index)}
              skeletonRows={2}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload custom certificate</CardTitle>
            <CardDescription>
              POST /admin/proxmox/:id/nodes/:node/certs — PEM chain + private key. Wraps client.NodeCertificateUpload
              (SDK POST /nodes/{"{node}"}/certificates/custom).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cert-chain">Certificate chain (PEM) *</Label>
              <Textarea
                id="cert-chain"
                value={certificates}
                onChange={(e) => setCertificates(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                rows={8}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cert-key">Private key (PEM) *</Label>
              <Textarea
                id="cert-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                rows={6}
                className="font-mono text-xs"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={force} onCheckedChange={(v) => setForce(Boolean(v))} />
              Force overwrite existing certificate
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={restart} onCheckedChange={(v) => setRestart(Boolean(v))} />
              Restart pveproxy after upload
            </label>
            <Button disabled={uploading || !certificates.trim() || !key.trim()} onClick={() => void upload()}>
              {uploading ? "Uploading…" : "Upload certificate"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Endpoint: <span className="font-mono">POST /admin/proxmox/:id/nodes/:node/certs</span> · requireStaff
              platform_admin
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Danger zone</CardTitle>
            <CardDescription>Remove the custom certificate from this node.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              DELETE /admin/proxmox/:id/nodes/:node/certs — wraps client.NodeCertificateDelete (SDK DELETE
              /nodes/{"{node}"}/certificates/custom). The node reverts to its self-signed certificate.
            </p>
            <Button variant="destructive" disabled={deleting} onClick={() => setConfirmDelete(true)}>
              Delete custom certificate…
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete custom certificate on ${node}?`}
        body="The custom TLS certificate is removed. PVE reverts to its self-signed certificate until a new one is uploaded."
        confirmLabel="Delete certificate"
        busy={deleting}
        onConfirm={() => void doDelete()}
      />

      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/certs</span> · requireStaff infra ·
        polling every 5s via <span className="font-mono">useInfraGet(..., {"{ intervalMs: 5000 }"} )</span>
      </p>
    </ProviderShell>
  )
}
