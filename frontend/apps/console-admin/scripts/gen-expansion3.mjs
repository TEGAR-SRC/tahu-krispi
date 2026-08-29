// Wave-3 expansion scaffold: 28 additional CRUD routes. Existing files are
// never overwritten. Usage: node scripts/gen-expansion3.mjs
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const PAGES = [
  // ---- Staff self-account suite (mounted under /admin, /noc, /finance) -----
  { file: "features/staff-account/ProfilePage.tsx", route: "/admin/account/profile", title: "My profile", component: "StaffProfilePage" },
  { file: "features/staff-account/SecurityPage.tsx", route: "/admin/account/security", title: "My security", component: "StaffSecurityPage" },
  { file: "features/staff-account/ApiKeysPage.tsx", route: "/admin/account/api-keys", title: "My API keys", component: "StaffApiKeysPage" },
  { file: "features/staff-account/NotificationsPage.tsx", route: "/admin/account/notifications", title: "My notifications", component: "StaffNotificationsPage" },
  // ---- Dokploy upstream CRUD consoles --------------------------------------
  { file: "features/admin/pages/dokploy/manager/ProjectConsole.tsx", route: "/admin/dokploy/manager/project", title: "Dokploy projects", component: "DokployProjectConsole" },
  { file: "features/admin/pages/dokploy/manager/ApplicationConsole.tsx", route: "/admin/dokploy/manager/application", title: "Dokploy applications", component: "DokployApplicationConsole" },
  { file: "features/admin/pages/dokploy/manager/DatabaseConsole.tsx", route: "/admin/dokploy/manager/database", title: "Dokploy databases", component: "DokployDatabaseConsole" },
  { file: "features/admin/pages/dokploy/manager/DomainConsole.tsx", route: "/admin/dokploy/manager/domain", title: "Dokploy domains", component: "DokployDomainConsole" },
  { file: "features/admin/pages/dokploy/manager/DeploymentConsole.tsx", route: "/admin/dokploy/manager/deployment", title: "Dokploy deployments", component: "DokployDeploymentConsole" },
  { file: "features/admin/pages/dokploy/manager/CertificateConsole.tsx", route: "/admin/dokploy/manager/certificate", title: "Dokploy certificates", component: "DokployCertificateConsole" },
  { file: "features/admin/pages/dokploy/manager/RegistryConsole.tsx", route: "/admin/dokploy/manager/registry", title: "Dokploy registries", component: "DokployRegistryConsole" },
  { file: "features/admin/pages/dokploy/manager/ServerConsole.tsx", route: "/admin/dokploy/manager/server", title: "Dokploy servers", component: "DokployServerConsole" },
  { file: "features/admin/pages/dokploy/manager/SshKeyConsole.tsx", route: "/admin/dokploy/manager/sshkey", title: "Dokploy SSH keys", component: "DokploySshKeyConsole" },
  // ---- Customer additions ----------------------------------------------------
  { file: "features/customer/pages/instances/Resize.tsx", route: "/app/instances/:instanceId/resize", title: "Resize instance", component: "InstanceResizePage" },
  { file: "features/customer/pages/MeasuredBoot.tsx", route: "/app/measured-boot", title: "Measured boot images", component: "MeasuredBootPage" },
  { file: "features/customer/pages/network/FirewallGroupDetail.tsx", route: "/app/network/firewall/:firewallId", title: "Firewall group", component: "FirewallGroupDetailPage" },
  { file: "features/customer/pages/network/IpListDetail.tsx", route: "/app/ip-lists/:listId", title: "IP list", component: "IpListDetailPage" },
  { file: "features/customer/pages/WalletTransactions.tsx", route: "/app/wallet/transactions", title: "Wallet transactions", component: "WalletTransactionsPage" },
  // ---- Admin boards ------------------------------------------------------------
  { file: "features/admin/pages/JobsQueueBoard.tsx", route: "/admin/jobs/queue/:queue", title: "Job queue board", component: "JobsQueueBoardPage" },
  { file: "features/admin/pages/InstancesStateBoard.tsx", route: "/admin/instances/state/:state", title: "Instances by state", component: "InstancesStateBoardPage" },
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
        message="This section has not been wired to the API yet."
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
