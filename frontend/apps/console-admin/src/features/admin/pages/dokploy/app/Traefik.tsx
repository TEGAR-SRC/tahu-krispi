import { useEffect, useMemo, useState } from "react"
import { FileTextIcon, SaveIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { dokploy, toErrorMessage, useUpstream } from "./shared"
import {
  ErrorCard,
  FieldCard,
  JsonBlock,
  K5Page,
  ServerSelect,
  TextAreaField,
  idFrom,
  mutate,
  rowsFrom,
  textValue,
  type Row,
} from "./k5-common"

export default function DokployTraefikPage() {
  const [serverId, setServerId] = useState("")
  const dirs = useUpstream<unknown>(() => dokploy("GET", "settings.readDirectories", undefined, { serverId: serverId || undefined }), [serverId])
  const paths = useMemo(() => collectPaths(dirs.data), [dirs.data])
  const [selectedPath, setSelectedPath] = useState("")

  useEffect(() => {
    const t = setTimeout(() => {
      if (!paths.length) {
        if (selectedPath) setSelectedPath("")
        return
      }
      if (!selectedPath || !paths.includes(selectedPath)) setSelectedPath(paths[0])
    }, 0)
    return () => clearTimeout(t)
  }, [paths, selectedPath])

  return (
    <K5Page title="Traefik files" description="Browse and edit Traefik dynamic configuration files through the real Dokploy settings endpoints.">
      <FieldCard title="Scope" description="settings.readDirectories, settings.readTraefikFile, and settings.updateTraefikFile accept an optional serverId.">
        <ServerSelect
          value={serverId}
          onChange={(next) => {
            setServerId(next)
            setSelectedPath("")
          }}
        />
      </FieldCard>
      <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Available files</CardTitle>
            <CardDescription>Real settings.readDirectories response, flattened into selectable paths.</CardDescription>
          </CardHeader>
          <CardContent className="flex w-full max-w-full min-w-0 flex-col gap-3">
            {dirs.error ? <ErrorCard error={dirs.error} /> : null}
            {dirs.loading ? <p className="text-sm text-muted-foreground">Loading files…</p> : null}
            {paths.length ? (
              <div className="flex max-h-96 flex-col gap-2 overflow-auto">
                {paths.map((path) => (
                  <Button key={path} variant={path === selectedPath ? "default" : "outline"} className="justify-start" onClick={() => setSelectedPath(path)}>
                    <FileTextIcon data-icon="inline-start" />
                    <span className="min-w-0 truncate">{path}</span>
                  </Button>
                ))}
              </div>
            ) : null}
            {!dirs.loading && !paths.length ? (
              <Alert>
                <AlertTitle>No selectable Traefik files returned</AlertTitle>
                <AlertDescription>The upstream directories payload is shown below exactly as received; this page does not invent a file tree when Dokploy returns a shape we cannot map safely.</AlertDescription>
              </Alert>
            ) : null}
            {dirs.data !== null && dirs.data !== undefined ? <JsonBlock value={dirs.data} /> : null}
          </CardContent>
        </Card>
        <EditorCard serverId={serverId} path={selectedPath} />
      </div>
    </K5Page>
  )
}

function EditorCard({ serverId, path }: { serverId: string; path: string }) {
  const file = useUpstream<unknown>(
    () => (path ? dokploy("GET", "settings.readTraefikFile", undefined, { path, serverId: serverId || undefined }) : Promise.resolve(null)),
    [path, serverId],
  )
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      if (typeof file.data === "string") {
        setContent(file.data)
        return
      }
      if (file.data && typeof file.data === "object") {
        const row = file.data as Row
        setContent(textValue(row, ["traefikConfig", "content", "file", "data"], JSON.stringify(file.data, null, 2)))
        return
      }
      setContent("")
    }, 0)
    return () => clearTimeout(t)
  }, [file.data])

  const save = async () => {
    setSaving(true)
    await mutate(
      () => dokploy("POST", "settings.updateTraefikFile", { path, traefikConfig: content, serverId: serverId || undefined }),
      "Traefik file updated",
      file.reload,
    )
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{path || "Select a file"}</CardTitle>
        <CardDescription>settings.readTraefikFile + settings.updateTraefikFile.</CardDescription>
      </CardHeader>
      <CardContent className="flex w-full max-w-full min-w-0 flex-col gap-4">
        {!path ? (
          <Alert>
            <AlertTitle>No file selected</AlertTitle>
            <AlertDescription>Select a path from the left panel to load editable Traefik content.</AlertDescription>
          </Alert>
        ) : null}
        {file.error ? <ErrorCard error={new Error(toErrorMessage(file.error))} /> : null}
        <TextAreaField label="File content" value={content} onChange={setContent} rows={22} placeholder="Select a Traefik file to load its content." />
        {path && file.data !== null && file.data !== undefined ? <JsonBlock value={file.data} /> : null}
        <Button disabled={!path || !content.trim() || saving || file.loading} onClick={() => void save()}>
          <SaveIcon data-icon="inline-start" />
          {saving ? "Saving…" : "Save file"}
        </Button>
      </CardContent>
    </Card>
  )
}

function collectPaths(value: unknown): string[] {
  const out = new Set<string>()
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      if (node.includes("/") || /\.[a-z0-9]+$/i.test(node)) out.add(node)
      return
    }
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!node || typeof node !== "object") return
    const row = node as Row
    const path = idFrom(row, ["path", "filePath", "fullPath", "name"])
    const type = textValue(row, ["type", "kind", "nodeType"], "")
    if (path && (!type || !type.toLowerCase().includes("dir"))) out.add(path)
    Object.values(row).forEach(visit)
  }
  rowsFrom(value).forEach(visit)
  if (!out.size) visit(value)
  return Array.from(out).sort()
}
