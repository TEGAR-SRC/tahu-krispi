import welcome from "./welcome.md?raw"
import api from "./api.md?raw"
import deployment from "./deployment.md?raw"

export interface DocEntry {
  slug: string
  title: string
  description: string
  content: string
}

export const docs: DocEntry[] = [
  {
    slug: "welcome",
    title: "Welcome",
    description: "Overview and quick start for Kilat Cloud.",
    content: welcome,
  },
  {
    slug: "api",
    title: "API Reference",
    description: "Public API endpoints and request/response shapes.",
    content: api,
  },
  {
    slug: "deployment",
    title: "Deployment Guide",
    description: "Build and deploy each frontend project.",
    content: deployment,
  },
]

export function getDoc(slug: string): DocEntry | undefined {
  return docs.find((doc) => doc.slug === slug)
}
