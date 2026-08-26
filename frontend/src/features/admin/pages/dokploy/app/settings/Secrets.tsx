// K6 · Settings ▸ Secrets — parity with pages/dashboard/settings/secrets.tsx
// (+ vault/show-vault-providers.tsx / handle-vault-provider.tsx):
// vaultProvider.all/create/update/remove/testConnection plus a secret-name
// browser per provider (vaultProvider.listSecretNames).
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { EyeIcon, PenBoxIcon, PlusIcon, Trash2Icon, VaultIcon } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import type { UpstreamError } from "../shared"
import { dokploy, toErrorMessage, useUpstream } from "../shared"
import {
  ConfirmAction,
  FieldRow,
  K6Breadcrumbs,
  asDisplayError,
  fieldErrorsFrom,
} from "./k6-helpers"

type VaultProviderType = "hashicorp" | "infisical" | "aws" | "doppler" | "azure" | "scaleway"

const PROVIDER_LABELS: Record<VaultProviderType, string> = {
  hashicorp: "HashiCorp Vault / OpenBao",
  infisical: "Infisical",
  aws: "AWS Secrets Manager",
  doppler: "Doppler",
  azure: "Azure Key Vault",
  scaleway: "Scaleway Secret Manager",
}

interface VaultAssignment {
  projectId: string
  environmentIds: string[]
}

interface VaultConfig {
  providerType: VaultProviderType
  // hashicorp
  url?: string
  token?: string
  namespace?: string
  mount?: string
  // infisical
  siteUrl?: string
  clientId?: string
  clientSecret?: string
  projectId?: string
  environmentSlug?: string
  secretPath?: string
  // aws
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
  endpoint?: string
  // doppler
  serviceToken?: string
  project?: string
  config?: string
  // azure
  vaultUri?: string
  tenantId?: string
  // scaleway
  secretKey?: string
  apiUrl?: string
}

export interface VaultProviderRow {
  vaultProviderId: string
  name: string
  providerType?: VaultProviderType
  config?: VaultConfig & { providerType: VaultProviderType }
  assignments?: VaultAssignment[]
}

interface ProjectRow {
  projectId: string
  name: string
  environments?: Array<{ environmentId: string; name: string }>
}

/** Per-type required fields and their messages (mirrors upstream superRefine). */
const REQUIRED_FIELDS: Record<VaultProviderType, Array<[keyof VaultFormValues, string]>> = {
  hashicorp: [
    ["url", "Vault URL is required"],
    ["token", "Token is required"],
    ["mount", "Mount is required"],
  ],
  infisical: [
    ["siteUrl", "Site URL is required"],
    ["clientId", "Client ID is required"],
    ["clientSecret", "Client Secret is required"],
    ["infisicalProjectId", "Project ID is required"],
    ["environmentSlug", "Environment is required"],
  ],
  aws: [
    ["region", "Region is required"],
    ["accessKeyId", "Access Key ID is required"],
    ["secretAccessKey", "Secret Access Key is required"],
  ],
  doppler: [["serviceToken", "Service Token is required"]],
  azure: [
    ["vaultUri", "Vault URI is required"],
    ["tenantId", "Tenant ID is required"],
    ["azureClientId", "Client ID is required"],
    ["azureClientSecret", "Client Secret is required"],
  ],
  scaleway: [
    ["scalewayRegion", "Region is required"],
    ["scalewayProjectId", "Project ID is required"],
    ["scalewaySecretKey", "Secret Key is required"],
  ],
}

interface VaultFormValues {
  name: string
  providerType: VaultProviderType
  url: string
  token: string
  namespace: string
  mount: string
  siteUrl: string
  clientId: string
  clientSecret: string
  infisicalProjectId: string
  environmentSlug: string
  secretPath: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  awsEndpoint: string
  serviceToken: string
  dopplerProject: string
  dopplerConfig: string
  vaultUri: string
  tenantId: string
  azureClientId: string
  azureClientSecret: string
  scalewayRegion: string
  scalewayProjectId: string
  scalewaySecretKey: string
  scalewayApiUrl: string
}

const DEFAULT_VALUES: VaultFormValues = {
  name: "",
  providerType: "hashicorp",
  url: "",
  token: "",
  namespace: "",
  mount: "secret",
  siteUrl: "https://app.infisical.com",
  clientId: "",
  clientSecret: "",
  infisicalProjectId: "",
  environmentSlug: "",
  secretPath: "/",
  region: "",
  accessKeyId: "",
  secretAccessKey: "",
  awsEndpoint: "",
  serviceToken: "",
  dopplerProject: "",
  dopplerConfig: "",
  vaultUri: "",
  tenantId: "",
  azureClientId: "",
  azureClientSecret: "",
  scalewayRegion: "fr-par",
  scalewayProjectId: "",
  scalewaySecretKey: "",
  scalewayApiUrl: "https://api.scaleway.com",
}

function buildConfig(v: VaultFormValues): VaultConfig {
  switch (v.providerType) {
    case "hashicorp":
      return {
        providerType: "hashicorp",
        url: v.url,
        token: v.token,
        namespace: v.namespace || undefined,
        mount: v.mount || "secret",
      }
    case "infisical":
      return {
        providerType: "infisical",
        siteUrl: v.siteUrl || "https://app.infisical.com",
        clientId: v.clientId,
        clientSecret: v.clientSecret,
        projectId: v.infisicalProjectId,
        environmentSlug: v.environmentSlug,
        secretPath: v.secretPath || "/",
      }
    case "aws":
      return {
        providerType: "aws",
        region: v.region,
        accessKeyId: v.accessKeyId,
        secretAccessKey: v.secretAccessKey,
        endpoint: v.awsEndpoint || undefined,
      }
    case "doppler":
      return {
        providerType: "doppler",
        serviceToken: v.serviceToken,
        project: v.dopplerProject || undefined,
        config: v.dopplerConfig || undefined,
      }
    case "azure":
      return {
        providerType: "azure",
        vaultUri: v.vaultUri,
        tenantId: v.tenantId,
        clientId: v.azureClientId,
        clientSecret: v.azureClientSecret,
      }
    case "scaleway":
      return {
        providerType: "scaleway",
        region: v.scalewayRegion || "fr-par",
        projectId: v.scalewayProjectId,
        secretKey: v.scalewaySecretKey,
        apiUrl: v.scalewayApiUrl || "https://api.scaleway.com",
      }
  }
}

function HandleVaultDialog({
  vaultProviderId,
  onSaved,
  trigger,
}: {
  vaultProviderId?: string
  onSaved: () => void
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const { data: current } = useUpstream<VaultProviderRow | null>(
    () =>
      vaultProviderId && open
        ? dokploy<VaultProviderRow>("GET", "vaultProvider.one", undefined, {
            vaultProviderId,
          })
        : Promise.resolve(null),
    [vaultProviderId, open],
  )
  const { data: projects } = useUpstream<ProjectRow[]>(
    () => (open ? dokploy<ProjectRow[]>("GET", "project.all") : Promise.resolve([])),
    [open],
  )

  const [values, setValues] = useState<VaultFormValues>(DEFAULT_VALUES)
  const [assignments, setAssignments] = useState<VaultAssignment[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<UpstreamError | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setSubmitError(null)
      setFieldErrors({})
      if (current) {
        const config = current.config
        const base: VaultFormValues = { ...DEFAULT_VALUES, name: current.name ?? "" }
        if (config?.providerType) base.providerType = config.providerType
        if (config?.providerType === "hashicorp") Object.assign(base, {
          url: config.url ?? "", token: config.token ?? "",
          namespace: config.namespace ?? "", mount: config.mount ?? "secret",
        })
        else if (config?.providerType === "infisical") Object.assign(base, {
          siteUrl: config.siteUrl ?? "https://app.infisical.com",
          clientId: config.clientId ?? "", clientSecret: config.clientSecret ?? "",
          infisicalProjectId: config.projectId ?? "", environmentSlug: config.environmentSlug ?? "",
          secretPath: config.secretPath ?? "/",
        })
        else if (config?.providerType === "aws") Object.assign(base, {
          region: config.region ?? "", accessKeyId: config.accessKeyId ?? "",
          secretAccessKey: config.secretAccessKey ?? "", awsEndpoint: config.endpoint ?? "",
        })
        else if (config?.providerType === "doppler") Object.assign(base, {
          serviceToken: config.serviceToken ?? "",
          dopplerProject: config.project ?? "", dopplerConfig: config.config ?? "",
        })
        else if (config?.providerType === "azure") Object.assign(base, {
          vaultUri: config.vaultUri ?? "", tenantId: config.tenantId ?? "",
          azureClientId: config.clientId ?? "", azureClientSecret: config.clientSecret ?? "",
        })
        else if (config?.providerType === "scaleway") Object.assign(base, {
          scalewayRegion: config.region ?? "fr-par", scalewayProjectId: config.projectId ?? "",
          scalewaySecretKey: config.secretKey ?? "",
          scalewayApiUrl: config.apiUrl ?? "https://api.scaleway.com",
        })
        setValues(base)
        setAssignments(current.assignments ?? [])
      } else if (!vaultProviderId) {
        setValues(DEFAULT_VALUES)
        setAssignments([])
      }
    }, 0)
    return () => clearTimeout(t)
  }, [open, current, vaultProviderId])

  const set = <K extends keyof VaultFormValues>(key: K, value: VaultFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const validate = (): boolean => {
    const errors: Record<string, string> = {}
    if (!values.name.trim()) errors.name = "Name is required"
    else if (!/^[a-zA-Z0-9_-]+$/.test(values.name.trim()))
      errors.name = "Only letters, numbers, dashes and underscores (used in ${{vault.<name>.<secret>}})"
    for (const [field, message] of REQUIRED_FIELDS[values.providerType]) {
      if (!String(values[field]).trim()) errors[field as string] = message
    }
    const urlChecks: Array<[keyof VaultFormValues, string]> =
      values.providerType === "hashicorp"
        ? [["url", "Enter a valid URL (e.g. https://vault.example.com:8200)"]]
        : values.providerType === "azure"
          ? [["vaultUri", "Enter a valid URL (e.g. https://my-vault.vault.azure.net)"]]
          : values.providerType === "aws"
            ? [["awsEndpoint", "Enter a valid URL"]]
            : values.providerType === "scaleway"
              ? [["scalewayApiUrl", "Enter a valid URL (e.g. https://api.scaleway.com)"]]
              : values.providerType === "infisical"
                ? [["siteUrl", "Enter a valid URL (e.g. https://app.infisical.com)"]]
                : []
    for (const [field, message] of urlChecks) {
      const raw = String(values[field])
      if (raw && !isValidHttpUrl(raw)) errors[field as string] = message
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitError(null)
    if (!validate()) return
    setBusy(true)
    try {
      await dokploy("POST", vaultProviderId ? "vaultProvider.update" : "vaultProvider.create", {
        name: values.name.trim(),
        config: buildConfig(values),
        assignments,
        ...(vaultProviderId ? { vaultProviderId } : {}),
      })
      toast.success(vaultProviderId ? "Vault provider updated" : "Vault provider created")
      setOpen(false)
      onSaved()
    } catch (cause: unknown) {
      const err = cause as UpstreamError
      setSubmitError(err)
      toast.error(toErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const onTestConnection = async () => {
    if (!validate()) return
    setTesting(true)
    try {
      await dokploy("POST", "vaultProvider.testConnection", {
        config: buildConfig(values),
        ...(vaultProviderId ? { vaultProviderId } : {}),
      })
      toast.success("Connection successful")
    } catch (cause: unknown) {
      toast.error(`Connection failed: ${toErrorMessage(cause)}`)
    } finally {
      setTesting(false)
    }
  }

  const toggleProject = (projectId: string) => {
    setAssignments((list) =>
      list.some((a) => a.projectId === projectId)
        ? list.filter((a) => a.projectId !== projectId)
        : [...list, { projectId, environmentIds: [] }],
    )
  }

  const toggleEnvironment = (projectId: string, environmentId: string) => {
    setAssignments((list) =>
      list.map((a) =>
        a.projectId !== projectId
          ? a
          : {
              ...a,
              environmentIds: a.environmentIds.includes(environmentId)
                ? a.environmentIds.filter((e) => e !== environmentId)
                : [...a.environmentIds, environmentId],
            },
      ),
    )
  }

  const zodErrors = submitError ? fieldErrorsFrom(submitError) : null
  const errorFor = (name: keyof VaultFormValues) =>
    fieldErrors[name as string] ?? zodErrors?.[name as string]?.[0]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {vaultProviderId ? "Update Secrets Provider" : "Add Secrets Provider"}
          </DialogTitle>
          <DialogDescription>
            Reference secrets in environment variables with{" "}
            <code>{"${{vault.<name>.<secret>}}"}</code>. Secrets are fetched at deploy time.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <FieldRow label="Name" error={errorFor("name")}>
            <Input placeholder="prod-vault" value={values.name} onChange={(e) => set("name", e.target.value)} />
          </FieldRow>
          <FieldRow label="Provider">
            <Select
              value={values.providerType}
              onValueChange={(value) => set("providerType", value as VaultProviderType)}
              disabled={!!vaultProviderId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDER_LABELS) as VaultProviderType[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {PROVIDER_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>

          {values.providerType === "hashicorp" ? (
            <>
              <FieldRow label="Vault URL" error={errorFor("url")}>
                <Input placeholder="https://vault.example.com:8200" value={values.url} onChange={(e) => set("url", e.target.value)} />
              </FieldRow>
              <FieldRow label="Token" error={errorFor("token")}>
                <Input type="password" value={values.token} onChange={(e) => set("token", e.target.value)} />
              </FieldRow>
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="KV Mount" error={errorFor("mount")}>
                  <Input placeholder="secret" value={values.mount} onChange={(e) => set("mount", e.target.value)} />
                </FieldRow>
                <FieldRow label="Namespace (optional)">
                  <Input value={values.namespace} onChange={(e) => set("namespace", e.target.value)} />
                </FieldRow>
              </div>
            </>
          ) : null}

          {values.providerType === "infisical" ? (
            <>
              <FieldRow label="Site URL" error={errorFor("siteUrl")}>
                <Input value={values.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} />
              </FieldRow>
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Client ID" error={errorFor("clientId")}>
                  <Input value={values.clientId} onChange={(e) => set("clientId", e.target.value)} />
                </FieldRow>
                <FieldRow label="Client Secret" error={errorFor("clientSecret")}>
                  <Input type="password" value={values.clientSecret} onChange={(e) => set("clientSecret", e.target.value)} />
                </FieldRow>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Project ID" error={errorFor("infisicalProjectId")}>
                  <Input value={values.infisicalProjectId} onChange={(e) => set("infisicalProjectId", e.target.value)} />
                </FieldRow>
                <FieldRow label="Environment" error={errorFor("environmentSlug")}>
                  <Input placeholder="prod" value={values.environmentSlug} onChange={(e) => set("environmentSlug", e.target.value)} />
                </FieldRow>
              </div>
              <FieldRow label="Secret Path" error={errorFor("secretPath")}>
                <Input placeholder="/" value={values.secretPath} onChange={(e) => set("secretPath", e.target.value)} />
              </FieldRow>
            </>
          ) : null}

          {values.providerType === "aws" ? (
            <>
              <FieldRow label="Region" error={errorFor("region")}>
                <Input placeholder="us-east-1" value={values.region} onChange={(e) => set("region", e.target.value)} />
              </FieldRow>
              <FieldRow label="Access Key ID" error={errorFor("accessKeyId")}>
                <Input value={values.accessKeyId} onChange={(e) => set("accessKeyId", e.target.value)} />
              </FieldRow>
              <FieldRow label="Secret Access Key" error={errorFor("secretAccessKey")}>
                <Input type="password" value={values.secretAccessKey} onChange={(e) => set("secretAccessKey", e.target.value)} />
              </FieldRow>
              <FieldRow label="Endpoint (optional)" error={errorFor("awsEndpoint")}>
                <Input placeholder="http://localhost:4566" value={values.awsEndpoint} onChange={(e) => set("awsEndpoint", e.target.value)} />
              </FieldRow>
            </>
          ) : null}

          {values.providerType === "doppler" ? (
            <>
              <FieldRow label="Service Token" error={errorFor("serviceToken")}>
                <Input type="password" placeholder="dp.st.…" value={values.serviceToken} onChange={(e) => set("serviceToken", e.target.value)} />
              </FieldRow>
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Project (optional)">
                  <Input value={values.dopplerProject} onChange={(e) => set("dopplerProject", e.target.value)} />
                </FieldRow>
                <FieldRow label="Config (optional)">
                  <Input value={values.dopplerConfig} onChange={(e) => set("dopplerConfig", e.target.value)} />
                </FieldRow>
              </div>
            </>
          ) : null}

          {values.providerType === "azure" ? (
            <>
              <FieldRow label="Vault URI" error={errorFor("vaultUri")}>
                <Input placeholder="https://my-vault.vault.azure.net" value={values.vaultUri} onChange={(e) => set("vaultUri", e.target.value)} />
              </FieldRow>
              <FieldRow label="Tenant ID" error={errorFor("tenantId")}>
                <Input value={values.tenantId} onChange={(e) => set("tenantId", e.target.value)} />
              </FieldRow>
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Client ID" error={errorFor("azureClientId")}>
                  <Input value={values.azureClientId} onChange={(e) => set("azureClientId", e.target.value)} />
                </FieldRow>
                <FieldRow label="Client Secret" error={errorFor("azureClientSecret")}>
                  <Input type="password" value={values.azureClientSecret} onChange={(e) => set("azureClientSecret", e.target.value)} />
                </FieldRow>
              </div>
            </>
          ) : null}

          {values.providerType === "scaleway" ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Region" error={errorFor("scalewayRegion")}>
                  <Select value={values.scalewayRegion} onValueChange={(value) => set("scalewayRegion", value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="fr-par" />
                    </SelectTrigger>
                    <SelectContent>
                      {["fr-par", "nl-ams", "pl-waw"].map((region) => (
                        <SelectItem key={region} value={region}>{region}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
                <FieldRow label="Project ID" error={errorFor("scalewayProjectId")}>
                  <Input value={values.scalewayProjectId} onChange={(e) => set("scalewayProjectId", e.target.value)} />
                </FieldRow>
              </div>
              <FieldRow label="Secret Key" error={errorFor("scalewaySecretKey")}>
                <Input type="password" value={values.scalewaySecretKey} onChange={(e) => set("scalewaySecretKey", e.target.value)} />
              </FieldRow>
              <FieldRow label="API URL" error={errorFor("scalewayApiUrl")}>
                <Input value={values.scalewayApiUrl} onChange={(e) => set("scalewayApiUrl", e.target.value)} />
              </FieldRow>
            </>
          ) : null}

          <div className="rounded-lg border p-3">
            <p className="text-sm font-medium">Access</p>
            <p className="text-muted-foreground mb-2 text-xs">
              Only selected projects can reference this provider; pick environments to narrow further.
            </p>
            {(projects ?? []).map((project) => {
              const assignment = assignments.find((a) => a.projectId === project.projectId)
              return (
                <div key={project.projectId} className="mb-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={!!assignment} onCheckedChange={() => toggleProject(project.projectId)} />
                    {project.name}
                  </label>
                  {assignment ? (
                    <div className="ml-6 flex flex-wrap items-center gap-3">
                      {(project.environments ?? []).map((env) => (
                        <label key={env.environmentId} className="text-muted-foreground flex cursor-pointer items-center gap-1 text-xs">
                          <Checkbox
                            checked={assignment.environmentIds.includes(env.environmentId)}
                            onCheckedChange={() => toggleEnvironment(project.projectId, env.environmentId)}
                          />
                          {env.name}
                        </label>
                      ))}
                      {(project.environments ?? []).length === 0 ? (
                        <span className="text-muted-foreground text-xs italic">All environments</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          {submitError ? (
            <p className="text-destructive text-sm">{toErrorMessage(submitError)}</p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="secondary" onClick={onTestConnection} disabled={testing}>
              {testing ? "Testing…" : "Test Connection"}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : vaultProviderId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function isValidHttpUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function SecretNamesBrowser({ provider }: { provider: VaultProviderRow }) {
  const [open, setOpen] = useState(false)
  const { data: projects } = useUpstream<ProjectRow[]>(
    () => (open ? dokploy<ProjectRow[]>("GET", "project.all") : Promise.resolve([])),
    [open],
  )
  const [selectedProject, setSelectedProject] = useState("")
  const [selectedEnv, setSelectedEnv] = useState("")
  const [names, setNames] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const projectRows = projects ?? []
  const currentProject = projectRows.find((p) => p.projectId === selectedProject)

  useEffect(() => {
    const t = setTimeout(() => {
      setSelectedProject("")
      setSelectedEnv("")
      setNames(null)
      setError(null)
    }, 0)
    return () => clearTimeout(t)
  }, [open])

  const browse = async () => {
    if (!selectedProject) {
      setError("Select a project first")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await dokploy<string[]>("GET", "vaultProvider.listSecretNames", undefined, {
        vaultProviderId: provider.vaultProviderId,
        projectId: selectedProject,
        environmentId: selectedEnv || undefined,
      })
      setNames(Array.isArray(result) ? result : [])
    } catch (cause: unknown) {
      setError(toErrorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <EyeIcon className="size-3.5" /> Secrets
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Secret names — {provider.name}</DialogTitle>
          <DialogDescription>
            Names resolvable via <code>{"${{vault." + provider.name + ".<secret>}}"}</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FieldRow label="Project">
            <Select
              value={selectedProject}
              onValueChange={(value) => {
                setSelectedProject(value)
                setSelectedEnv("")
                setNames(null)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projectRows.map((project) => (
                  <SelectItem key={project.projectId} value={project.projectId}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Environment (optional)">
            <Select value={selectedEnv} onValueChange={(value) => { setSelectedEnv(value); setNames(null) }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All environments" />
              </SelectTrigger>
              <SelectContent>
                {(currentProject?.environments ?? []).map((env) => (
                  <SelectItem key={env.environmentId} value={env.environmentId}>
                    {env.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <Button size="sm" onClick={browse} disabled={loading}>
            {loading ? "Loading…" : "List Secret Names"}
          </Button>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {names ? (
            names.length === 0 ? (
              <p className="text-muted-foreground text-sm">No secrets returned for this scope.</p>
            ) : (
              <ul className="max-h-[40vh] overflow-auto rounded-md border">
                {names.map((name) => (
                  <li key={name} className="border-b px-3 py-1.5 font-mono text-xs last:border-b-0">
                    {name}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function DokploySettingsSecretsPage() {
  const { data, error, loading, reload } = useUpstream<VaultProviderRow[]>(
    () => dokploy<VaultProviderRow[]>("GET", "vaultProvider.all"),
    [],
  )
  const providers = data ?? []

  const removeProvider = async (provider: VaultProviderRow) => {
    try {
      await dokploy("POST", "vaultProvider.remove", { vaultProviderId: provider.vaultProviderId })
      toast.success("Secrets provider deleted")
      reload()
    } catch (cause: unknown) {
      toast.error(toErrorMessage(cause))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <K6Breadcrumbs current="Secrets Providers" />
      <PageHeader
        title="Secrets Providers"
        description="External secret managers injectable via ${{vault.<name>.<secret>}} references."
        actions={
          <HandleVaultDialog
            onSaved={reload}
            trigger={
              <Button size="sm">
                <PlusIcon className="size-4" /> Add Provider
              </Button>
            }
          />
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <VaultIcon className="text-muted-foreground size-5" />
            Providers ({providers.length})
          </CardTitle>
          <CardDescription>
            Deployments referencing a deleted provider will fail — removal asks for confirmation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 border-t pt-6">
          {asDisplayError(error) ? (
            <p className="text-destructive text-sm">{toErrorMessage(error)}</p>
          ) : loading ? (
            <div className="bg-muted h-16 w-full animate-pulse rounded-md" />
          ) : providers.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              You don't have any secrets providers configured yet.
            </p>
          ) : (
            providers.map((provider) => {
              const type = provider.config?.providerType ?? provider.providerType ?? "hashicorp"
              return (
                <div key={provider.vaultProviderId} className="rounded-lg border p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium">{provider.name}</span>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{PROVIDER_LABELS[type] ?? type}</Badge>
                        {!provider.assignments || provider.assignments.length === 0 ? (
                          <Badge variant="destructive">Not assigned</Badge>
                        ) : (
                          <Badge variant="secondary">
                            {provider.assignments.length}{" "}
                            {provider.assignments.length === 1 ? "project" : "projects"}
                          </Badge>
                        )}
                        <span className="text-muted-foreground font-mono text-xs">
                          {"${{" + `vault.${provider.name}.…` + "}}"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <SecretNamesBrowser provider={provider} />
                      <HandleVaultDialog
                        vaultProviderId={provider.vaultProviderId}
                        onSaved={reload}
                        trigger={
                          <Button variant="ghost" size="icon" className="group hover:bg-blue-500/10">
                            <PenBoxIcon className="text-primary group-hover:text-blue-500 size-4" />
                          </Button>
                        }
                      />
                      <ConfirmAction
                        title="Delete Secrets Provider"
                        description={`Deployments referencing "${provider.name}" will fail. Delete this provider anyway?`}
                        confirmLabel="Delete"
                        onConfirm={() => removeProvider(provider)}
                        trigger={
                          <Button variant="ghost" size="icon" className="group hover:bg-red-500/10">
                            <Trash2Icon className="text-primary group-hover:text-red-500 size-4" />
                          </Button>
                        }
                      />
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
