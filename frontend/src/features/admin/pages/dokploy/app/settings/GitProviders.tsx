// Dokploy parity #17 — settings/git-providers.tsx +
// components/dashboard/settings/git/{show-git-providers,github/*,gitlab/*,
// gitea/*,bitbucket/*}. Provider accounts across the four families backed by
// github./gitlab./gitea./bitbucket.{providers,one,testConnection,update,
// get*Branches,get*Repositories} plus gitProvider.{getAll,remove,toggleShare}.
import { useState } from "react"
import { toast } from "sonner"
import {
  ExternalLinkIcon,
  GitBranchIcon,
  PencilIcon,
  PlugZapIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { dokploy, toErrorMessage, useUpstream } from "../shared"
import { FieldErrorText, runMutation } from "./helpers"

type Row = Record<string, unknown>

interface EditField {
  key: string
  label: string
  type?: "text" | "password"
  required?: boolean
}

interface FamilyConfig {
  key: "github" | "gitlab" | "gitea" | "bitbucket"
  label: string
  listOp: string
  updateOp: string
  testOp: string
  testBody: (id: string) => Record<string, unknown>
  /** Flat id column on provider rows ({githubId} etc.). */
  idKey: string
  /** gitProvider.getAll nested object carrying this family's details. */
  nestedOnAll: string
  reposOp: string
  reposQuery: (id: string) => Record<string, string>
  branchesOp: string
  branchesQuery: (id: string, owner: string, repo: string) => Record<string, string>
  repoNameKey: string
  repoFullNameKey: string
  editFields: EditField[]
}

const FAMILIES: FamilyConfig[] = [
  {
    key: "github",
    label: "GitHub",
    listOp: "github.githubProviders",
    updateOp: "github.update",
    testOp: "github.testConnection",
    testBody: (id) => ({ githubId: id }),
    idKey: "githubId",
    nestedOnAll: "github",
    reposOp: "github.getGithubRepositories",
    reposQuery: (id) => ({ githubId: id }),
    branchesOp: "github.getGithubBranches",
    branchesQuery: (id, owner, repo) => ({ githubId: id, owner, repo }),
    repoNameKey: "name",
    repoFullNameKey: "full_name",
    editFields: [
      { key: "name", label: "Display name", required: true },
      { key: "githubAppName", label: "GitHub App name", required: true },
    ],
  },
  {
    key: "gitlab",
    label: "GitLab",
    listOp: "gitlab.gitlabProviders",
    updateOp: "gitlab.update",
    testOp: "gitlab.testConnection",
    testBody: (id) => ({ gitlabId: id }),
    idKey: "gitlabId",
    nestedOnAll: "gitlab",
    reposOp: "gitlab.getGitlabRepositories",
    reposQuery: (id) => ({ gitlabId: id }),
    branchesOp: "gitlab.getGitlabBranches",
    branchesQuery: (id, owner, repo) => ({ gitlabId: id, owner, repo }),
    repoNameKey: "name",
    repoFullNameKey: "path_with_namespace",
    editFields: [
      { key: "name", label: "Display name", required: true },
      { key: "gitlabUrl", label: "GitLab URL", required: true },
      { key: "groupName", label: "Group name" },
      { key: "applicationId", label: "Application ID" },
      { key: "secret", label: "Secret", type: "password" },
      { key: "redirectUri", label: "Redirect URI" },
    ],
  },
  {
    key: "gitea",
    label: "Gitea",
    listOp: "gitea.giteaProviders",
    updateOp: "gitea.update",
    testOp: "gitea.testConnection",
    testBody: (id) => ({ giteaId: id }),
    idKey: "giteaId",
    nestedOnAll: "gitea",
    reposOp: "gitea.getGiteaRepositories",
    reposQuery: (id) => ({ giteaId: id }),
    branchesOp: "gitea.getGiteaBranches",
    branchesQuery: (id, owner, repo) => ({ giteaId: id, owner, repositoryName: repo }),
    repoNameKey: "name",
    repoFullNameKey: "full_name",
    editFields: [
      { key: "name", label: "Display name", required: true },
      { key: "giteaUrl", label: "Gitea URL", required: true },
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client secret", type: "password" },
      { key: "accessToken", label: "Access token", type: "password" },
      { key: "giteaUsername", label: "Username" },
      { key: "organizationName", label: "Organization name" },
      { key: "redirectUri", label: "Redirect URI" },
    ],
  },
  {
    key: "bitbucket",
    label: "Bitbucket",
    listOp: "bitbucket.bitbucketProviders",
    updateOp: "bitbucket.update",
    testOp: "bitbucket.testConnection",
    testBody: (id) => ({ bitbucketId: id }),
    idKey: "bitbucketId",
    nestedOnAll: "bitbucket",
    reposOp: "bitbucket.getBitbucketRepositories",
    reposQuery: (id) => ({ bitbucketId: id }),
    branchesOp: "bitbucket.getBitbucketBranches",
    branchesQuery: (id, owner, repo) => ({ bitbucketId: id, owner, repo }),
    repoNameKey: "name",
    repoFullNameKey: "full_name",
    editFields: [
      { key: "name", label: "Display name", required: true },
      { key: "bitbucketUsername", label: "Username" },
      { key: "bitbucketEmail", label: "Email" },
      { key: "appPassword", label: "App password", type: "password" },
      { key: "apiToken", label: "API token", type: "password" },
      { key: "bitbucketWorkspaceName", label: "Workspace name" },
    ],
  },
]

function readEditValues(family: FamilyConfig, row: Row): Record<string, string> {
  // Fields live spread across the provider detail ({githubId} row), its
  // family-specific nested object and the shared gitProvider record.
  const source: Row = {
    ...row,
    ...(typeof row.gitProvider === "object" && row.gitProvider !== null
      ? (row.gitProvider as Row)
      : {}),
    ...((typeof row[family.nestedOnAll] === "object" && row[family.nestedOnAll] !== null
      ? (row[family.nestedOnAll] as Row)
      : {}) as Row),
  }
  const values: Record<string, string> = {}
  for (const field of family.editFields) {
    const raw = source[field.key]
    values[field.key] = raw === undefined || raw === null ? "" : String(raw)
  }
  return values
}

export default function DokploySettingsGitProvidersPage() {
  const allProviders = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "gitProvider.getAll"), [])
  const [removeProvider, setRemoveProvider] = useState<Row | null>(null)
  const [removing, setRemoving] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Git Providers"
        description="Connected GitHub, GitLab, Gitea and Bitbucket accounts used to deploy applications."
      />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All providers</TabsTrigger>
          {FAMILIES.map((family) => (
            <TabsTrigger key={family.key} value={family.key}>
              {family.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="all">
          <SharedProvidersPanel
            providers={allProviders}
            onRemove={setRemoveProvider}
          />
        </TabsContent>

        {FAMILIES.map((family) => (
          <TabsContent key={family.key} value={family.key}>
            <FamilyPanel key={family.key} family={family} />
          </TabsContent>
        ))}
      </Tabs>

      {/* Remove git provider confirmation */}
      <AlertDialog
        open={removeProvider !== null}
        onOpenChange={(open) => (open ? null : setRemoveProvider(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove git provider?</AlertDialogTitle>
            <AlertDialogDescription>
              “{String(removeProvider?.name ?? "")}” will be disconnected. Applications using it keep
              their saved build configuration but can no longer refresh tokens or list repositories.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault()
                if (!removeProvider) return
                setRemoving(true)
                void runMutation(
                  () =>
                    dokploy("POST", "gitProvider.remove", {
                      gitProviderId: String(removeProvider.gitProviderId ?? ""),
                    }),
                  {
                    success: "Git provider removed",
                    onDone: () => {
                      setRemoveProvider(null)
                      allProviders.reload()
                    },
                  },
                ).then(() => setRemoving(false))
              }}
            >
              {removing ? <Spinner className="size-4" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** gitProvider.getAll table with share toggle + remove (repo show-git-providers). */
function SharedProvidersPanel({
  providers,
  onRemove,
}: {
  providers: ReturnType<typeof useUpstream<Row[]>>
  onRemove: (row: Row) => void
}) {
  const [toggling, setToggling] = useState<string | null>(null)
  const columns: Array<SimpleColumn<Row>> = [
    { key: "name", header: "Name" },
    {
      key: "providerType",
      header: "Type",
      render: (row) => <Badge variant="secondary">{String(row.providerType ?? "?")}</Badge>,
    },
    {
      key: "sharedWithOrganization",
      header: "Shared with organization",
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <Switch
            checked={Boolean(row.sharedWithOrganization)}
            disabled={toggling === String(row.gitProviderId)}
            onCheckedChange={(checked) => {
              setToggling(String(row.gitProviderId))
              void runMutation(
                () =>
                  dokploy("POST", "gitProvider.toggleShare", {
                    gitProviderId: String(row.gitProviderId ?? ""),
                    sharedWithOrganization: checked,
                  }),
                {
                  success: checked ? "Provider shared" : "Sharing disabled",
                  onDone: () => providers.reload(),
                },
              ).then(() => setToggling(null))
            }}
          />
        </div>
      ),
      className: "text-right",
    },
    { key: "createdAt", header: "Created" },
    {
      key: "actions",
      header: "",
      className: "w-16",
      render: (row) => (
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive"
          title="Remove"
          onClick={() => onRemove(row)}
        >
          <Trash2Icon className="size-4" />
        </Button>
      ),
    },
  ]
  return (
    <div className="pt-4">
      {providers.error ? <ErrorBanner error={providers.error} /> : null}
      <SimpleDataTable
        columns={columns}
        rows={providers.data ?? []}
        loading={providers.loading}
        getRowKey={(row) => String(row.gitProviderId ?? row.name)}
        emptyMessage="No git providers connected yet."
      />
    </div>
  )
}

/** One family tab: provider cards + edit dialog + branch/repo explorer. */
function FamilyPanel({ family }: { family: FamilyConfig }) {
  const list = useUpstream<Row[]>(() => dokploy<Row[]>("GET", family.listOp), [family.listOp])
  const [editRow, setEditRow] = useState<Row | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const openEdit = (row: Row) => {
    setValues(readEditValues(family, row))
    setErrors({})
    setEditRow(row)
  }

  const save = async () => {
    if (!editRow) return
    const localErrors: Record<string, string> = {}
    for (const field of family.editFields) {
      if (field.required && !values[field.key]?.trim()) {
        localErrors[field.key] = `${field.label} is required`
      }
    }
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors)
      return
    }
    setSaving(true)
    setErrors({})
    const nestedProvider =
      typeof editRow.gitProvider === "object" && editRow.gitProvider !== null
        ? (editRow.gitProvider as Row)
        : editRow
    const body: Record<string, unknown> = {
      ...values,
      [family.idKey]: String(editRow[family.idKey] ?? ""),
      gitProviderId: String(nestedProvider.gitProviderId ?? editRow.gitProviderId ?? ""),
    }
    const result = await runMutation(() => dokploy("POST", family.updateOp, body), {
      success: `${family.label} provider updated`,
      onDone: () => {
        setEditRow(null)
        list.reload()
      },
    })
    if (!result.ok) setErrors(result.fieldErrors)
    setSaving(false)
  }

  const test = async () => {
    if (!editRow) return
    setTesting(true)
    try {
      await dokploy("POST", family.testOp, family.testBody(String(editRow[family.idKey] ?? "")))
      toast.success(`${family.label} connection OK`)
    } catch (cause) {
      toast.error(toErrorMessage(cause))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-4 pt-4">
      {list.error ? <ErrorBanner error={list.error} /> : null}
      {list.loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Loading {family.label} providers…
          </CardContent>
        </Card>
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          message={`No ${family.label} providers connected.`}
          description={
            family.key === "github"
              ? "Install the Dokploy GitHub App on your account to connect one."
              : `Add a ${family.label} provider from an application's build settings.`
          }
        />
      ) : (
        (list.data ?? []).map((row) => {
          const gp = (row.gitProvider ?? {}) as Row
          return (
            <Card key={String(row[family.idKey] ?? gp.gitProviderId)}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranchIcon className="size-4 text-muted-foreground" />
                  {String(gp.name ?? family.label)}
                  <Badge variant="outline" className="ml-1">
                    {String(gp.providerType ?? family.key)}
                  </Badge>
                  {gp.sharedWithOrganization ? (
                    <Badge variant="secondary">shared</Badge>
                  ) : null}
                </CardTitle>
                <CardDescription className="flex items-center gap-1">
                  {String(row[`${family.key}Url`] ?? "")}
                  {typeof gp.createdAt === "string" ? <> · created {gp.createdAt.slice(0, 10)}</> : null}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap justify-end gap-2">
                <RepoExplorer family={family} row={row} />
                <Button variant="outline" size="sm" onClick={() => openEdit(row)}>
                  <PencilIcon className="size-4" />
                  Edit
                </Button>
              </CardContent>
            </Card>
          )
        })
      )}

      {/* Edit dialog */}
      <Dialog open={editRow !== null} onOpenChange={(open) => (open ? null : setEditRow(null))}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {family.label} provider</DialogTitle>
            <DialogDescription>
              Calls <code>{family.updateOp}</code>. Secrets stay unchanged when left blank.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {family.editFields.map((field) => (
              <div className="space-y-2" key={field.key}>
                <Label htmlFor={`gp-${field.key}`}>
                  {field.label}
                  {field.required ? " *" : ""}
                </Label>
                <Input
                  id={`gp-${field.key}`}
                  type={field.type === "password" ? "password" : "text"}
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
                <FieldErrorText>{errors[field.key]}</FieldErrorText>
              </div>
            ))}
            {errors._form ? <FieldErrorText>{errors._form}</FieldErrorText> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={test} disabled={testing}>
              {testing ? <Spinner className="size-4" /> : <PlugZapIcon className="size-4" />}
              Test connection
            </Button>
            <Button variant="outline" onClick={() => setEditRow(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Spinner className="size-4" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Branch + repository picker exercising the get*Repositories/Branches ops. */
function RepoExplorer({ family, row }: { family: FamilyConfig; row: Row }) {
  const [open, setOpen] = useState(false)
  const [repos, setRepos] = useState<Row[] | null>(null)
  const [reposLoading, setReposLoading] = useState(false)
  const [reposError, setReposError] = useState<unknown>(null)
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string } | null>(null)
  const [branches, setBranches] = useState<Row[] | null>(null)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [branchesError, setBranchesError] = useState<unknown>(null)

  const loadRepos = async () => {
    setReposLoading(true)
    setReposError(null)
    setRepos(null)
    setBranches(null)
    setSelectedRepo(null)
    try {
      const result = await dokploy<Row[]>(
        "GET",
        family.reposOp,
        undefined,
        family.reposQuery(String(row[family.idKey] ?? "")),
      )
      setRepos(Array.isArray(result) ? result : [])
    } catch (cause) {
      setReposError(cause)
    } finally {
      setReposLoading(false)
    }
  }

  const loadBranches = async (owner: string, repo: string) => {
    setBranchesLoading(true)
    setBranchesError(null)
    try {
      const result = await dokploy<Row[]>(
        "GET",
        family.branchesOp,
        undefined,
        family.branchesQuery(String(row[family.idKey] ?? ""), owner, repo),
      )
      setBranches(Array.isArray(result) ? result : [])
    } catch (cause) {
      setBranchesError(cause)
    } finally {
      setBranchesLoading(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true)
          void loadRepos()
        }}
      >
        <ExternalLinkIcon className="size-4" />
        Browse repos & branches
      </Button>

      <Dialog open={open} onOpenChange={(next) => (next ? null : setOpen(false))}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{family.label} repositories</DialogTitle>
            <DialogDescription>
              Live listing via <code>{family.reposOp}</code>; pick a repo to list its branches.
            </DialogDescription>
          </DialogHeader>

          {reposError ? <ErrorBanner error={reposError} /> : null}
          {!repos && reposLoading ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Loading repositories…
            </p>
          ) : null}
          {repos && repos.length === 0 ? (
            <EmptyState message="No accessible repositories found." />
          ) : null}
          {repos && repos.length > 0 && !selectedRepo ? (
            <ul className="divide-y rounded-md border">
              {repos.slice(0, 100).map((repo) => {
                const fullName = String(repo[family.repoFullNameKey] ?? "")
                const name = String(repo[family.repoNameKey] ?? "")
                const owner = fullName.includes("/") ? fullName.split("/")[0] : ""
                return (
                  <li key={fullName || name}>
                    <button
                      type="button"
                      className="hover:bg-muted/50 flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                      onClick={() => {
                        setSelectedRepo({ owner, repo: name })
                        void loadBranches(owner, name)
                      }}
                    >
                      <span className="truncate">{fullName || name}</span>
                      {"private" in repo && repo.private ? (
                        <Badge variant="secondary">private</Badge>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}

          {selectedRepo ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {selectedRepo.owner}/{selectedRepo.repo}
                </p>
                <Button variant="ghost" size="sm" onClick={() => setSelectedRepo(null)}>
                  ← All repositories
                </Button>
              </div>
              {branchesError ? <ErrorBanner error={branchesError} /> : null}
              {branchesLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-4" /> Loading branches…
                </p>
              ) : branches && branches.length === 0 ? (
                <EmptyState message="No branches found." />
              ) : null}
              {branches && branches.length > 0 ? (
                <ul className="divide-y rounded-md border">
                  {branches.slice(0, 50).map((branch) => (
                    <li
                      key={String(branch.name ?? ((branch.commit as Row | undefined)?.sha ?? ""))}
                      className="flex items-center gap-2 px-3 py-2 text-sm"
                    >
                      <RefreshCwIcon className="size-3 rotate-45 text-muted-foreground" />
                      {String(branch.name ?? "?")}
                      {(branch as Row).protected ? (
                        <Badge variant="secondary" className="text-[10px]">
                          protected
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button variant="outline" onClick={() => void loadRepos()} disabled={reposLoading}>
              Reload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

