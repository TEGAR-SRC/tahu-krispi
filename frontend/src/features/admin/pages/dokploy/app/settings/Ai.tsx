// K6 · Settings ▸ AI — parity with pages/dashboard/settings/ai.tsx
// (+ ai-form.tsx / handle-ai.tsx / handle-ai-providers.tsx):
// ai.getAll list, create/update/delete, testConnection, getModels picker,
// and the custom provider presets editor (getCustomProviders/saveCustomProviders).
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  BotIcon,
  PenBoxIcon,
  PlusIcon,
  PlugIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { UpstreamError } from "../shared"
import { dokploy, toErrorMessage, useUpstream } from "../shared"
import {
  ConfirmAction,
  FieldRow,
  K6Breadcrumbs,
  fieldErrorsFrom,
} from "./k6-helpers"

interface AiConfig {
  aiId: string
  name: string
  apiUrl?: string
  apiKey?: string | null
  model?: string
  isEnabled?: boolean
}

interface CustomProvider {
  name: string
  apiUrl: string
}

/** Built-in presets (mirrors AI_PROVIDERS in handle-ai.tsx). */
const AI_PROVIDERS: CustomProvider[] = [
  { name: "OpenAI", apiUrl: "https://api.openai.com/v1" },
  { name: "Anthropic", apiUrl: "https://api.anthropic.com/v1" },
  { name: "Google Gemini", apiUrl: "https://generativelanguage.googleapis.com/v1beta" },
  { name: "Mistral", apiUrl: "https://api.mistral.ai/v1" },
  { name: "Cohere", apiUrl: "https://api.cohere.ai/v2" },
  { name: "Perplexity", apiUrl: "https://api.perplexity.ai" },
  { name: "DeepInfra", apiUrl: "https://api.deepinfra.com/v1/openai" },
  { name: "Ollama", apiUrl: "http://localhost:11434" },
  { name: "OpenRouter", apiUrl: "https://openrouter.ai/api/v1" },
  { name: "Z.AI", apiUrl: "https://api.z.ai/api/paas/v4" },
  { name: "MiniMax", apiUrl: "https://api.minimax.io/v1" },
]

function HandleAiDialog({
  aiId,
  onSaved,
  trigger,
}: {
  aiId?: string
  onSaved: () => void
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  // Edit prefill via ai.one (only fetched for existing configs while open).
  const { data: current } = useUpstream<AiConfig | null>(
    () => (aiId && open ? dokploy<AiConfig>("GET", "ai.one", undefined, { aiId }) : Promise.resolve(null)),
    [aiId, open],
  )
  // Organization-defined presets take precedence over the built-in list.
  const { data: customList } = useUpstream<CustomProvider[]>(
    () => (open ? dokploy<CustomProvider[]>("GET", "ai.getCustomProviders") : Promise.resolve([])),
    [open],
  )
  const customProviders = Array.isArray(customList) ? customList : []

  const [values, setValues] = useState({
    name: "",
    apiUrl: "",
    apiKey: "",
    model: "",
    isEnabled: true,
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<UpstreamError | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [models, setModels] = useState<Array<{ id: string }>>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [customModelMode, setCustomModelMode] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      if (open && current && aiId) {
        setValues({
          name: current.name ?? "",
          apiUrl: current.apiUrl ?? "",
          apiKey: current.apiKey ?? "",
          model: current.model ?? "",
          isEnabled: current.isEnabled ?? true,
        })
        if (current.model) setCustomModelMode(true)
      }
      if (!open) {
        setValues({ name: "", apiUrl: "", apiKey: "", model: "", isEnabled: true })
        setModels([])
        setModelsError(null)
        setCustomModelMode(false)
        setSubmitError(null)
        setFieldErrors({})
      }
    }, 0)
    return () => clearTimeout(t)
  }, [open, current, aiId])

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const loadModels = async () => {
    if (!values.apiUrl || (!values.apiKey && !values.apiUrl.includes(":11434"))) {
      toast.error("API URL and API key are required to list models")
      return
    }
    setModelsLoading(true)
    setModelsError(null)
    try {
      const result = await dokploy<Array<{ id: string }>>("GET", "ai.getModels", undefined, {
        apiUrl: values.apiUrl,
        apiKey: values.apiKey,
      })
      setModels(Array.isArray(result) ? result : [])
      if (!Array.isArray(result) || result.length === 0) {
        setCustomModelMode(true)
        toast.info("No models returned — enter the model name manually")
      }
    } catch (cause: unknown) {
      setModelsError(toErrorMessage(cause))
      setCustomModelMode(true)
    } finally {
      setModelsLoading(false)
    }
  }

  const testConnection = async () => {
    if (!values.apiUrl || !values.model) {
      toast.error("API URL and model are required to test the connection")
      return
    }
    setTesting(true)
    try {
      await dokploy("POST", "ai.testConnection", {
        apiUrl: values.apiUrl,
        apiKey: values.apiKey,
        model: values.model,
      })
      toast.success("Connection successful")
    } catch (cause: unknown) {
      toast.error(`Connection failed: ${toErrorMessage(cause)}`)
    } finally {
      setTesting(false)
    }
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const errors: Record<string, string> = {}
    if (!values.name.trim()) errors.name = "Name is required"
    if (!values.apiUrl.trim()) errors.apiUrl = "API URL is required"
    else {
      try {
        new URL(values.apiUrl)
      } catch {
        errors.apiUrl = "Please enter a valid URL"
      }
    }
    if (!values.model.trim()) errors.model = "Model is required"
    setFieldErrors(errors)
    setSubmitError(null)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    try {
      await dokploy("POST", aiId ? "ai.update" : "ai.create", {
        ...values,
        ...(aiId ? { aiId } : {}),
      })
      toast.success("AI settings saved successfully")
      setOpen(false)
      onSaved()
    } catch (cause: unknown) {
      const err = cause as UpstreamError
      setSubmitError(err)
      toast.error(toErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const zodErrors = submitError ? fieldErrorsFrom(submitError) : null
  const errorFor = (name: string) => fieldErrors[name] ?? zodErrors?.[name]?.[0]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{aiId ? "Edit AI" : "Add AI"}</DialogTitle>
          <DialogDescription>Configure your AI provider settings.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <FieldRow label="Provider Preset">
            <Select
              value={values.apiUrl}
              onValueChange={(value) => {
                const preset = [...(customProviders.length > 0 ? customProviders : AI_PROVIDERS)].find(
                  (p) => p.apiUrl === value,
                )
                if (preset) {
                  setValues((v) => ({ ...v, name: preset.name, apiUrl: preset.apiUrl, model: "" }))
                  setCustomModelMode(false)
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a provider preset…" />
              </SelectTrigger>
              <SelectContent>
                {(customProviders.length > 0 ? customProviders : AI_PROVIDERS).map((provider) => (
                  <SelectItem key={`${provider.name}-${provider.apiUrl}`} value={provider.apiUrl}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Quick-fill provider name and URL; configure manually below.
            </p>
          </FieldRow>
          <FieldRow label="Name" error={errorFor("name")}>
            <Input
              placeholder="My OpenAI Config"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="API URL" error={errorFor("apiUrl")}>
            <Input
              placeholder="https://api.openai.com/v1"
              value={values.apiUrl}
              onChange={(e) => {
                set("apiUrl", e.target.value)
                if (values.model) set("model", "")
              }}
            />
          </FieldRow>
          <FieldRow
            label="API Key"
            hint={values.apiUrl.includes(":11434") ? "Local Ollama needs no API key." : undefined}
            error={errorFor("apiKey")}
          >
            {!values.apiUrl.includes(":11434") ? (
              <Input
                type="password"
                placeholder="sk-…"
                value={values.apiKey}
                onChange={(e) => {
                  set("apiKey", e.target.value)
                  if (values.model) set("model", "")
                }}
              />
            ) : (
              <p className="text-muted-foreground text-sm">Not required for this API URL.</p>
            )}
          </FieldRow>
          <FieldRow label="Model" hint={modelsError} error={errorFor("model")}>
            <div className="flex flex-wrap items-center gap-2">
              {customModelMode || models.length === 0 ? (
                <Input
                  className="flex-1"
                  placeholder={
                    modelsLoading ? "Loading models…" : "Enter model name (e.g. gpt-4o)"
                  }
                  disabled={modelsLoading}
                  value={values.model}
                  onChange={(e) => set("model", e.target.value)}
                />
              ) : (
                <Select
                  value={values.model}
                  onValueChange={(value) =>
                    value === "__custom__" ? setCustomModelMode(true) : set("model", value)
                  }
                >
                  <SelectTrigger className="w-full flex-1">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.id}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">Custom model…</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Button type="button" variant="outline" size="sm" onClick={loadModels} disabled={modelsLoading}>
                {modelsLoading ? "Loading…" : "Fetch Models"}
              </Button>
            </div>
          </FieldRow>
          <label className="flex items-center justify-between rounded-lg border p-3">
            <span>
              <span className="block text-sm font-medium">Enable AI Features</span>
              <span className="text-muted-foreground block text-xs">Turn on/off AI functionality</span>
            </span>
            <Switch checked={values.isEnabled} onCheckedChange={(checked) => set("isEnabled", checked)} />
          </label>
          {submitError ? (
            <p className="text-destructive text-sm">{toErrorMessage(submitError)}</p>
          ) : null}
          <DialogFooter className="flex flex-row items-center gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={testConnection}
              disabled={testing}
              className="gap-1.5"
            >
              <PlugIcon className="size-4" /> Test Connection
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : aiId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CustomProvidersDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<CustomProvider[]>([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || loadedOnce) return
    const t = setTimeout(() => {
      setLoadedOnce(true)
      void (async () => {
        try {
          const result = await dokploy<CustomProvider[]>("GET", "ai.getCustomProviders")
          const list = Array.isArray(result) ? result : []
          setProviders(list.map((p) => ({ name: p.name, apiUrl: p.apiUrl })))
        } catch (cause: unknown) {
          setError(toErrorMessage(cause))
        }
      })()
    }, 0)
    return () => clearTimeout(t)
  }, [open, loadedOnce])

  const save = async () => {
    for (const [index, provider] of providers.entries()) {
      if (!provider.name.trim() || !provider.apiUrl.trim()) {
        setError(`Provider #${index + 1}: name and URL are required`)
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      await dokploy("POST", "ai.saveCustomProviders", { providers })
      toast.success("Custom providers saved successfully")
      setOpen(false)
      onSaved()
    } catch (cause: unknown) {
      setError(toErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ServerIcon className="size-4" /> Custom Presets
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Custom AI Providers</DialogTitle>
          <DialogDescription>
            Define your own AI providers (e.g. an internal LLM platform). When at least one is
            defined, only these are offered in AI configurations.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {providers.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No custom providers defined. The built-in provider list will be used.
          </p>
        ) : null}
        <div className="grid gap-2">
          {providers.map((provider, index) => (
            <div key={index} className="flex items-start gap-2">
              <Input
                className="flex-1"
                placeholder="Internal LLM"
                value={provider.name}
                onChange={(e) =>
                  setProviders((list) =>
                    list.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)),
                  )
                }
              />
              <Input
                className="flex-[2]"
                placeholder="https://llm.internal.company/v1"
                value={provider.apiUrl}
                onChange={(e) =>
                  setProviders((list) =>
                    list.map((p, i) => (i === index ? { ...p, apiUrl: e.target.value } : p)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="group hover:bg-red-500/10"
                onClick={() => setProviders((list) => list.filter((_, i) => i !== index))}
              >
                <Trash2Icon className="text-primary group-hover:text-red-500 size-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setProviders((list) => [...list, { name: "", apiUrl: "" }])}
          >
            <PlusIcon className="size-4" /> Add Provider
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function DokploySettingsAiPage() {
  const { data, error, loading, reload } = useUpstream<AiConfig[]>(
    () => dokploy<AiConfig[]>("GET", "ai.getAll"),
    [],
  )
  const { data: enabledProviders, reload: reloadEnabled } = useUpstream<string[]>(
    () => dokploy<string[]>("GET", "ai.getEnabledProviders"),
    [],
  )
  const { reload: reloadCustom } = useUpstream<CustomProvider[]>(
    () => dokploy<CustomProvider[]>("GET", "ai.getCustomProviders"),
    [],
  )

  const removeAi = async (config: AiConfig) => {
    try {
      await dokploy("POST", "ai.delete", { aiId: config.aiId })
      toast.success("AI deleted successfully")
      reload()
    } catch (cause: unknown) {
      toast.error(toErrorMessage(cause))
    }
  }

  const configs = data ?? []

  return (
    <div className="flex flex-col gap-6">
      <K6Breadcrumbs current="AI" />
      <PageHeader
        title="AI Settings"
        description="Bring your own AI provider keys for log analysis and compose suggestions."
        actions={
          <div className="flex items-center gap-2">
            <CustomProvidersDialog
              onSaved={() => {
                reloadCustom()
              }}
            />
            <HandleAiDialog
              onSaved={() => {
                reload()
                reloadEnabled()
              }}
              trigger={
                <Button size="sm">
                  <PlusIcon className="size-4" /> Add AI
                </Button>
              }
            />
          </div>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BotIcon className="text-muted-foreground size-5" />
            Configurations ({configs.length})
          </CardTitle>
          <CardDescription>
            Enabled providers available to features:{" "}
            {enabledProviders && enabledProviders.length > 0 ? (
              enabledProviders.map((name) => (
                <Badge key={name} variant="outline" className="mr-1">
                  {name}
                </Badge>
              ))
            ) : (
              <span>none yet</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 border-t pt-6">
          {error ? (
            <p className="text-destructive text-sm">{toErrorMessage(error)}</p>
          ) : loading ? (
            <div className="grid gap-2">
              {[1, 2].map((n) => (
                <div key={n} className="bg-muted h-16 w-full animate-pulse rounded-md" />
              ))}
            </div>
          ) : configs.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              You don't have any AI configurations yet.
            </p>
          ) : (
            configs.map((config) => (
              <div
                key={config.aiId}
                className="flex items-center justify-between rounded-lg border p-3.5"
              >
                <div>
                  <span className="text-sm font-medium">{config.name}</span>
                  <p className="text-muted-foreground text-xs">
                    {config.model} · {config.apiUrl}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant={config.isEnabled ? "secondary" : "outline"}>
                    {config.isEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <HandleAiDialog
                    aiId={config.aiId}
                    onSaved={() => {
                      reload()
                      reloadEnabled()
                    }}
                    trigger={
                      <Button variant="ghost" size="icon" className="group hover:bg-blue-500/10">
                        <PenBoxIcon className="text-primary group-hover:text-blue-500 size-3.5" />
                      </Button>
                    }
                  />
                  <ConfirmAction
                    title="Delete AI"
                    description={`Delete the AI configuration "${config.name}"? Features using it will fall back to manual workflows.`}
                    confirmLabel="Delete"
                    onConfirm={() => removeAi(config)}
                    trigger={
                      <Button variant="ghost" size="icon" className="group hover:bg-red-500/10">
                        <Trash2Icon className="text-primary group-hover:text-red-500 size-4" />
                      </Button>
                    }
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
