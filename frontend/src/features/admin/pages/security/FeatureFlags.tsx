// Feature flag editor (GET/PUT /admin/feature-flags/:key). The API exposes
// only per-key GET/PUT — no listing. A flag shape is {key, enabled, rules,
// updated_at} where rules must be a JSON object; PUT upserts, so saving an
// unknown key creates it (the GET 404 is treated as "not created yet").
import { useCallback, useState } from "react"
import { toast } from "sonner"
import { apiGet, apiPut, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "../format"

interface FlagPayload {
  key: string
  enabled: boolean
  rules: unknown
  updated_at: string
}

export default function FeatureFlagsPage() {
  const [keyInput, setKeyInput] = useState("")
  const [flag, setFlag] = useState<FlagPayload | null>(null)
  const [notFoundKey, setNotFoundKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)

  const loadFlag = useCallback(async () => {
    const key = keyInput.trim()
    if (key === "") {
      toast.error("Enter a flag key first")
      return
    }
    setLoading(true)
    setLoadError(null)
    setNotFoundKey(null)
    try {
      const { data } = await apiGet<FlagPayload>(`/admin/feature-flags/${encodeURIComponent(key)}`)
      setFlag(data)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setFlag(null)
        setNotFoundKey(key)
      } else {
        setLoadError(cause)
        setFlag(null)
      }
    } finally {
      setLoading(false)
    }
  }, [keyInput])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Feature flags"
        description="Per-key runtime switches. The API has no listing — look a flag up by key; saving an unknown key creates it."
      />

      {/* Key lookup */}
      <section className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="flag-key">Flag key</Label>
          <Input
            id="flag-key"
            placeholder="e.g. registration_open"
            className="w-full font-mono sm:w-80"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadFlag()
            }}
          />
        </div>
        <Button disabled={loading} onClick={() => void loadFlag()}>
          {loading ? "Loading…" : "Load flag"}
        </Button>
      </section>

      {loadError ? (
        <p className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
          Could not load the flag ({loadError instanceof ApiError ? loadError.message : "error"}).
        </p>
      ) : null}

      {loading ? <Skeleton className="h-48 w-full" /> : null}

      {!loading && !flag && !notFoundKey && !loadError ? (
        <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          Load a flag by key to view and edit it.
        </p>
      ) : null}

      {!loading && notFoundKey ? (
        <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          No flag exists for key{" "}
          <span className="font-mono">{notFoundKey}</span> yet — fill in the editor below and save to
          create it.
        </p>
      ) : null}

      {flag ? <FlagEditor flag={flag} onSaved={setFlag} key={flag.key} /> : null}
    </div>
  )
}

/** Enabled switch + rules JSON textarea prefilled from the loaded flag. */
function FlagEditor({
  flag,
  onSaved,
}: {
  flag: FlagPayload
  onSaved: (next: FlagPayload) => void
}) {
  // Remounted per key by the parent, so state starts from the loaded flag.
  const [enabled, setEnabled] = useState(flag.enabled)
  const [rulesDraft, setRulesDraft] = useState(JSON.stringify(flag.rules ?? {}, null, 2))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    let parsedRules: unknown
    try {
      parsedRules = JSON.parse(rulesDraft)
    } catch {
      toast.error("Rules must be valid JSON")
      return
    }
    if (typeof parsedRules !== "object" || parsedRules === null || Array.isArray(parsedRules)) {
      toast.error("Rules must be a JSON object")
      return
    }
    setSaving(true)
    try {
      const { data } = await apiPut<FlagPayload>(
        `/admin/feature-flags/${encodeURIComponent(flag.key)}`,
        { enabled, rules: parsedRules },
      )
      toast.success("Flag saved")
      onSaved(data)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save flag")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold">{flag.key}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Last updated {formatDateTime(flag.updated_at)}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          {enabled ? "Enabled" : "Disabled"}
        </label>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="flag-rules">Rules (JSON object)</Label>
        <Textarea
          id="flag-rules"
          rows={8}
          className="font-mono text-xs"
          value={rulesDraft}
          onChange={(event) => setRulesDraft(event.target.value)}
        />
      </div>

      <Button size="sm" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save flag"}
      </Button>
    </section>
  )
}
