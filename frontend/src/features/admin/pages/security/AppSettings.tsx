// App setting editor (GET/PUT /admin/app-settings/:key). The API exposes only
// per-key GET/PUT — no listing. A setting shape is {key, value, is_secret,
// updated_at}; when is_secret is true the GET returns a masked placeholder
// ("********") instead of the real value, so the editor must not prefill from
// it. PUT body is {value: <any JSON>, is_secret: bool}.
import { useCallback, useState } from "react"
import { toast } from "sonner"
import { apiGet, apiPut, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "../shared"

interface SettingPayload {
  key: string
  value: unknown
  is_secret: boolean
  updated_at: string
}

/** The backend masks secret values with this exact sentinel. */
const MASKED_VALUE = "********"

export default function AppSettingsPage() {
  const [keyInput, setKeyInput] = useState("")
  const [setting, setSetting] = useState<SettingPayload | null>(null)
  const [notFoundKey, setNotFoundKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)

  const loadSetting = useCallback(async () => {
    const key = keyInput.trim()
    if (key === "") {
      toast.error("Enter a setting key first")
      return
    }
    setLoading(true)
    setLoadError(null)
    setNotFoundKey(null)
    try {
      const { data } = await apiGet<SettingPayload>(`/admin/app-settings/${encodeURIComponent(key)}`)
      setSetting(data)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setSetting(null)
        setNotFoundKey(key)
      } else {
        setLoadError(cause)
        setSetting(null)
      }
    } finally {
      setLoading(false)
    }
  }, [keyInput])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="App settings"
        description="Per-key platform configuration values. The API has no listing — look a setting up by key; saving an unknown key creates it."
      />

      {/* Key lookup */}
      <section className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="setting-key">Setting key</Label>
          <Input
            id="setting-key"
            placeholder="e.g. support_email"
            className="w-full font-mono sm:w-80"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadSetting()
            }}
          />
        </div>
        <Button disabled={loading} onClick={() => void loadSetting()}>
          {loading ? "Loading…" : "Load setting"}
        </Button>
      </section>

      {loadError ? (
        <p className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
          Could not load the setting ({loadError instanceof ApiError ? loadError.message : "error"}).
        </p>
      ) : null}

      {loading ? <Skeleton className="h-48 w-full" /> : null}

      {!loading && !setting && !notFoundKey && !loadError ? (
        <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          Load a setting by key to view and edit it.
        </p>
      ) : null}

      {!loading && notFoundKey ? (
        <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          No setting exists for key{" "}
          <span className="font-mono">{notFoundKey}</span> yet — fill in the editor below and save to
          create it.
        </p>
      ) : null}

      {setting ? <SettingEditor setting={setting} onSaved={setSetting} key={setting.key} /> : null}
    </div>
  )
}

/**
 * Value JSON textarea + is_secret checkbox prefilled from the loaded setting.
 * Secret values arrive masked, so the draft starts empty in that case — saving
 * an untouched masked draft would otherwise persist the literal mask string.
 */
function SettingEditor({
  setting,
  onSaved,
}: {
  setting: SettingPayload
  onSaved: (next: SettingPayload) => void
}) {
  const isMasked = setting.is_secret && setting.value === MASKED_VALUE
  const initialText = isMasked ? "" : JSON.stringify(setting.value ?? null, null, 2)
  const [valueDraft, setValueDraft] = useState(initialText)
  const [isSecret, setIsSecret] = useState(setting.is_secret)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    let parsedValue: unknown
    try {
      parsedValue = JSON.parse(valueDraft)
    } catch {
      toast.error("Value must be valid JSON")
      return
    }
    setSaving(true)
    try {
      const { data } = await apiPut<SettingPayload>(
        `/admin/app-settings/${encodeURIComponent(setting.key)}`,
        { value: parsedValue, is_secret: isSecret },
      )
      toast.success("Setting saved")
      onSaved(data)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save setting")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold">{setting.key}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Last updated {formatDateTime(setting.updated_at)}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isSecret} onCheckedChange={(checked) => setIsSecret(checked === true)} />
          Secret value
        </label>
      </div>

      {isMasked ? (
        <p className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          Current value is hidden because this setting is marked secret — type a new value to
          replace it.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="setting-value">Value (JSON)</Label>
        <Textarea
          id="setting-value"
          rows={8}
          className={`font-mono text-xs ${isMasked ? "placeholder:text-muted-foreground" : ""}`}
          placeholder={isMasked ? MASKED_VALUE : undefined}
          value={valueDraft}
          onChange={(event) => setValueDraft(event.target.value)}
        />
      </div>

      <Button size="sm" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save setting"}
      </Button>
    </section>
  )
}
