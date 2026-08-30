import { Routes, Route, Link } from "react-router-dom"
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
    </Routes>
  )
}
