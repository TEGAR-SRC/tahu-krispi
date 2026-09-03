/* eslint-disable react-refresh/only-export-components */
// Standalone auth console (auth.kilat-cloud.com).
//
// This app only handles identity flows: login, signup, MFA, passkey, OAuth,
// password reset and email verification. It talks to the all-audience API
// (api.kilat-cloud.com) so it can resolve the caller's console role, then hands
// the session off to the correct console via a URL-fragment token handoff that
// reuses each console's existing /oauth/callback page.
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
import { apiGet, apiPost, API_BASE } from "./api"

export const API_ORIGIN = "" // same origin; Vite proxies /api -> backend in dev

export type AppRole = "admin" | "noc" | "finance" | "customer"

// LoginResult discriminates the two outcomes of a password login: either the
// session is ready (role resolved) or a second factor is required and a
// preauth token must be completed with a TOTP code on /auth/login/mfa.
export type LoginResult =
  | { mfaRequired: false; role: AppRole }
  | { mfaRequired: true; preauthToken: string; role: null }

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
  login: (email: string, password: string) => Promise<LoginResult>
  loginMFA: (preauthToken: string, code: string) => Promise<AppRole>
  register: (payload: RegisterPayload) => Promise<LoginResult>
  logout: () => void
}

export function decodeJwtPayload(_token: string): AuthClaims | null {
  return null
}

/** Console origin for a given role (drives the post-auth handoff). */
export function consoleUrlFor(role: AppRole | null): string {
  switch (role) {
    case "admin":
    case "noc":
    case "finance":
      return import.meta.env.VITE_ADMIN_CONSOLE_URL || "https://admin.kilat-cloud.com"
    case "customer":
      return import.meta.env.VITE_CUSTOMER_CONSOLE_URL || "https://console.kilat-cloud.com"
    default:
      return "/login"
  }
}

export function homePathFor(role: AppRole | null): string {
  switch (role) {
    case "admin":
      return "/admin"
    case "noc":
      return "/noc"
    case "finance":
      return "/finance"
    case "customer":
      return "/login"
    default:
      return "/login"
  }
}

async function probe(path: string): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(`${API_ORIGIN}${API_BASE}${path}`, {
      credentials: "include",
    })
    const body = await response.text().catch(() => "")
    return { status: response.status, body }
  } catch {
    return { status: 0, body: "" }
  }
}

function isAuthFailure(status: number, _body: string): boolean {
  return status === 401
}

export async function resolveRole(): Promise<AppRole> {
  const attempts: Array<{ path: string; role: AppRole }> = [
    { path: "/admin/audit-logs?limit=1", role: "admin" },
    { path: "/admin/finance/summary?days=1", role: "finance" },
    { path: "/admin/providers", role: "noc" },
  ]
  let sawAuthError = false
  for (const attempt of attempts) {
    const { status, body } = await probe(attempt.path)
    if (status >= 200 && status < 300) return attempt.role
    if (isAuthFailure(status, body)) sawAuthError = true
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

function readSession(): SessionState {
  return { token: null, claims: null, role: readCachedRole(), profile: readCachedProfile() }
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

interface LoginResponse {
  access_token: string
  mfa_required?: boolean
  preauth_token?: string
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialSession] = useState(readSession)
  const [token, setTokenState] = useState<string | null>(initialSession.token)
  const [claims, setClaims] = useState<AuthClaims | null>(initialSession.claims)
  const [role, setRole] = useState<AppRole | null>(initialSession.role)
  const [profile, setProfile] = useState<MeProfile | null>(initialSession.profile)
  // Always validate session on mount; this catches stale localStorage and
  // completes the handoff code exchange cookie before any RequireRole redirect.
  const [loading, setLoading] = useState(true)

  const adoptSession = useCallback(async (): Promise<AppRole> => {
    const resolved = await resolveRole()
    const me = await apiGet<MeProfile>("/me")
      .then((envelope) => envelope.data)
      .catch(() => null)
    setTokenState("cookie")
    setClaims({})
    setRole(resolved)
    setProfile(me)
    persistSession({ token: "cookie", claims: {}, role: resolved, profile: me })
    return resolved
  }, [])

  // If any role/profile cached, re-validate via cookie session on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const fetched = await apiGet<MeProfile>("/me").then((e) => e.data).catch(() => null)
        if (cancelled) return
        if (!fetched) {
          clearPersistedSession()
          setRole(null)
          setProfile(null)
          setLoading(false)
          return
        }
        const resolved = await resolveRole()
        if (cancelled) return
        setTokenState("cookie")
        setClaims({})
        setRole(resolved)
        setProfile(fetched)
        persistSession({ token: "cookie", claims: {}, role: resolved, profile: fetched })
      } catch {
        if (!cancelled) {
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
    async (email: string, password: string): Promise<LoginResult> => {
      setLoading(true)
      try {
        const { data } = await apiPost<LoginResponse>("/auth/login", { email, password })
        if (data.mfa_required && data.preauth_token) {
          return { mfaRequired: true, preauthToken: data.preauth_token, role: null }
        }
        const role = await adoptSession()
        return { mfaRequired: false, role }
      } finally {
        setLoading(false)
      }
    },
    [adoptSession],
  )

  const loginMFA = useCallback(
    async (preauthToken: string, code: string): Promise<AppRole> => {
      setLoading(true)
      try {
        await apiPost<LoginResponse>("/auth/login/mfa", {
          preauth_token: preauthToken,
          code,
        })
        return await adoptSession()
      } finally {
        setLoading(false)
      }
    },
    [adoptSession],
  )

  const register = useCallback(
    async (payload: RegisterPayload): Promise<LoginResult> => {
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
    // best-effort server revoke; cookie cleared server-side
    apiPost("/auth/logout").catch(() => {})
    setTokenState(null)
    setClaims(null)
    setRole(null)
    setProfile(null)
    clearPersistedSession()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ token, claims, role, profile, loading, login, loginMFA, register, logout }),
    [token, claims, role, profile, loading, login, loginMFA, register, logout],
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
