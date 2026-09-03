import { useEffect, useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { Link, useLocation, useParams, Routes, Route, Navigate } from "react-router-dom"
import { FileTextIcon, SearchIcon, BookOpenIcon, MenuIcon } from "lucide-react"
import { fetchDoc, fetchDocs, type DocEntry } from "./docs"
import "highlight.js/styles/github-dark.css"

function MarkdownView({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {children}
          </a>
        ),
        h1: ({ children }) => (
          <h1 className="mt-0 border-b pb-2 text-3xl font-bold tracking-tight">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mt-10 scroll-mt-6 text-2xl font-semibold tracking-tight">{children}</h2>
        ),
        h3: ({ children }) => <h3 className="mt-8 scroll-mt-6 text-xl font-semibold">{children}</h3>,
        p: ({ children }) => <p className="leading-7 [&:not(:first-child)]:mt-4">{children}</p>,
        ul: ({ children }) => <ul className="my-4 ml-6 list-disc space-y-2">{children}</ul>,
        ol: ({ children }) => <ol className="my-4 ml-6 list-decimal space-y-2">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="my-4 border-l-4 border-primary/40 pl-4 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="my-6 w-full overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border-b px-3 py-2 text-left font-medium">{children}</th>,
        td: ({ children }) => <td className="border-b px-3 py-2">{children}</td>,
        pre: ({ children }) => (
          <pre className="my-4 overflow-x-auto rounded-lg border bg-[#0d1117] p-4 text-sm leading-relaxed">
            {children}
          </pre>
        ),
        hr: () => <hr className="my-8 border-border" />,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function Sidebar({
  docs,
  query,
  onQueryChange,
  onCloseMobile,
}: {
  docs: DocEntry[]
  query: string
  onQueryChange: (value: string) => void
  onCloseMobile?: () => void
}) {
  const { slug } = useParams<{ slug: string }>()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return docs
    return docs.filter(
      (doc) =>
        doc.title.toLowerCase().includes(q) ||
        doc.description.toLowerCase().includes(q) ||
        doc.content.toLowerCase().includes(q),
    )
  }, [docs, query])

  return (
    <aside className="flex h-full w-full flex-col gap-4 border-r bg-muted/20 p-4">
      <div className="flex items-center gap-2 px-1">
        <BookOpenIcon className="size-5" />
        <span className="font-semibold">Kilat Docs</span>
      </div>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search docs…"
          className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <nav className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto">
        {filtered.map((doc) => (
          <Link
            key={doc.id}
            to={`/docs/${doc.slug}`}
            onClick={onCloseMobile}
            className={`flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-sm ${
              slug === doc.slug
                ? "bg-primary/10 font-medium text-primary"
                : "text-foreground hover:bg-accent"
            }`}
          >
            <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{doc.title}</span>
          </Link>
        ))}
        {filtered.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">No docs match "{query}".</p>
        ) : null}
      </nav>
      <div className="border-t pt-3 text-xs text-muted-foreground">{docs.length} documents</div>
    </aside>
  )
}

function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-semibold tracking-tight">404</p>
      <p className="text-muted-foreground">The page you are looking for does not exist.</p>
      <Link to="/docs" className="text-sm text-primary underline underline-offset-4">
        Back to docs
      </Link>
    </div>
  )
}

function EmptyDocs({ loaded }: { loaded: boolean }) {
  if (!loaded) return <div className="px-6 py-16 text-center text-muted-foreground">Loading…</div>
  return (
    <div className="px-6 py-16 text-center text-muted-foreground">
      <p className="text-lg font-medium">No documents yet</p>
      <p className="mt-1 text-sm">Docs will appear here once published.</p>
    </div>
  )
}

function DocPage() {
  const { slug } = useParams<{ slug: string }>()
  const [doc, setDoc] = useState<DocEntry | undefined>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    if (!slug) {
      setLoading(false)
      return
    }
    fetchDoc(slug)
      .then((data) => {
        if (!cancelled) setDoc(data)
      })
      .catch(() => {
        if (!cancelled) setDoc(undefined)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (loading) {
    return <div className="px-6 py-16 text-center text-muted-foreground">Loading…</div>
  }
  if (!doc)
    return (
      <div className="px-6 py-16 text-center text-muted-foreground">
        <p>Document not found.</p>
        <Link to="/docs" className="mt-2 inline-block text-sm text-primary underline underline-offset-4">
          Back to docs
        </Link>
      </div>
    )
  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8">
        <p className="text-sm text-muted-foreground">{doc.description}</p>
      </div>
      <MarkdownView content={doc.content} />
    </article>
  )
}

function DocsLayout({
  docs,
  loaded,
  query,
  onQueryChange,
}: {
  docs: DocEntry[]
  loaded: boolean
  query: string
  onQueryChange: (v: string) => void
}) {
  const [mobileNav, setMobileNav] = useState(false)
  const location = useLocation()
  useEffect(() => {
    setMobileNav(false)
    onQueryChange("")
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex min-h-svh w-full bg-background">
      <div className="hidden w-64 shrink-0 md:block">
        <Sidebar docs={docs} query={query} onQueryChange={onQueryChange} />
      </div>
      {mobileNav ? (
        <div className="fixed inset-0 z-50 flex bg-background/95 backdrop-blur-sm md:hidden">
          <Sidebar
            docs={docs}
            query={query}
            onQueryChange={onQueryChange}
            onCloseMobile={() => setMobileNav(false)}
          />
          <button
            onClick={() => setMobileNav(false)}
            className="absolute right-3 top-3 rounded p-2 text-muted-foreground hover:bg-accent"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-3 md:hidden">
          <button
            onClick={() => setMobileNav(true)}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent"
            aria-label="Open menu"
          >
            <MenuIcon className="size-5" />
          </button>
          <span className="font-semibold">Kilat Docs</span>
        </header>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/docs/:slug" element={<DocPage />} />
            <Route path="/docs" element={loaded && docs.length === 0 ? <EmptyDocs loaded={loaded} /> : <Navigate to={docs.length ? `/docs/${[...docs].sort((a, b) => a.sort_order - b.sort_order)[0].slug}` : "/docs"} replace />} />
            <Route path="/" element={<Navigate to="/docs" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState("")
  useEffect(() => {
    let cancelled = false
    fetchDocs()
      .then((data) => {
        if (!cancelled) setDocs(data)
      })
      .catch(() => {
        if (!cancelled) setDocs([])
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return <DocsLayout docs={docs} loaded={loaded} query={query} onQueryChange={setQuery} />
}
