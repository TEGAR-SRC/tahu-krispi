# Dokploy ↔ Console Parity Manifest

Baseline: local Dokploy CE checkout (`/Users/tegararrahman/project/dokploy`, Next.js pages router) vs official API spec of the connected server **v0.30.2** (`docs/dokploy.yaml` → `.result.data.json`, 597 ops / 56 tags). All repo paths below are relative to `apps/dokploy/` in that checkout unless prefixed otherwise.

Console convention: every Dokploy page becomes a route under `/admin/dokploy/app/**` backed by the universal proxy `{METHOD} /api/v1/dokploy/{tag.op}`; mirror-DB reads via `GET /api/v1/admin/dokploy/db/{entity}` where a local copy exists.

Status legend:
- **ce** = ce-implementable (page works on self-hosted CE; all/most backing ops exist in the spec)
- **cloud** = cloud-only / enterprise-only (Dokploy Cloud SaaS or license-gated; excluded from this wave)
- **\*** = ce-implementable with a named op-gap against v0.30.2 (see Appendix B)

---

## A) Page manifest

### A.1 Top-level dashboard pages

| # | Dokploy page | Purpose | Console route | Primary tags.ops | Status |
|---|---|---|---|---|---|
| 1 | `pages/dashboard/home.tsx` (+ `components/dashboard/home/show-home.tsx`) | Home: stats cards + recent centralized deployments | `/admin/dokploy/app/home` | `project.homeStats`, `deployment.allCentralized`, `user.get/getPermissions` | ce |
| 2 | `pages/dashboard/projects.tsx` (+ `components/dashboard/projects/show.tsx`) | Project grid, create/update/delete/duplicate projects, tag bulk-assign | `/admin/dokploy/app/projects` | `project.all/create/one/remove/update`, `tag.all/bulkAssign`, `settings.isCloud` | ce |
| 3 | `pages/dashboard/project/[projectId]/environment/[environmentId].tsx` | Environment service board (8 kinds), per-service start/stop/deploy/delete/move, bulk actions, create dialogs (app/compose/db/template/import/AI), env CRUD selector | `/admin/dokploy/app/p/[projectId]/e/[environmentId]` | `environment.one/byProjectId/create/update/remove/duplicate/search`, `{application,compose,postgres,mysql,mariadb,mongo,redis,libsql}.{one,start,stop,deploy,delete|remove,move,create}`, `compose.templates/previewTemplate/processTemplate/deployTemplate/import/getTags`, `project.all/duplicate`, `ai.suggest/deploy/getAll`, `server.withSSHKey`, `user.getBookmarkedTemplates/toggleTemplateBookmark` | ce |
| 4 | `pages/dashboard/overview.tsx` (+ `components/dashboard/overview/show-overview-{services,backups,domains,deployments}.tsx`) | Cross-project overview: services / backups / domains / deployments(+queue subtab) | `/admin/dokploy/app/overview` | `overview.services/backups/domains`, `deployment.queueList/allCentralized`, `domain.toggleEnable`, `{kind}.deploy/.stop`, `project.all` | ce |
| 5 | `pages/dashboard/docker.tsx` | Docker explorer (8 tabs — see A.3) | `/admin/dokploy/app/docker?tab=…` | see A.3 | ce |
| 6 | `pages/dashboard/monitoring.tsx` | Container metrics (free scrape of `:4500/metrics`; paid uses server metrics token) — CE-only page (redirects home when IS_CLOUD) | `/admin/dokploy/app/monitoring` | `user.getMetricsToken`, `server.getServerMetrics`, `application.readAppMonitoring` | ce |
| 7 | `pages/dashboard/requests.tsx` (+ `components/dashboard/requests/show-requests.tsx`) | Traefik access-log analytics + log-cleanup config | `/admin/dokploy/app/requests` | `settings.haveActivateRequests/toggleRequests/readStats*/readStatsLogs*`, `settings.getLogCleanupStatus/updateLogCleanup` | **ce\*** (`readStats`, `readStatsLogs` ABSENT from spec) |
| 8 | `pages/dashboard/schedules.tsx` (+ `components/dashboard/application/schedules/show-schedules.tsx`) | Global cron schedules for dokploy-server or a selected server | `/admin/dokploy/app/schedules` | `schedule.list/create/update/delete/one/runManually` | ce |
| 9 | `pages/dashboard/traefik.tsx` (+ `components/dashboard/file-system/show-traefik-system.tsx`) | Browse/edit Traefik dynamic config files on disk | `/admin/dokploy/app/traefik` | `settings.readDirectories/readTraefikFile/updateTraefikFile` | ce |
| 10 | `pages/dashboard/deployments.tsx` | Pure redirect → `overview?tab=deployments[&subtab=queue]` | fold into `/admin/dokploy/app/overview` | — | ce (alias) |
| 11 | `pages/dashboard/networks.tsx` | Pure redirect → `docker?tab=networks` | fold into `/admin/dokploy/app/docker` | — | ce (alias) |
| 12 | `pages/dashboard/swarm.tsx` | Pure redirect → `docker?tab=swarm` | fold into `/admin/dokploy/app/docker` | — | ce (alias) |

### A.2 Settings pages (`pages/dashboard/settings/*`)

| # | Dokploy page | Purpose | Console route | Primary tags.ops | Status |
|---|---|---|---|---|---|
| 13 | `settings/profile.tsx` (+ `profile/profile-form.tsx`, `api/show-api-keys.tsx`) | Profile form, passkeys, API keys | `/admin/dokploy/app/settings/profile` | `user.get/update/listPasskeys`, `user.createApiKey/deleteApiKey`, `organization.all` | ce |
| 14 | `settings/users.tsx` (+ `users/show-users.tsx`, `users/show-invitations.tsx`, proprietary `roles/manage-custom-roles.tsx`) | Members, invitations, permissions matrix, custom roles | `/admin/dokploy/app/settings/users` | `user.all/one/remove/createUserWithCredentials/sendInvitation/assignPermissions/session`, `organization.active/allInvitations/inviteMember/removeInvitation/updateMemberRole`, `customRole.all/create/update/remove/getStatements/membersByRole`, `notification.getEmailProviders` | ce |
| 15 | `settings/sessions.tsx` | Active sessions list + revoke | `/admin/dokploy/app/settings/sessions` | `user.listSessions/revokeSession/all/get` | ce |
| 16 | `settings/ssh-keys.tsx` | SSH keys CRUD + generate | `/admin/dokploy/app/settings/ssh-keys` | `sshKey.all/create/generate/one/remove/update` | ce |
| 17 | `settings/git-providers.tsx` (+ `git/show-git-providers.tsx`, `git/{github,gitlab,gitea,bitbucket}/*`) | GitHub/GitLab/Gitea/Bitbucket provider accounts | `/admin/dokploy/app/settings/git-providers` | `github.{githubProviders,one,testConnection,update,getGithubBranches,getGithubRepositories}`, same shape for `gitlab.*`(7)/`gitea.*`(8)/`bitbucket.*`(7), `gitProvider.getAll/remove/toggleShare` | ce |
| 18 | `settings/registry.tsx` (+ `cluster/registry/show-registry.tsx`) | Docker registries CRUD + test | `/admin/dokploy/app/settings/registry` | `registry.all/create/one/remove/testRegistry/testRegistryById/update` | ce |
| 19 | `settings/notifications.tsx` (+ `notifications/*` — 12 provider forms) | Notification channels: Discord, Email, Telegram, Slack, Teams, Lark, Mattermost, Ntfy, Gotify, Pushover, Resend, Custom | `/admin/dokploy/app/settings/notifications` | `notification.all/one/remove` + for each of 12 providers `create{X}/test{X}Connection/update{X}` (36 ops) | ce |
| 20 | `settings/destinations.tsx` (+ `destination/show-destinations.tsx`) | S3 backup destinations | `/admin/dokploy/app/settings/destinations` | `destination.all/create/one/remove/testConnection/update` | ce |
| 21 | `settings/certificates.tsx` | Traefik certificates list/upload/renew | `/admin/dokploy/app/settings/certificates` | `certificates.all/create/one/remove/update` | ce |
| 22 | `settings/tags.tsx` (+ `tags/tag-manager.tsx`) | Tag CRUD | `/admin/dokploy/app/settings/tags` | `tag.all/create/one/remove/update` | ce |
| 23 | `settings/server.tsx` (+ `web-domain.tsx`, `web-server/*`) | Local (Dokploy) server: domain, web-server settings, Traefik env/ports, IP, version/update panel, web-server DB backups | `/admin/dokploy/app/settings/server` | `settings.getWebServerSettings/updateServer/assignDomainServer/updateServerIp/readTraefikEnv/writeTraefikEnv/getTraefikPorts/updateTraefikPorts/getDokployVersion/getReleaseTag/getUpdateData/checkInfrastructureHealth`, `docker.getContainersByAppLabel/-ByAppNameMatch`, `backup.manualBackupWebServer`, `user.getBackups` | ce |
| 24 | `settings/servers.tsx` (+ `servers/show-servers.tsx`, `servers/actions/*` incl. cleanup, GPU, setup wizard, monitoring) | Remote servers CRUD, setup wizard w/ validate, docker cleanup actions, GPU support, monitoring setup, security | `/admin/dokploy/app/settings/servers` | `server.all/create/one/remove/update/validate/security/getDefaultCommand/setup/setupMonitoring/updateBuildsConcurrency/count/publicIp/getServerTime/withSSHKey/buildServers`, `admin.setupMonitoring`, `settings.cleanAll/cleanDockerBuilder/cleanDockerPrune/cleanStoppedContainers/cleanUnusedImages/cleanUnusedVolumes/cleanAllDeploymentQueue/cleanMonitoring/checkGPUStatus/setupGPU/haveTraefikDashboardPortEnabled`, `patch.cleanPatchRepos` | ce |
| 25 | `settings/deployments.tsx` (+ `servers/actions/builds-concurrency.tsx`) | Concurrent-builds configuration per server (CE only) | `/admin/dokploy/app/settings/deployments` | `server.updateBuildsConcurrency`, `settings.updateBuildsConcurrency`, `server.all` | ce |
| 26 | `settings/secrets.tsx` (+ `vault/show-vault-providers.tsx`) | HashiCorp Vault providers for secret injection | `/admin/dokploy/app/settings/secrets` | `vaultProvider.all/create/one/remove/testConnection/update/listSecretNames` | ce |
| 27 | `settings/dns.tsx` (+ `dns/show-dns-providers.tsx`, `handle-dns-provider.tsx`, `handle-dns-record.tsx`, `show-dns-provider-zones.tsx`) | DNS providers (route53/cloudflare…) + zone/record management | `/admin/dokploy/app/settings/dns` | `dnsProvider.all/create/one/remove/testConnection/update/listZones/listRecords/createRecord/updateRecord/deleteRecord` | ce |
| 28 | `settings/audit-logs.tsx` (+ proprietary `audit-logs/show-audit-logs.tsx`) | Audit log table | `/admin/dokploy/app/settings/audit-logs` | `auditLog.all` | ce |
| 29 | `settings/ai.tsx` (+ `ai-form.tsx`, `handle-ai.tsx`, `handle-ai-providers.tsx`) | AI assistant providers (BYO API keys — no cloud credits required) | `/admin/dokploy/app/settings/ai` | `ai.getAll/one/create/update/delete/testConnection/getModels/getCustomProviders/saveCustomProviders/getEnabledProviders` | ce |
| 30 | `settings/billing.tsx` | Cloud billing (plans/checkout/portal) — gated by IS_CLOUD | — (skip) | `stripe.getProducts/getCurrentPlan/createCheckoutSession/createCustomerPortalSession/upgradeSubscription/canCreateMoreServers`, `server.count` | **cloud** |
| 31 | `settings/invoices.tsx` | Cloud invoices — gated by IS_CLOUD | — (skip) | `stripe.getInvoices/updateInvoiceNotifications` | **cloud** |
| 32 | `settings/license.tsx` | Enterprise license key activation (proprietary) | — (skip) | `licenseKey.activate/deactivate/validate/haveValidLicenseKey/getEnterpriseSettings/updateEnterpriseSettings` | **cloud** (enterprise add-on) |
| 33 | `settings/sso.tsx` (+ proprietary `sso/sso-settings.tsx`, `sso/forward-auth-servers.tsx`, `sso/scim-dialog.tsx`) | Enterprise OIDC/SAML SSO, forward-auth app gate, SCIM, enforce-SSO toggles — all inside `EnterpriseFeatureGate` | — (skip) | `sso.*`(11), `forwardAuth.*`(10), `scim.*`(3), `user.generateToken`, `settings.updateEnforceSSO/updateRemoteServersOnly` | **cloud** (enterprise-gated) |
| 34 | `settings/whitelabeling.tsx` (+ proprietary `whitelabeling/whitelabeling-settings.tsx`) | Logo/CSS/error-page white-labeling — behind `EnterpriseFeatureGate` | — (skip) | `whitelabeling.get/update/reset/getPublic` | **cloud** (enterprise-gated) |

### A.3 `docker.tsx` tab map (`components/dashboard/docker/*`, `swarm/*`, `networks/show-networks.tsx`, `settings/cluster/nodes/*`)

Route: `/admin/dokploy/app/docker?tab={containers|swarm|images|volumes|networks|events|disk-usage|health}`

| Tab (repo trigger value) | Component | tags.ops |
|---|---|---|
| Containers | `docker/show/show-containers.tsx` (+ file manager `docker/files/`, terminal `docker/terminal/`) | `docker.getContainers/getConfig/killContainer/removeContainer/restartContainer/startContainer/stopContainer/listContainerFiles/readContainerFile/writeContainerFile/deleteContainerFile/uploadFileToContainer` |
| Swarm ▸ Overview | `swarm/monitoring-card.tsx` | `swarm.getNodeInfo/getNodes`, `swarm.getAppInfos` (**ABSENT from spec**) |
| Swarm ▸ Containers | `swarm/containers/show-swarm-containers.tsx` | `swarm.getNodeApps`, `docker.getContainersByAppLabel` |
| Swarm ▸ Nodes | `settings/cluster/nodes/show-nodes.tsx` | `cluster.getNodes/addManager/addWorker/removeWorker` |
| Images | `docker/images/show-images.tsx` | `dockerImage.getImages/removeImage/getImageConfig` |
| Volumes | `docker/volumes/show-volumes.tsx` (+ volume file manager) | `dockerVolume.getVolumes/getVolumesSize/getVolumeConfig/removeVolume/listVolumeFiles/readVolumeFile/writeVolumeFile/deleteVolumeFile` |
| Networks | `networks/show-networks.tsx` (+ `networks/assign-networks.tsx`) | `network.all/inspect/create/import/remove/recreate/networksToSync/one` |
| Events | `docker/events/show-docker-events.tsx` | `docker.getEvents` |
| Disk Usage | `docker/disk-usage/show-disk-usage.tsx` | `dockerDiskUsage.getDiskUsage/getBuildCache/pruneBuildCache` |
| Health | `docker/health/show-health.tsx` | `docker.getServerHealth` |

### A.4 Service detail pages — nested view inventory

Shared route pattern: `/admin/dokploy/app/p/[projectId]/e/[environmentId]/services/{kind}/{serviceId}?tab=…`

#### A.4.1 Application — `…/services/application/[applicationId].tsx`

Header: status tooltip, icon settings (`application/icon/show-icon-settings.tsx`), UpdateApplication dialog, DeleteService dialog.

| Tab (exact repo value) | View component (path under `components/dashboard/`) | Backing tags.ops |
|---|---|---|
| `general` | `application/general/show.tsx` → embeds `application/build/show.tsx` (build type) and `application/general/generic/show.tsx` (+ `save-{github,gitlab,gitea,bitbucket,docker}-provider.tsx`, `save-drag-n-drop.tsx`) | `application.one/update/start/stop/deploy/reload/redeploy/saveBuildType/saveGithubProvider/saveGitlabProvider/saveGiteaProvider/saveBitbucketProvider/saveDockerProvider/disconnectGitProvider`, `github.getGithubBranches/-Repositories`, `gitlab.*`, `gitea.*`, `bitbucket.*`, `application.refreshToken` |
| `environment` | `application/environment/show.tsx` | `application.saveEnvironment` |
| `domains` | `application/domains/show-domains.tsx` | `domain.byApplicationId/create/update/delete/one/toggleEnable/generateDomain/validateDomain/canGenerateTraefikMeDomains` |
| `deployments` | `application/deployments/show-deployments.tsx` | `deployment.allByType/readLogs/killProcess/removeDeployment`, `application.cancelDeployment/cleanQueues/clearDeployments/killBuild/refreshToken/redeploy`, `rollback.rollback/delete` |
| `preview-deployments` | `application/preview-deployments/show-preview-deployments.tsx` | `previewDeployment.all/one/delete/redeploy`, `domain.generateDomain/create/update/one` |
| `schedules` | `application/schedules/show-schedules.tsx` | `schedule.list/create/update/delete/one/runManually` |
| `volume-backups` | `application/volume-backups/show-volume-backups.tsx` | `volumeBackups.list/create/update/delete/one/runManually` (+ restore op absent, see B) |
| `logs` | `application/logs/show.tsx` (+ AI log analysis) | `docker.getConfig/getContainersByAppNameMatch/getServiceContainersByAppName`, `ai.analyzeLogs/getEnabledProviders` |
| `patches` | `application/patches/show-patches.tsx` | `patch.byEntityId/one/create/update/delete/toggleEnabled/ensureRepo/readRepoFile/readRepoDirectories/saveFileAsPatch/markFileForDeletion/cleanPatchRepos` |
| `monitoring` | `monitoring/free/container/show-free-container-monitoring.tsx` (paid variant `monitoring/paid/container/*` is cloud-metrics) | `application.readAppMonitoring`, `user.getContainerMetrics` (paid) |
| `advanced` (stacked section, not nested tabs) | see sub-table below | |

Application **Advanced** section sub-views (rendered stacked inside one tab):

| Sub-view | Component path | tags.ops |
|---|---|---|
| Command / restart policy | `application/advanced/general/add-command.tsx` | `application.update` |
| Cluster / swarm settings | `application/advanced/cluster/show-cluster-settings.tsx` | `application.update`, `registry.all` |
| Build server | `application/advanced/show-build-server.tsx` | `server.buildServers`, `application.update` |
| Resource limits | `application/advanced/show-resources.tsx` | `application.update` |
| Volumes / Mounts | `application/advanced/volumes/show-volumes.tsx` | `mounts.listByServiceId/create/update/remove/one/allNamedByApplicationId` |
| Networks | `networks/assign-networks.tsx` | `network.all`, `application.update` |
| Redirects | `application/advanced/redirects/show-redirects.tsx` | `redirects.one/create/update/delete` |
| Security | `application/advanced/security/show-security.tsx` | `security.one/create/update/delete` |
| Ports | `application/advanced/ports/show-port.tsx` | `port.one/create/update/delete` |
| Traefik config | `application/advanced/traefik/show-traefik-config.tsx` | `application.readTraefikConfig/updateTraefikConfig` |

#### A.4.2 Compose — `…/services/compose/[composeId].tsx`

| Tab | View component | Backing tags.ops |
|---|---|---|
| `general` | `compose/general/show.tsx` | `compose.one/update/start/stop/deploy/redeploy/randomizeCompose/getConvertedCompose/getDefaultCommand/fetchSourceType/disconnectGitProvider`, git-provider branches/repos (github/gitlab/gitea/bitbucket) |
| `environment` | `application/environment/show-environment.tsx` | `compose.saveEnvironment` |
| `domains` | `application/domains/show-domains.tsx` | `domain.byComposeId/create/update/delete/one/toggleEnable/generateDomain/validateDomain/canGenerateTraefikMeDomains` |
| `deployments` | `application/deployments/show-deployments.tsx` | `deployment.allByType/readLogs/killProcess/removeDeployment`, `compose.cancelDeployment/cleanQueues/clearDeployments/killBuild/refreshToken/redeploy`, `rollback.rollback` |
| `containers` | `compose/containers/show-compose-containers.tsx` | `docker.getContainersByAppNameMatch/getStackContainersByAppName/killContainer/restartContainer/startContainer/stopContainer/getServiceContainersByAppName` |
| `backups` | `database/backups/show-backups.tsx` | `backup.create/update/remove/one/listBackupFiles/manualBackupCompose`, `destination.all`, `compose.one` |
| `schedules` | `application/schedules/show-schedules.tsx` | `schedule.*` |
| `volumeBackups` | `application/volume-backups/show-volume-backups.tsx` | `volumeBackups.*` |
| `logs` | `compose/logs/show.tsx` / `compose/logs/show-stack.tsx` | `compose.readLogs`, `docker.getServiceContainersByAppName/getStackContainersByAppName` |
| `patches` | `application/patches/show-patches.tsx` | `patch.*` |
| `monitoring` | `monitoring/free/container/show-free-compose-monitoring.tsx` | `application.readAppMonitoring` (per-container metrics) |
| `advanced` | AddCommandCompose `compose/advanced/add-command.tsx`; Volumes `application/advanced/volumes/show-volumes.tsx`; Import `application/advanced/import/show-import.tsx`; Networks `networks/assign-compose-networks.tsx`; Isolation `compose/advanced/add-isolation.tsx` | `compose.getDefaultCommand/update`, `mounts.*`, `compose.import/processTemplate/loadMountsByService/loadServices`, `network.all`, `compose.isolatedDeployment` |

#### A.4.3 Databases — postgres / mysql / mariadb / mongo / libsql / redis

Files: `…/services/{postgres,mysql,mariadb,mongo,libsql,redis}/[{kind}Id].tsx`. All six share an identical skeleton (verified by grep of TabsTrigger values); **redis has NO `backups` tab**; libsql uses `saveExternalPorts` (plural) and has no `changePassword`.

| Tab | View component | Backing tags.ops (per kind K ∈ {postgres,mysql,mariadb,mongo,redis,libsql}) |
|---|---|---|
| `general` | `database/general? no — shared general card`: `ShowGeneral{Kind}` + `ShowInternal{Kind}Credentials` + `ShowExternal{Kind}Credentials` (imported from `components/dashboard/database/*` & shared) | `K.one/update/changeStatus/changePassword (except libsql)/saveExternalPort(s)/reload/rebuild/start/stop/deploy` |
| `environment` | shared env show (`application/environment/show-environment.tsx`) | `K.saveEnvironment` |
| `logs` | shared `ShowDockerLogs` | `K.readLogs`, `docker.getConfig/getContainersByAppNameMatch` |
| `monitoring` | free container monitoring | `application.readAppMonitoring` (container named after `appName`) |
| `backups` (all but redis) | `database/backups/show-backups.tsx` | `backup.create/update/remove/one/listBackupFiles/manualBackup{Postgres,MySql,Mariadb,Mongo,Libsql}`, `destination.all`, `K.one` |
| `advanced` | `shared/show-database-advanced-settings.tsx` | `K.update` |

### A.5 Top-level auth pages (outside dashboard)

| Dokploy page | Purpose | Console equivalent | Notes |
|---|---|---|---|
| `pages/register.tsx` | First-run admin setup / cloud signup (`authClient.signUp.email`) | our own `/register` (existing console auth) | behavior parity only; better-auth session is Dokploy-local |
| `pages/reset-password.tsx` | Set new password from email token (`authClient.resetPassword`) | own reset flow | parity only |
| `pages/send-reset-password.tsx` | Request reset email (`authClient.requestPasswordReset`) | own forgot-password flow | parity only |
| `pages/invitation.tsx` | Preview invitation before accept (`user.getUserByToken` + `authClient.organization.acceptInvitation`) | mirror via `GET /api/v1/dokploy/user.getUserByToken` | accept itself goes through better-auth endpoint |
| `pages/accept-invitation/[accept-invitation].tsx` | Accept invitation | own invite flow | `organization.getById` used by repo UI is **ABSENT** from v0.30.2 spec |

---

## B) Op-coverage appendix (56 tags)

Covering route(s) reference §A row numbers/routes. "UI ref" = found referenced in Dokploy dashboard code.

| Tag (ops) | Covering console route(s) | Uncovered ops & notes |
|---|---|---|
| `admin` (1) | settings/servers (#24): `admin.setupMonitoring` | — |
| `ai` (14) | settings/ai (#29); logs tabs of application/compose (`ai.analyzeLogs`, `getEnabledProviders`); project add-AI dialog (`ai.suggest/deploy`) | full coverage |
| `application` (31) | service detail A.4.1; environment board (#3) | full coverage |
| `auditLog` (1) | settings/audit-logs (#28) | full coverage |
| `backup` (12) | compose/DB backups tabs; settings/server web-server backups (#23) | full coverage |
| `bitbucket` (7) | git-providers (#17); app/compose general | full coverage |
| `certificates` (5) | certificates (#21) | full coverage |
| `cluster` (4) | docker ▸ swarm ▸ nodes | full coverage |
| `compose` (31) | compose detail A.4.2; env board templates/import | full coverage |
| `customRole` (6) | settings/users (#15, `ManageCustomRoles` section) | full coverage |
| `deployment` (9) | deployments tabs (A.4.1/A.4.2), overview deployments+queue, home recent | UI refs use `allByType`, `allCentralized`, `queueList`, `readLogs`, `killProcess`, `removeDeployment`; `deployment.all`, `allByCompose`, `allByServer` are API-only (no CE UI call site) — still proxied via deployments tab |
| `destination` (6) | destinations (#20) | full coverage |
| `dnsProvider` (11) | dns (#27) | full coverage |
| `docker` (18) | docker containers tab + container file manager/terminal; compose containers; logs tabs | full coverage |
| `dockerDiskUsage` (3) | docker disk-usage tab | full coverage |
| `dockerImage` (3) | docker images tab | full coverage |
| `dockerVolume` (8) | docker volumes tab | full coverage |
| `domain` (10) | domains tabs; overview domains | full coverage |
| `environment` (7) | project/env board + advanced-environment-selector (`create/duplicate/remove/update/search`) | full coverage |
| `forwardAuth` (10) | none (sso page skipped — enterprise) | entire tag uncovered by design; Dokploy UI usage: `proprietary/sso/forward-auth-servers.tsx` |
| `gitProvider` (4) | git-providers (#17) | full coverage |
| `gitea` (8) | git-providers; app/compose general | full coverage |
| `github` (6) | git-providers; app/compose general | full coverage |
| `gitlab` (7) | git-providers; app/compose general | full coverage |
| `libsql` (14) | libsql detail A.4.3 | full coverage |
| `licenseKey` (6) | none (license page skipped — enterprise) | Dokploy UI usage: `proprietary/license-keys/license-key.tsx`; gates sso/whitelabeling/forwardAuth features via `haveValidLicenseKey` |
| `mariadb` / `mysql` / `mongo` / `postgres` / `redis` (16 each) | respective detail pages A.4.3 | full coverage |
| `mounts` (6) | application/compose Advanced ▸ volumes | full coverage |
| `network` (8) | docker networks tab; assign-networks sections | full coverage |
| `notification` (41) | notifications (#19) — 12×(create/update/test) + all/one/remove = 39; plus `getEmailProviders` in users page | `notification.receiveNotification` — webhook sink endpoint, no dashboard UI call site (external systems POST to it) |
| `organization` (11) | users page invitations (#14), profile API keys (`organization.all`) | `organization.getById` — used by accept-invitation page only, ABSENT from spec; `active/setDefault/one/update/delete/create` covered via users/org context |
| `overview` (3) | overview page tabs | full coverage |
| `patch` (12) | patches tab (application + compose) | full coverage |
| `port` (4) | application Advanced ▸ ports | full coverage |
| `previewDeployment` (4) | preview-deployments tab | full coverage |
| `project` (9) | projects (#2), home (#1: `homeStats`), env board (`duplicate`) | `project.search/allForPermissions` — permission-filtered variants, usable anywhere lists are rendered |
| `redirects` (4) | application Advanced ▸ redirects | full coverage |
| `registry` (7) | registry (#18); cluster-settings sub-view | full coverage |
| `rollback` (2) | deployments tab (restore point picker) | full coverage |
| `schedule` (6) | schedules page (#8); schedules tabs | full coverage |
| `scim` (3) | none (sso page skipped — enterprise) | Dokploy UI usage: `proprietary/sso/scim-dialog.tsx` + `sso-settings.tsx` |
| `security` (4) | application Advanced ▸ security | full coverage |
| `server` (18) | servers (#24), server (#23), traefik (#9), builds-concurrency (#25), monitoring (#6: `getServerMetrics`) | `server.setupWithLogs` — called by repo setup wizard (`settings/servers/actions/*`) but **ABSENT from spec**; fall back to `server.setup` + `server.validate` polling |
| `settings` (52) | spread across #23/#24/#25/#9/#7/#6 + every page's `isCloud/getIp` probes | uncovered-by-design: `getDokployCloudIps` (cloud firewall UI, no CE call site found), `health` (infra probe, no UI), `readMiddlewareTraefikConfig`/`updateMiddlewareTraefikConfig`/`readWebServerTraefikConfig`/`updateWebServerTraefikConfig` (no CE dashboard call site found — likely legacy/API-only); op-gap: `readStats`/`readStatsLogs` (requests page core, **ABSENT from spec** — page degrades to toggle/cleanup UI) |
| `sshKey` (7) | ssh-keys (#16) | full coverage |
| `sso` (11) | none (skipped — enterprise) | Dokploy UI usage: `proprietary/sso/sso-settings.tsx` |
| `stripe` (8) | none (billing/invoices skipped — cloud) | Dokploy UI usage: `settings/billing/*`, invoices |
| `swarm` (4) | docker ▸ swarm overview/containers | `swarm.getAppInfos` — called by `components/dashboard/swarm/monitoring-card.tsx` but **ABSENT from spec** (spec has only getContainerStats/getNodeApps/getNodeInfo/getNodes) |
| `tag` (8) | tags (#22); projects bulk-assign (`bulkAssign`) | `assignToProject`/`removeFromProject` — no CE dashboard call site found (project-card tag editing may be client-side only); expose via project detail actions anyway |
| `user` (26) | profile/sessions/users (#13–#15), home, monitoring, requests, invitation flow | `user.checkUserOrganizations` (no UI call site found; org-switch helper), `user.getUserByToken` (invitation preview), `haveRootAccess` (dashboard-layout guard → replicate as route guard), `session` (auth bootstrap) |
| `vaultProvider` (7) | secrets (#26) | `listSecretNames` used inside env-var dialogs |
| `volumeBackups` (6) | volume-backups tabs | `restoreVolumeBackupWithLogs` — called by repo restore button (`application/volume-backups/*`) but **ABSENT from spec**; restore action will be disabled until server upgrades |
| `whitelabeling` (4) | none (skipped — enterprise) | Dokploy UI usage: `utils/hooks/use-whitelabeling.ts`, login/register branding |

### Op-gap register (used by Dokploy CE UI but missing from v0.30.2 spec — verified by grepping `docs/dokploy.yaml`)

| Missing op | Blocked UI | Workaround |
|---|---|---|
| `settings.readStats` / `settings.readStatsLogs` | Requests page analytics (#7) | ship toggle/cleanup controls only; hide charts |
| `swarm.getAppInfos` | Swarm overview card | use `swarm.getNodeApps` + `swarm.getContainerStats` composition |
| `volumeBackups.restoreVolumeBackupWithLogs` | Volume-backup restore button | disable button, keep create/list/run-manually |
| `server.setupWithLogs` | Remote-server setup wizard live log | `server.setup` + `server.validate` + `getServerTime` polling |
| `organization.getById` | accept-invitation pre-accept summary | rely on `user.getUserByToken` payload |

---

## C) Count summary

- **Dokploy dashboard pages**: 42 tsx files = 39 real pages + 3 pure redirect stubs (`deployments`, `networks`, `swarm`). Plus 5 top-level auth pages (parity handled by our own auth, not routed).
- **Cloud-only pages (excluded)**: 5 — `billing`, `invoices`, `license`, `sso`, `whitelabeling`.
- **CE-implementable pages**: 34 (incl. `requests` degraded by the readStats op-gap).
- **Console routes to create**: 27 route patterns covering those 34 pages:
  - 8 top-level static: `home`, `projects`, `overview`, `docker`, `monitoring`, `requests`, `schedules`, `traefik` (the 3 redirect stubs become aliases into `overview`/`docker`, no new routes)
  - 2 dynamic: `p/[projectId]/e/[environmentId]`, `p/[projectId]/e/[environmentId]/services/[kind]/[serviceId]`
  - 17 static under `settings/*`: `profile, users, sessions, ssh-keys, git-providers, registry, notifications, destinations, certificates, tags, server, servers, deployments, secrets, dns, audit-logs, ai`
  - Service-detail tabs are query-param views (`?tab=`), not separate routes.
- **Intentional gaps**:
  1. 5 cloud/enterprise pages skipped (billing, invoices, license, sso, whitelabeling) → tags `stripe`, `sso`, `scim`, `forwardAuth`, `licenseKey`, `whitelabeling` intentionally uncovered.
  2. 5 ops missing from v0.30.2 spec degrade 4 UI spots (see op-gap register).
  3. 6 orphan ops with no Dokploy CE UI call site are proxied anyway but get no dedicated UI: `settings.health`, `settings.getDokployCloudIps`, `user.checkUserOrganizations`, `notification.receiveNotification`, `settings.{read,update}{Middleware,WebServer}TraefikConfig`, `tag.assignToProject`/`removeFromProject` (exposed as convenience actions).
