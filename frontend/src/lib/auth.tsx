/* eslint-disable react-refresh/only-export-components */
// Client-side authentication: JWT storage, capability-based role detection
// and the AuthProvider context consumed by pages via useAuth().
//
// The backend access token carries only sub/sid/scopes — no role claims — so
// the effective console role is detected by probing staff-only endpoints
// (verified against backend RBAC): audit-logs => platform admin,
// finance summary => finance, providers => NOC, otherwise customer.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { apiGet, apiPost, getToken, setToken, API_BASE } from "./api"

export const API_ORIGIN = "" // same origin; Vite proxies /api -> backend in dev

export type AppRole = "admin" | "noc" | "finance" | "customer"

export interface MeProfile {
  user_id: string
  email: string
  phone?: string
  username?: string
  status?: string
  locale?: string
  timezone?: string
  full_name?: string
  display_name?: string
  company_name?: string
  country_code?: string
  tax_id?: string
  avatar_object_id?: string
  [key: string]: unknown
}

/** Raw JWT payload — informational only (sub/sid/scopes/exp). */
export interface AuthClaims {
  sub?: string
  sid?: string
  typ?: string
  scopes?: string[]
  exp?: number
  [key: string]: unknown
}

export interface RegisterPayload {
  email: string
  password: string
  full_name: string
  terms_accepted: true
  privacy_accepted: true
}

interface SessionState {
  token: string | null
  claims: AuthClaims | null
  role: AppRole | null
  profile: MeProfile | null
}

export interface AuthContextValue extends SessionState {
  loading: boolean
  login: (email: string, password: string) => Promise<AppRole>
  register: (payload: RegisterPayload) => Promise<AppRole>
  logout: () => void
}

/** Decodes the base64url JWT payload without verifying the signature. */
export function decodeJwtPayload(token: string): AuthClaims | null {
  try {
    const segment = token.split(".")[1]
    if (!segment) return null
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as AuthClaims
  } catch {
    return null
  }
}

/** Where a user with this role should land after login. */
export function homePathFor(role: AppRole | null): string {
  switch (role) {
    case "admin":
      return "/admin"
    case "noc":
      return "/noc"
    case "finance":
      return "/finance"
    case "customer":
      return "/app"
    default:
      return "/login"
  }
}

async function probe(path: string, token: string): Promise<number> {
  const response = await fetch(`${API_ORIGIN}${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.status
}

/**
 * Detects the effective console role by probing staff-only endpoints in
 * most-exclusive-first order. Throws when the token is already expired
 * (every probe answered 401).
 */
export async function resolveRole(token: string): Promise<AppRole> {
  const attempts: Array<{ path: string; role: AppRole }> = [
    { path: "/admin/audit-logs?limit=1", role: "admin" },
    { path: "/admin/finance/summary?days=1", role: "finance" },
    { path: "/admin/providers", role: "noc" },
  ]
  let sawAuthError = false
  for (const attempt of attempts) {
    const status = await probe(attempt.path, token)
    if (status >= 200 && status < 300) return attempt.role
    if (status === 401) sawAuthError = true
  }
  if (sawAuthError) throw new Error("Session expired")
  return "customer"
}

const ROLE_KEY = "kilat_role"
const PROFILE_KEY = "kilat_profile"

function readCachedRole(): AppRole | null {
  const stored = localStorage.getItem(ROLE_KEY)
  return stored === "admin" || stored === "noc" || stored === "finance" || stored === "customer"
    ? stored
    : null
}

function readCachedProfile(): MeProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? (JSON.parse(raw) as MeProfile) : null
  } catch {
    return null
  }
}

function persistSession(state: SessionState): void {
  if (state.role) localStorage.setItem(ROLE_KEY, state.role)
  else localStorage.removeItem(ROLE_KEY)
  if (state.profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile))
  else localStorage.removeItem(PROFILE_KEY)
}

function clearPersistedSession(): void {
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(PROFILE_KEY)
}

/**
 * Reads the persisted session synchronously; a corrupted token is dropped so
 * callers start unauthenticated rather than crashing on decode.
 */
function readSession(): SessionState {
  const stored = getToken()
  if (!stored) return { token: null, claims: null, role: null, profile: null }
  const decoded = decodeJwtPayload(stored)
  if (!decoded) {
    setToken(null)
    clearPersistedSession()
    return { token: null, claims: null, role: null, profile: null }
  }
  return {
    token: stored,
    claims: decoded,
    role: readCachedRole(),
    profile: readCachedProfile(),
  }
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

interface LoginResponse {
  access_token: string
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialSession] = useState(readSession)
  const [token, setTokenState] = useState<string | null>(initialSession.token)
  const [claims, setClaims] = useState<AuthClaims | null>(initialSession.claims)
  const [role, setRole] = useState<AppRole | null>(initialSession.role)
  const [profile, setProfile] = useState<MeProfile | null>(initialSession.profile)
  // True while a persisted token is being re-validated on first mount, or an
  // in-flight login/register is resolving the role.
  const [loading, setLoading] = useState(() => Boolean(initialSession.token))

  const adoptSession = useCallback(async (accessToken: string): Promise<AppRole> => {
    const decoded = decodeJwtPayload(accessToken)
    if (!decoded) throw new Error("Login response contained an unreadable token")
    setToken(accessToken)
    setTokenState(accessToken)
    setClaims(decoded)
    const resolved = await resolveRole(accessToken)
    const me = await apiGet<MeProfile>("/me")
      .then((envelope) => envelope.data)
      .catch(() => null)
    setRole(resolved)
    setProfile(me)
    persistSession({ token: accessToken, claims: decoded, role: resolved, profile: me })
    return resolved
  }, [])

  // Re-validate any persisted session once on mount (handles revoked or
  // expired tokens from a previous tab session).
  useEffect(() => {
    // Capture into a local const so TypeScript keeps the token narrowed as a
    // string for every later use inside the effect.
    const storedToken = initialSession.token
    if (!storedToken) return
    let cancelled = false
    ;(async () => {
      try {
        const resolved = await resolveRole(storedToken)
        if (cancelled) return
        setRole(resolved)
        const me = await apiGet<MeProfile>("/me")
          .then((envelope) => envelope.data)
          .catch(() => null)
        if (cancelled) return
        setProfile(me)
        persistSession({ ...initialSession, role: resolved, profile: me })
      } catch {
        if (!cancelled) {
          setToken(null)
          setTokenState(null)
          setClaims(null)
          setRole(null)
          setProfile(null)
          clearPersistedSession()
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = useCallback(
    async (email: string, password: string): Promise<AppRole> => {
      setLoading(true)
      try {
        const { data } = await apiPost<LoginResponse>("/auth/login", { email, password })
        return await adoptSession(data.access_token)
      } finally {
        setLoading(false)
      }
    },
    [adoptSession],
  )

  const register = useCallback(
    async (payload: RegisterPayload): Promise<AppRole> => {
      setLoading(true)
      try {
        await apiPost<unknown>("/auth/register", payload)
        return await login(payload.email, payload.password)
      } finally {
        setLoading(false)
      }
    },
    [login],
  )

  const logout = useCallback(() => {
    setToken(null)
    setTokenState(null)
    setClaims(null)
    setRole(null)
    setProfile(null)
    setToken(null)
    clearPersistedSession()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ token, claims, role, profile, loading, login, register, logout }),
    [token, claims, role, profile, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
