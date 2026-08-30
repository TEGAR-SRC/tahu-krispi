import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/lib/auth"

// ---- Lazy pages: auth --------------------------------------------------------
const LoginPage = lazy(() => import("@/features/auth/LoginPage"))
const SignupPage = lazy(() => import("@/features/auth/SignupPage"))
const ForgotPasswordPage = lazy(() =>
  import("@/features/auth/ForgotPasswordPage"),
)
const ResetPasswordPage = lazy(() =>
  import("@/features/auth/ResetPasswordPage"),
)
const VerifyEmailPage = lazy(() => import("@/features/auth/VerifyEmailPage"))
const OAuthCallbackPage = lazy(() =>
  import("@/features/auth/OAuthCallbackPage"),
)
const HandoffPage = lazy(() => import("@/features/auth/HandoffPage"))
const TermsPage = lazy(() => import("@/features/auth/TermsPage"))
const PrivacyPage = lazy(() => import("@/features/auth/PrivacyPage"))

function LoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Spinner className="size-6" />
    </div>
  )
}

// A signed-in user landing on any page is bounced to the handoff, which sends
// them to their console. Otherwise the root redirects to /login.
function RootRedirect() {
  const { token, role, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (token && role) return <Navigate to="/handoff" replace />
  return <Navigate to="/login" replace />
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/handoff" element={<HandoffPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  )
}
