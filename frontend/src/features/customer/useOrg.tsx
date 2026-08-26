/* eslint-disable react-refresh/only-export-components */
// Organization context for the customer console: loads the orgs the signed-in
// user belongs to, remembers the selection in localStorage and exposes the
// active org id that every customer-plane request sends as X-Organization-ID.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { apiGet } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export interface Organization {
  id: string
  public_id?: string
  name: string
  slug?: string
  status?: string
  country_code?: string
  legal_name?: string
  tax_id?: string
}

const ORG_KEY = "kilat_org_id"

interface OrgContextValue {
  organizations: Organization[]
  /** Active org id ("" while not resolved yet). */
  orgId: string
  organization: Organization | null
  loading: boolean
  error: unknown
  selectOrg: (id: string) => void
  refresh: () => Promise<void>
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined)

function readStoredOrgId(): string {
  try {
    return localStorage.getItem(ORG_KEY) ?? ""
  } catch {
    return ""
  }
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { token, logout } = useAuth()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [orgId, setOrgId] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const { data } = await apiGet<Organization[]>("/organizations")
      const orgs = data ?? []
      setOrganizations(orgs)
      setError(null)
      const stored = readStoredOrgId()
      const active = orgs.some((org) => org.id === stored) ? stored : (orgs[0]?.id ?? "")
      setOrgId(active)
      if (active) localStorage.setItem(ORG_KEY, active)
    } catch (cause) {
      // An expired/revoked session answers 401 here — drop to login instead of
      // rendering a broken console.
      if (
        cause &&
        typeof cause === "object" &&
        "status" in cause &&
        (cause as { status?: number }).status === 401
      ) {
        logout()
        return
      }
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [token, logout])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const selectOrg = useCallback((id: string) => {
    setOrgId(id)
    try {
      localStorage.setItem(ORG_KEY, id)
    } catch {
      // Storage unavailable; selection stays in memory only.
    }
  }, [])

  const value = useMemo<OrgContextValue>(
    () => ({
      organizations,
      orgId,
      organization: organizations.find((org) => org.id === orgId) ?? null,
      loading,
      error,
      selectOrg,
      refresh: load,
    }),
    [organizations, orgId, loading, error, selectOrg, load],
  )

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

export function useOrg(): OrgContextValue {
  const context = useContext(OrgContext)
  if (!context) {
    throw new Error("useOrg must be used within an OrgProvider")
  }
  return context
}

/** Headers every org-scoped customer request must carry. */
export function orgHeaders(orgId: string): Record<string, string> {
  return orgId ? { "X-Organization-ID": orgId } : {}
}
