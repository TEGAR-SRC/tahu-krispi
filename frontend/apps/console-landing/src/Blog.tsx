// Public blog page — list of published posts plus a detail view. Data comes
// from the public GET /blog API (managed by staff in console-admin).
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { Spinner } from "./components/ui/spinner"
import { apiGet, resolveMediaUrl } from "./lib/api"
import "highlight.js/styles/github-dark.css"

interface BlogPost {
  id: string
  slug: string
  title: string
  excerpt: string
  cover_image: string
  author_name: string
  content: string
  tags: string[]
  published: boolean
}

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
          <h2 className="mt-8 scroll-mt-6 text-2xl font-semibold tracking-tight">{children}</h2>
        ),
        h3: ({ children }) => <h3 className="mt-6 scroll-mt-6 text-xl font-semibold">{children}</h3>,
        p: ({ children }) => <p className="leading-7 [&:not(:first-child)]:mt-4">{children}</p>,
        ul: ({ children }) => <ul className="my-4 ml-6 list-disc space-y-2">{children}</ul>,
        ol: ({ children }) => <ol className="my-4 ml-6 list-decimal space-y-2">{children}</ol>,
        blockquote: ({ children }) => (
          <blockquote className="my-4 border-l-4 border-primary/40 pl-4 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        pre: ({ children }) => (
          <pre className="my-4 overflow-x-auto rounded-lg border bg-[#0d1117] p-4 text-sm leading-relaxed">
            {children}
          </pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function PostCard({ post }: { post: BlogPost }) {
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group flex w-full max-w-full min-w-0 flex-col gap-3 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      {post.cover_image ? (
        <img
          src={resolveMediaUrl(post.cover_image)}
          alt={post.title}
          className="h-40 w-full rounded-md object-cover"
        />
      ) : null}
      <h3 className="text-lg font-semibold group-hover:text-primary">{post.title}</h3>
      {post.excerpt ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p>
      ) : null}
      <div className="mt-auto flex min-w-0 flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground">
        {post.author_name ? <span>{post.author_name}</span> : null}
        {post.tags?.map((tag) => (
          <span key={tag} className="rounded-full bg-muted px-2 py-0.5">
            {tag}
          </span>
        ))}
      </div>
    </Link>
  )
}

function BlogList() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    apiGet<BlogPost[]>("/blog")
      .then(({ data }) => {
        if (!cancelled) setPosts(data)
      })
      .catch(() => {
        if (!cancelled) setPosts([])
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
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Blog</h1>
      <p className="mb-8 text-muted-foreground">News, guides and updates from Kilat Cloud.</p>
      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  )
}

function BlogDetail() {
  const { slug } = useParams<{ slug: string }>()
  const [post, setPost] = useState<BlogPost | undefined>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!slug) {
      setLoading(false)
      return
    }
    apiGet<BlogPost>(`/blog/${encodeURIComponent(slug)}`)
      .then(({ data }) => {
        if (!cancelled) setPost(data)
      })
      .catch(() => {
        if (!cancelled) setPost(undefined)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (!post) {
    return (
      <div className="mx-auto flex min-h-[40vh] w-full max-w-3xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Post not found</h1>
        <Link to="/blog" className="text-primary underline underline-offset-2">
          Back to blog
        </Link>
      </div>
    )
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link to="/blog" className="text-sm text-muted-foreground hover:text-primary">
        ← Back to blog
      </Link>
      {post.cover_image ? (
        <img
          src={resolveMediaUrl(post.cover_image)}
          alt={post.title}
          className="mt-4 w-full rounded-lg object-cover"
        />
      ) : null}
      <h1 className="mt-6 text-4xl font-bold tracking-tight">{post.title}</h1>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {post.author_name ? <span>{post.author_name}</span> : null}
        {post.tags?.map((tag) => (
          <span key={tag} className="rounded-full bg-muted px-2 py-0.5">
            {tag}
          </span>
        ))}
      </div>
      {post.excerpt ? (
        <p className="mt-4 text-lg text-muted-foreground">{post.excerpt}</p>
      ) : null}
      <div className="mt-8">
        <MarkdownView content={post.content} />
      </div>
    </article>
  )
}

export { BlogList, BlogDetail }
