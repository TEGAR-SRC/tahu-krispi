import { apiGet } from "../lib/api"

export interface DocEntry {
  id: string
  slug: string
  title: string
  description: string
  content: string
  sort_order: number
  published: boolean
}

// Public docs come from the backend (/v1/docs), not bundled files.
export async function fetchDocs(): Promise<DocEntry[]> {
  const { data } = await apiGet<DocEntry[]>("/docs")
  return data
}

export async function fetchDoc(slug: string): Promise<DocEntry | undefined> {
  const { data } = await apiGet<DocEntry>(`/docs/${encodeURIComponent(slug)}`)
  return data
}
