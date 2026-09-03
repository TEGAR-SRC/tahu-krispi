import { Routes, Route, Link, Navigate } from "react-router-dom"
import LandingPage from "./Landing"
import { BlogList, BlogDetail } from "./Blog"

function BlogHeader() {
  return (
    <header className="flex w-full items-center justify-between border-b px-6 py-4">
      <Link to="/" className="text-lg font-semibold">
        Kilat Cloud
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link to="/" className="text-muted-foreground hover:text-primary">
          Home
        </Link>
        <Link to="/blog" className="font-medium text-primary">
          Blog
        </Link>
      </nav>
    </header>
  )
}

function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-semibold tracking-tight">404</p>
      <p className="text-muted-foreground">The page you are looking for does not exist.</p>
      <Link to="/" className="text-sm text-primary underline underline-offset-4">
        Back to home
      </Link>
    </div>
  )
}

function DocsRedirect() {
  if (typeof window !== "undefined") {
    window.location.replace("https://docs.kilat-cloud.com" + window.location.pathname)
    return null
  }
  return <Navigate to="/" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/blog"
        element={
          <div className="min-h-svh w-full bg-background">
            <BlogHeader />
            <BlogList />
            <footer className="border-t px-6 py-3 text-center text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Kilat Cloud
            </footer>
          </div>
        }
      />
      <Route
        path="/blog/:slug"
        element={
          <div className="min-h-svh w-full bg-background">
            <BlogHeader />
            <BlogDetail />
            <footer className="border-t px-6 py-3 text-center text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Kilat Cloud
            </footer>
          </div>
        }
      />
      <Route path="/docs" element={<DocsRedirect />} />
      <Route path="/docs/*" element={<DocsRedirect />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
