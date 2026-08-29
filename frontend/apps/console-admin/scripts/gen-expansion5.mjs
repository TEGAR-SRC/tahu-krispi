// Wave-4 expansion scaffold: Dokploy parity section (42 routes) built from
// docs/dokploy-parity.md. Existing files are never overwritten.
// Usage: node scripts/gen-expansion5.mjs
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const APP = "features/admin/pages/dokploy/app"

const PAGES = [
  // ---- Top-level dashboard ----
  { file: `${APP}/Home.tsx`, route: "/admin/dokploy/app/home", title: "Dokploy home", component: "DokployHomePage" },
  { file: `${APP}/Projects.tsx`, route: "/admin/dokploy/app/projects", title: "Projects", component: "DokployProjectsPage" },
  { file: `${APP}/EnvironmentBoard.tsx`, route: "/admin/dokploy/app/p/:projectId/e/:environmentId", title: "Environment services", component: "DokployEnvironmentBoardPage" },
  { file: `${APP}/Overview.tsx`, route: "/admin/dokploy/app/overview", title: "Overview", component: "DokployOverviewPage" },
  { file: `${APP}/Docker.tsx`, route: "/admin/dokploy/app/docker", title: "Docker", component: "DokployDockerPage" },
  { file: `${APP}/Monitoring.tsx`, route: "/admin/dokploy/app/monitoring", title: "Monitoring", component: "DokployMonitoringPage" },
  { file: `${APP}/Requests.tsx`, route: "/admin/dokploy/app/requests", title: "Requests", component: "DokployRequestsPage" },
  { file: `${APP}/Schedules.tsx`, route: "/admin/dokploy/app/schedules", title: "Schedules", component: "DokploySchedulesPage" },
  { file: `${APP}/Traefik.tsx`, route: "/admin/dokploy/app/traefik", title: "Traefik files", component: "DokployTraefikPage" },
  // ---- Service detail pages (one per kind) ----
  { file: `${APP}/services/ApplicationService.tsx`, route: "/admin/dokploy/app/p/:projectId/e/:environmentId/services/application/:applicationId", title: "Application", component: "DokployApplicationServicePage" },
  { file: `${APP}/services/ComposeService.tsx`, route: "/admin/dokploy/app/p/:projectId/e/:environmentId/services/compose/:composeId", title: "Compose", component: "DokployComposeServicePage" },
  { file: `${APP}/services/PostgresService.tsx`, route: "/admin/dokploy/app/p/:projectId/e/:environmentId/services/postgres/:serviceId", title: "Postgres", component: "DokployPostgresServicePage" },
  { file: `${APP}/services/MysqlService.tsx`, route: "/admin/dokploy/app/p/:projectId/e/:environmentId/services/mysql/:serviceId", title: "MySQL", component: "DokployMysqlServicePage" },
  { file: `${APP}/services/MariadbService.tsx`, route: "/admin/dokploy/app/p/:projectId/e/:environmentId/services/mariadb/:serviceId", title: "MariaDB", component: "DokployMariadbServicePage" },
  { file: `${APP}/services/MongoService.tsx`, route: "/admin/dokploy/app/p/:projectId/e/:environmentId/services/mongo/:serviceId", title: "Mongo", component: "DokployMongoServicePage" },
  { file: `${APP}/services/RedisService.tsx`, route: "/admin/dokploy/app/p/:projectId/e/:environmentId/services/redis/:serviceId", title: "Redis", component: "DokployRedisServicePage" },
  { file: `${APP}/services/LibsqlService.tsx`, route: "/admin/dokploy/app/p/:projectId/e/:environmentId/services/libsql/:serviceId", title: "Libsql", component: "DokployLibsqlServicePage" },
  // ---- Settings pages ----
  { file: `${APP}/settings/Profile.tsx`, route: "/admin/dokploy/app/settings/profile", title: "Profile (Dokploy)", component: "DokploySettingsProfilePage" },
  { file: `${APP}/settings/Users.tsx`, route: "/admin/dokploy/app/settings/users", title: "Users (Dokploy)", component: "DokploySettingsUsersPage" },
  { file: `${APP}/settings/Sessions.tsx`, route: "/admin/dokploy/app/settings/sessions", title: "Sessions (Dokploy)", component: "DokploySettingsSessionsPage" },
  { file: `${APP}/settings/SshKeys.tsx`, route: "/admin/dokploy/app/settings/ssh-keys", title: "SSH keys (Dokploy)", component: "DokploySettingsSshKeysPage" },
  { file: `${APP}/settings/GitProviders.tsx`, route: "/admin/dokploy/app/settings/git-providers", title: "Git providers (Dokploy)", component: "DokploySettingsGitProvidersPage" },
  { file: `${APP}/settings/Notifications.tsx`, route: "/admin/dokploy/app/settings/notifications", title: "Notifications (Dokploy)", component: "DokploySettingsNotificationsPage" },
  { file: `${APP}/settings/Destinations.tsx`, route: "/admin/dokploy/app/settings/destinations", title: "Destinations (Dokploy)", component: "DokploySettingsDestinationsPage" },
  { file: `${APP}/settings/Certificates.tsx`, route: "/admin/dokploy/app/settings/certificates", title: "Certificates (Dokploy)", component: "DokploySettingsCertificatesPage" },
  { file: `${APP}/settings/Tags.tsx`, route: "/admin/dokploy/app/settings/tags", title: "Tags (Dokploy)", component: "DokploySettingsTagsPage" },
  { file: `${APP}/settings/ServerLocal.tsx`, route: "/admin/dokploy/app/settings/server", title: "Web server (Dokploy)", component: "DokploySettingsServerLocalPage" },
  { file: `${APP}/settings/Servers.tsx`, route: "/admin/dokploy/app/settings/servers", title: "Servers (Dokploy)", component: "DokploySettingsServersPage" },
  { file: `${APP}/settings/DeploymentsCfg.tsx`, route: "/admin/dokploy/app/settings/deployments", title: "Builds concurrency (Dokploy)", component: "DokploySettingsDeploymentsPage" },
  { file: `${APP}/settings/Secrets.tsx`, route: "/admin/dokploy/app/settings/secrets", title: "Secrets / Vault (Dokploy)", component: "DokploySettingsSecretsPage" },
  { file: `${APP}/settings/Dns.tsx`, route: "/admin/dokploy/app/settings/dns", title: "DNS providers (Dokploy)", component: "DokploySettingsDnsPage" },
  { file: `${APP}/settings/AuditLogs.tsx`, route: "/admin/dokploy/app/settings/audit-logs", title: "Audit logs (Dokploy)", component: "DokploySettingsAuditLogsPage" },
  { file: `${APP}/settings/Ai.tsx`, route: "/admin/dokploy/app/settings/ai", title: "AI providers (Dokploy)", component: "DokploySettingsAiPage" },
  // ---- Cloud-only info cards ----
  { file: `${APP}/CloudOnly.tsx`, route: "/admin/dokploy/app/cloud/billing", title: "Billing — Dokploy Cloud only", component: "DokployCloudOnlyPage" },
  // ---- Console auth parity pages ----
  { file: "features/auth/ForgotPasswordPage.tsx", route: "/forgot-password", title: "Forgot password", component: "ForgotPasswordPage" },
  { file: "features/auth/ResetPasswordPage.tsx", route: "/reset-password", title: "Reset password", component: "ResetPasswordPage" },
  { file: "features/auth/VerifyEmailPage.tsx", route: "/verify-email", title: "Verify email", component: "VerifyEmailPage" },
]

let created = 0
for (const spec of PAGES) {
  const abs = join(root, "src", spec.file)
  if (existsSync(abs)) continue
  const params = [...spec.route.matchAll(/:(\w+)/g)].map((m) => m[1])
  const paramLines = params.map((p) => `  const ${p} = useParams().${p}`).join("\n")
  const paramRender =
    params.length > 0
      ? `\n      <p className="text-sm text-muted-foreground">Route parameter${params.length > 1 ? "s" : ""}: ${params.map((p) => `{${p}}`).join(", ")}</p>`
      : ""
  const importLine = params.length > 0 ? `import { useParams } from "react-router-dom"\n` : ""
  const content = `${importLine}import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function ${spec.component}() {
${paramLines}
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="${spec.title}" />
      <EmptyState
        message="This page has not been wired to the upstream API yet."
        description="Implementation pending for route ${spec.route}."/>${paramRender}
    </div>
  )
}
`
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  created++
}
console.log(`created=${created}`)
