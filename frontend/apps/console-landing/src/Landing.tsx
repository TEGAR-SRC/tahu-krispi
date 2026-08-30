// Public marketing landing page — a standalone project. Renders published
// sections from the public GET /landing endpoint. Content is managed by
// staff (admin/NOC) in the console-admin app under Landing Content.
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Spinner } from "./components/ui/spinner"
import { apiGet, resolveMediaUrl } from "./lib/api"

interface LandingSection {
  id: string
  section_key: string
  title: string
  subtitle: string
  body: string
  media_url: string
  data: Record<string, unknown>
  sort_order: number
  published: boolean
}

function ListItems({ data }: { data: Record<string, unknown> }) {
  const items = Array.isArray(data.items) ? (data.items as unknown[]) : []
  if (items.length === 0) return null
  return (
    <ul className="mt-6 grid gap-3 text-left sm:grid-cols-2">
      {items.map((raw, index) => {
        const item = (typeof raw === "string" ? { text: raw } : raw ?? {}) as Record<string, unknown>
        const text = String(item.text ?? item.title ?? item.label ?? item)
        const desc = item.description ? String(item.description) : ""
        return (
          <li key={index} className="flex flex-col gap-1 rounded-lg border p-4">
            <span className="font-medium">{text}</span>
            {desc ? <span className="text-sm text-muted-foreground">{desc}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

function renderSection(section: LandingSection) {
  switch (section.section_key) {
    case "hero":
      return (
        <section className="w-full border-b bg-gradient-to-b from-primary/5 via-background to-background py-20 text-center sm:py-28">
          <div className="flex w-full flex-col items-center gap-4 px-6">
            {section.media_url ? (
              <img
                src={resolveMediaUrl(section.media_url)}
                alt=""
                className="mb-2 h-12 w-12 object-contain"
              />
            ) : null}
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{section.title}</h1>
            {section.subtitle ? (
              <p className="max-w-2xl text-lg text-muted-foreground">{section.subtitle}</p>
            ) : null}
            {section.body ? <p className="max-w-2xl text-muted-foreground">{section.body}</p> : null}
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <a
                href="https://auth.kilat-cloud.com/signup"
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Get started
              </a>
              <a
                href="https://auth.kilat-cloud.com/login"
                className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-6 text-sm font-medium hover:bg-accent"
              >
                Sign in
              </a>
            </div>
          </div>
        </section>
      )
    case "features":
      return (
        <section className="border-b py-14">
          <div className="mx-auto w-full max-w-5xl">
            <h2 className="text-center text-3xl font-semibold">{section.title}</h2>
            {section.subtitle ? (
              <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground">{section.subtitle}</p>
            ) : null}
            <ListItems data={section.data} />
            {section.body ? <p className="mt-6 text-center text-muted-foreground">{section.body}</p> : null}
          </div>
        </section>
      )
    case "pricing":
      return (
        <section className="border-b py-14">
          <div className="mx-auto w-full max-w-5xl">
            <h2 className="text-center text-3xl font-semibold">{section.title}</h2>
            {section.subtitle ? (
              <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground">{section.subtitle}</p>
            ) : null}
            <div className="mt-8 flex justify-center">
              <ListItems data={section.data} />
            </div>
          </div>
        </section>
      )
    case "testimonials":
      return (
        <section className="border-b py-14">
          <div className="mx-auto w-full max-w-5xl">
            <h2 className="text-center text-3xl font-semibold">{section.title}</h2>
            <ListItems data={section.data} />
          </div>
        </section>
      )
    case "faq":
      return (
        <section className="border-b py-14">
          <div className="mx-auto w-full max-w-3xl">
            <h2 className="text-center text-3xl font-semibold">{section.title}</h2>
            <div className="mt-8 space-y-3">
              {(Array.isArray(section.data.items) ? section.data.items : []).map((raw, index) => {
                const item = (typeof raw === "string" ? { text: raw } : raw ?? {}) as Record<string, unknown>
                return (
                  <details key={index} className="rounded-lg border p-4">
                    <summary className="cursor-pointer font-medium">{String(item.text ?? item.q ?? item.title ?? item)}</summary>
                    {item.a || item.answer || item.description ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {String(item.a ?? item.answer ?? item.description)}
                      </p>
                    ) : null}
                  </details>
                )
              })}
            </div>
          </div>
        </section>
      )
    case "banner":
      return (
        <section className="border-b py-8 text-center">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          {section.body ? <p className="mt-1 text-muted-foreground">{section.body}</p> : null}
        </section>
      )
    case "blog":
    default:
      return (
        <section className="border-b py-14">
          <div className="mx-auto w-full max-w-5xl">
            <h2 className="text-3xl font-semibold">{section.title}</h2>
            {section.subtitle ? <p className="mt-2 text-muted-foreground">{section.subtitle}</p> : null}
            {section.body ? <p className="mt-4 text-muted-foreground">{section.body}</p> : null}
            <ListItems data={section.data} />
          </div>
        </section>
      )
  }
}

export default function LandingPage() {
  const [sections, setSections] = useState<LandingSection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    apiGet<LandingSection[]>("/landing")
      .then(({ data }) => {
        if (!cancelled) setSections(data)
      })
      .catch(() => {
        if (!cancelled) setSections([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  const ordered = [...sections].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="min-h-svh w-full bg-background">
      <header className="flex w-full items-center justify-between border-b px-6 py-4">
        <span className="text-lg font-semibold">Kilat Cloud</span>
        <div className="flex items-center gap-4">
          <Link to="/blog" className="text-sm font-medium text-muted-foreground hover:text-primary">
            Blog
          </Link>
          <div className="flex items-center gap-2">
            <a
              href="https://auth.kilat-cloud.com/login"
              className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium hover:bg-accent"
            >
              Sign in
            </a>
            <a
              href="https://auth.kilat-cloud.com/signup"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Get started
            </a>
          </div>
        </div>
      </header>
      {ordered.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-32 text-center">
          <h1 className="text-4xl font-bold">Kilat Cloud</h1>
          <p className="text-muted-foreground">Cloud infrastructure for everyone.</p>
          <a
            href="https://auth.kilat-cloud.com/signup"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Get started
          </a>
        </div>
      ) : (
        ordered.map((section) => <div key={section.id}>{renderSection(section)}</div>)
      )}
      <footer className="border-t px-6 py-3 text-center text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} Kilat Cloud
      </footer>
    </div>
  )
}
