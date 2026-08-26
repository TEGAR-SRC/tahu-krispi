// Dokploy PaaS integration surface:
//   - Universal proxy: every upstream operation (597 today, more tomorrow)
//     relays verbatim through /v1/dokploy/<tag.method> with the x-api-key
//     header injected server-side; the API key never leaves the backend.
//   - Mirror: admin-only sync endpoints pull core resource lists into local
//     dokploy_* tables (upsert by remote_id) plus read/delete for orphan
//     cleanup. org_id stays NULL until customer scoping lands.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"

	"kilat.cloud/backend/internal/provider/dokploy"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// getDokployClient builds a client from the providers row at request time so
// credential/endpoint changes apply without redeploying.
func (s *Server) getDokployClient(ctx context.Context) (*dokploy.Client, error) {
	return dokploy.NewClientFromDB(ctx, s.db, s.encKey)
}

// ---- Universal proxy ----

// dokployProxy relays any method to <base>/api/<op-path>. The dotted
// operation path arrives as the wildcard ("application.create"); query
// strings pass through, bodies only for POST/PUT/PATCH. Upstream status and
// body are returned verbatim — including errors — so the console can render
// exactly what Dokploy said.
func (s *Server) dokployProxy(c fiber.Ctx) error {
	cl, err := s.getDokployClient(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	opPath := strings.Trim(c.Params("*"), "/")
	if opPath == "" {
		return mw.WriteError(c, errValidation("missing dokploy operation path (e.g. project.all)"))
	}

	q := url.Values{}
	for k, v := range c.Queries() {
		q.Set(k, v)
	}

	method := string(c.Method())
	var body []byte
	if method == fiber.MethodPost || method == fiber.MethodPut || method == fiber.MethodPatch {
		body = c.Body()
	}

	status, payload, err := cl.Do(c.Context(), method, opPath, q, body)
	if err != nil {
		return mw.WriteError(c, err)
	}
	c.Set(fiber.HeaderContentType, "application/json")
	return c.Status(status).Send(payload)
}

// ---- Mirror: entity registry ----

// dokployEntity describes one mirrored resource: the local table and its
// non-data columns for list rendering.
type dokployEntity struct {
	table   string
	columns []string
}

var (
	dokployBaseCols = []string{"id", "remote_id", "data", "created_at", "updated_at"}

	dokployEntities = map[string]dokployEntity{
		"projects":     {table: "dokploy_projects", columns: []string{"id", "remote_id", "org_id", "name", "description", "data", "created_at", "updated_at"}},
		"environments": {table: "dokploy_environments", columns: []string{"id", "remote_id", "project_remote_id", "name", "data", "created_at", "updated_at"}},
		"applications": {table: "dokploy_applications", columns: []string{"id", "remote_id", "org_id", "project_remote_id", "environment_remote_id", "name", "status", "data", "created_at", "updated_at"}},
		"composes":     {table: "dokploy_composes", columns: []string{"id", "remote_id", "org_id", "project_remote_id", "name", "status", "data", "created_at", "updated_at"}},
		"databases":    {table: "dokploy_databases", columns: []string{"id", "remote_id", "db_type", "project_remote_id", "name", "status", "data", "created_at", "updated_at"}},
		"domains":      {table: "dokploy_domains", columns: []string{"id", "remote_id", "application_remote_id", "compose_remote_id", "domain", "data", "created_at", "updated_at"}},
		"deployments":  {table: "dokploy_deployments", columns: []string{"id", "remote_id", "resource_kind", "resource_remote_id", "status", "data", "created_at", "updated_at"}},
		"backups":      {table: "dokploy_backups", columns: []string{"id", "remote_id", "db_type", "database_remote_id", "schedule", "data", "created_at", "updated_at"}},
		"servers":      {table: "dokploy_servers", columns: []string{"id", "remote_id", "name", "ip", "status", "data", "created_at", "updated_at"}},
		"registries":   {table: "dokploy_registries", columns: []string{"id", "remote_id", "registry_name", "username", "data", "created_at", "updated_at"}},
		"sshkeys":      {table: "dokploy_ssh_keys", columns: []string{"id", "remote_id", "name", "public_key", "data", "created_at", "updated_at"}},
		"certificates": {table: "dokploy_certificates", columns: dokployBaseCols},
	}
)

// dokploySyncTargets maps mirror entities to their upstream global list
// operation. Ops were verified against the live server with read-only
// probes (2026-08-26):
//   - "*.search" ops answer {"items":[...],"total":N}; project.all and
//     overview.* answer bare arrays — dokployUnwrapList accepts both.
//   - "deployments" is deliberately absent: deployment.all requires
//     ?applicationId= (400 otherwise) and no global deployment list exists
//     (overview.deployments is 404). Fill it in targeted mode via
//     op_path+query, e.g. {"entity":"deployments","op_path":"deployment.all",
//     "query":{"applicationId":"..."}}.
//   - "databases" is handled by its own multi-source path (six searches).
var dokploySyncTargets = map[string]string{
	"projects":     "project.all",
	"servers":      "server.all",
	"registries":   "registry.all",
	"sshkeys":      "sshKey.all",
	"certificates": "certificates.all",
	"applications": "application.search",
	"composes":     "compose.search",
	"environments": "environment.search",
	"domains":      "overview.domains",
	"backups":      "overview.backups",
}

// dokployDatabaseTypes drives the databases sync: each type maps to the
// upstream op "<type>.search". libsql stays listed because the table's
// db_type CHECK requires it, but its search op is absent on this Dokploy
// build (404) — that type is skipped (upsert AND reconcile) until upstream
// ships a list operation for it.
var dokployDatabaseTypes = []string{"postgres", "mysql", "mariadb", "mongo", "redis", "libsql"}

// ---- Sync ----

type admDokploySyncInput struct {
	Entity string            `json:"entity"`
	OpPath string            `json:"op_path"` // optional targeted-mode override: fill from any read endpoint
	Query  map[string]string `json:"query"`   // optional query params forwarded to the op
}

// adminDokploySync pulls an upstream list and upserts it by remote_id into
// the matching mirror table (global rows, org_id NULL). Three modes:
//
//	{"entity":"projects"}      — global list via the entity's sync target
//	{"entity":"databases"}     — aggregates six <type>.search sources
//	{"entity":"deployments","op_path":"deployment.all",
//	 "query":{"applicationId":"…"}} — targeted fill from any read endpoint
//
// Targeted fills upsert only: they never reconcile deletions, so syncing one
// resource's slice cannot wipe rows collected for its siblings. Every
// upstream call in every mode is forced GET, so this surface stays read-only
// no matter what the request body asks for.
func (s *Server) adminDokploySync(c fiber.Ctx) error {
	var in admDokploySyncInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	entity := lower(strings.TrimSpace(in.Entity))
	if entity == "" {
		return mw.WriteError(c, errValidation("entity is required; supported: "+
			strings.Join(dokployEntityNames(), ", ")))
	}

	cl, err := s.getDokployClient(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	if entity == "databases" { // multi-source: six <type>.search merges
		return s.adminDokploySyncDatabases(c, cl)
	}

	targeted := strings.TrimSpace(in.OpPath) != ""
	var opPath string
	if targeted {
		if _, okt := dokployEntities[entity]; !okt {
			return mw.WriteError(c, errValidation("unknown entity; supported: "+
				strings.Join(dokployEntityNames(), ", ")))
		}
		opPath = strings.TrimPrefix(strings.TrimSpace(in.OpPath), "/")
		if opPath == "" || strings.Contains(opPath, "..") || strings.ContainsAny(opPath, " \t\r\n") {
			return mw.WriteError(c, errValidation("invalid op_path"))
		}
	} else {
		var ok bool
		opPath, ok = dokploySyncTargets[entity]
		if !ok {
			return mw.WriteError(c, errValidation(
				"entity has no global list op; syncable without op_path: "+
					strings.Join(dokploySyncTargetNames(), ", ")+
					" — or pass op_path+query, e.g. {\"entity\":\"deployments\","+
					"\"op_path\":\"deployment.all\",\"query\":{\"applicationId\":\"...\"}}"))
		}
	}

	q := url.Values{}
	for k, v := range in.Query {
		q.Set(k, v)
	}

	// Read-only enforced here: method is always GET regardless of input.
	status, payload, err := cl.Do(c.Context(), fiber.MethodGet, opPath, q, nil)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if status < 200 || status >= 300 {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"dokploy %s answered %d: %s", opPath, status, truncateSnippet(payload)))
	}
	items, err := dokployUnwrapList(payload)
	if err != nil {
		return mw.WriteError(c, err)
	}

	synced, failed, removed := s.dokployUpsertItems(c.Context(), entity, items, !targeted)
	meta := map[string]any{
		"entity": entity, "op_path": opPath,
		"synced": synced, "failed": failed, "removed": removed,
	}
	if targeted {
		meta["targeted"] = true
	}
	s.admAuditMeta(c, "admin.dokploy.sync", "provider", nil, meta)
	return mw.JSON(c, 200, fiber.Map{"entity": entity, "targeted": targeted,
		"synced": synced, "failed": failed, "removed": removed}, nil)
}

func dokploySyncTargetNames() []string {
	names := make([]string, 0, len(dokploySyncTargets))
	for k := range dokploySyncTargets {
		names = append(names, k)
	}
	return names
}

// dokployEntityNames lists every mirror entity accepted by the sync and DB
// endpoints (including non-syncable ones like deployments).
func dokployEntityNames() []string {
	names := make([]string, 0, len(dokployEntities))
	for k := range dokployEntities {
		names = append(names, k)
	}
	return names
}

// adminDokploySyncDatabases merges the six per-type database searches into
// dokploy_databases, stamping db_type from the source op. Reconciliation
// runs per db_type and only for types whose search answered 2xx with a
// parseable list — an unverifiable type (libsql today: no list op on this
// Dokploy build) is skipped entirely so its mirror rows can never be
// mass-deleted on the strength of a failed lookup.
func (s *Server) adminDokploySyncDatabases(c fiber.Ctx, cl *dokploy.Client) error {
	type typeStats struct {
		Synced  int `json:"synced"`
		Failed  int `json:"failed"`
		Removed int `json:"removed"`
	}
	byType := make(map[string]*typeStats, len(dokployDatabaseTypes))
	totals := typeStats{}
	var skipped []string

	for _, dbType := range dokployDatabaseTypes {
		st := &typeStats{}
		byType[dbType] = st
		status, payload, err := cl.Do(c.Context(), fiber.MethodGet, dbType+".search", nil, nil)
		if err != nil {
			skipped = append(skipped, dbType+":transport-error")
			continue
		}
		if status < 200 || status >= 300 {
			skipped = append(skipped, fmt.Sprintf("%s:http-%d", dbType, status))
			continue
		}
		items, uerr := dokployUnwrapList(payload)
		if uerr != nil {
			skipped = append(skipped, dbType+":unexpected-shape")
			continue
		}

		existing := map[string]bool{}
		rows, qerr := s.db.Query(c.Context(),
			`SELECT remote_id FROM dokploy_databases WHERE db_type=$1`, dbType)
		if qerr == nil {
			for rows.Next() {
				var rid string
				if rerr := rows.Scan(&rid); rerr == nil {
					existing[rid] = true
				}
			}
			rows.Close()
		}

		seen := map[string]bool{}
		for _, item := range items {
			if id, ierr := dokployDatabaseID(dbType, item); ierr == nil && id != "" {
				seen[id] = true
			}
			if err := s.dokployUpsertDatabase(c.Context(), dbType, item); err != nil {
				st.Failed++
				continue // no usable remote id, or mirror insert failed
			}
			st.Synced++
		}
		for rid := range existing {
			if seen[rid] {
				continue
			}
			if _, derr := s.db.Exec(c.Context(),
				`DELETE FROM dokploy_databases WHERE db_type=$1 AND remote_id=$2`, dbType, rid); derr == nil {
				st.Removed++
			}
		}
		totals.Synced += st.Synced
		totals.Failed += st.Failed
		totals.Removed += st.Removed
	}
	if skipped == nil {
		skipped = []string{}
	}

	s.admAuditMeta(c, "admin.dokploy.sync", "provider", nil, map[string]any{
		"entity": "databases", "op_path": "<type>.search x6",
		"synced": totals.Synced, "failed": totals.Failed, "removed": totals.Removed,
		"skipped_types": skipped,
	})
	return mw.JSON(c, 200, fiber.Map{"entity": "databases",
		"synced": totals.Synced, "failed": totals.Failed, "removed": totals.Removed,
		"by_type": byType, "skipped_types": skipped}, nil)
}

// dokployUpsertItems persists unwrapped upstream items into the entity's
// mirror table. With reconcile, rows whose remote_id never appeared upstream
// are deleted as stale.
func (s *Server) dokployUpsertItems(ctx context.Context, entity string, items []map[string]any, reconcile bool) (synced, failed, removed int) {
	existing := map[string]bool{}
	if reconcile {
		rows, err := s.db.Query(ctx,
			fmt.Sprintf("SELECT remote_id FROM %s", dokployEntities[entity].table))
		if err == nil {
			for rows.Next() {
				var rid string
				if rerr := rows.Scan(&rid); rerr == nil {
					existing[rid] = true
				}
			}
			rows.Close()
		}
	}
	seen := map[string]bool{}
	for _, item := range items {
		if id, ierr := dokployItemID(entity, item); ierr == nil && id != "" {
			seen[id] = true
		}
		if err := s.dokployUpsertEntity(ctx, entity, item); err != nil {
			failed++
			continue // no usable remote id, or mirror insert failed
		}
		synced++
	}
	if reconcile {
		for rid := range existing {
			if seen[rid] {
				continue
			}
			if _, derr := s.db.Exec(ctx,
				fmt.Sprintf("DELETE FROM %s WHERE remote_id=$1", dokployEntities[entity].table), rid); derr == nil {
				removed++
			}
		}
	}
	return synced, failed, removed
}

// dokployItemID extracts the canonical remote id from one upstream item.
// Key sets follow the live probe — search results carry "<resource>Id"
// camelCase fields; "id" is always the last-resort fallback.
func dokployItemID(entity string, item map[string]any) (string, error) {
	candidates := map[string][]string{
		"projects":     {"projectId", "id"},
		"servers":      {"serverId", "id"},
		"registries":   {"registryId", "id"},
		"sshkeys":      {"sshKeyId", "sshKeyID", "id"},
		"certificates": {"certificateId", "id"},
		"applications": {"applicationId", "id"},
		"composes":     {"composeId", "id"},
		"environments": {"environmentId", "id"},
		"domains":      {"domainId", "id"},
		"deployments":  {"deploymentId", "deployId", "id"},
		"backups":      {"backupId", "id"},
	}[entity]
	if id := dokployStr(item, candidates...); id != "" {
		return id, nil
	}
	return "", errValidation("item missing " + entity + " remote id")
}

// dokployDatabaseID extracts the remote id from a per-type database search
// item ("<type>Id" plus generic fallbacks). Shapes are broad because every
// live search returned zero rows at probe time.
func dokployDatabaseID(dbType string, item map[string]any) (string, error) {
	if id := dokployStr(item, dbType+"Id", dbType+"ID", "databaseId", "id"); id != "" {
		return id, nil
	}
	return "", errValidation("item missing " + dbType + " database id")
}

// dokployUnwrapList extracts the item array from any observed upstream
// shape: the legacy tRPC envelope {"result":{"data":{"json":[...]}}},
// a bare JSON array (project.all, overview.*), or the newer search envelope
// {"items":[...],"total":N}.
func dokployUnwrapList(body []byte) ([]map[string]any, error) {
	var env struct {
		Result struct {
			Data struct {
				Json json.RawMessage `json:"json"`
			} `json:"data"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &env); err == nil && len(env.Result.Data.Json) > 0 {
		body = env.Result.Data.Json
	}
	var items []map[string]any
	if err := json.Unmarshal(body, &items); err == nil && items != nil {
		return items, nil
	}
	var page struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(body, &page); err == nil && page.Items != nil {
		return page.Items, nil
	}
	return nil, errValidation("unexpected upstream list payload shape")
}

// dokployUpsertEntity persists one raw upstream item into its mirror table,
// extracting the handful of queryable columns from well-known candidate keys
// (the OpenAPI spec documents no response shapes). Returns an error when the
// item carries no recognizable id or the insert fails. data always stores
// the full raw object.
func (s *Server) dokployUpsertEntity(ctx context.Context, entity string, item map[string]any) error {
	raw, _ := json.Marshal(item)
	switch entity {
	case "projects":
		id := dokployStr(item, "projectId", "id")
		if id == "" {
			return errValidation("item missing projectId")
		}
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_projects(remote_id, name, description, data)
VALUES ($1,$2,NULLIF($3,''),$4::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    name=EXCLUDED.name, description=EXCLUDED.description, data=EXCLUDED.data`,
			id, firstNonEmpty(dokployStr(item, "name", "projectName"), id),
			dokployStr(item, "description"), raw)
		return err
	case "servers":
		id := dokployStr(item, "serverId", "id")
		if id == "" {
			return errValidation("item missing serverId")
		}
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_servers(remote_id, name, ip, status, data)
VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    name=EXCLUDED.name, ip=EXCLUDED.ip, status=EXCLUDED.status, data=EXCLUDED.data`,
			id, firstNonEmpty(dokployStr(item, "name"), id), dokployStr(item, "ipAddress", "ip"),
			dokployStr(item, "status"), raw)
		return err
	case "registries":
		id := dokployStr(item, "registryId", "id")
		if id == "" {
			return errValidation("item missing registryId")
		}
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_registries(remote_id, registry_name, username, data)
VALUES ($1,NULLIF($2,''),NULLIF($3,''),$4::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    registry_name=EXCLUDED.registry_name, username=EXCLUDED.username, data=EXCLUDED.data`,
			id, dokployStr(item, "registryName", "name"), dokployStr(item, "username"), raw)
		return err
	case "sshkeys":
		id := dokployStr(item, "sshKeyId", "sshKeyID", "id")
		if id == "" {
			return errValidation("item missing sshKeyId")
		}
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_ssh_keys(remote_id, name, public_key, data)
VALUES ($1,$2,NULLIF($3,''),$4::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    name=EXCLUDED.name, public_key=EXCLUDED.public_key, data=EXCLUDED.data`,
			id, firstNonEmpty(dokployStr(item, "name"), id), dokployStr(item, "publicKey"), raw)
		return err
	case "certificates":
		id := dokployStr(item, "certificateId", "id")
		if id == "" {
			return errValidation("item missing certificateId")
		}
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_certificates(remote_id, name, data)
VALUES ($1,$2,$3::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    name=EXCLUDED.name, data=EXCLUDED.data`,
			id, firstNonEmpty(dokployStr(item, "name"), id), raw)
		return err
	case "applications":
		id, ierr := dokployItemID(entity, item)
		if ierr != nil {
			return ierr
		}
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_applications(remote_id, project_remote_id, environment_remote_id, name, status, data)
VALUES ($1,NULLIF($2,''),NULLIF($3,''),$4,NULLIF($5,''),$6::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    project_remote_id=EXCLUDED.project_remote_id,
    environment_remote_id=EXCLUDED.environment_remote_id,
    name=EXCLUDED.name, status=EXCLUDED.status, data=EXCLUDED.data`,
			id, dokployStr(item, "projectId"), dokployStr(item, "environmentId"),
			firstNonEmpty(dokployStr(item, "name", "appName"), id),
			dokployStr(item, "applicationStatus", "status"), raw)
		return err
	case "composes":
		id, ierr := dokployItemID(entity, item)
		if ierr != nil {
			return ierr
		}
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_composes(remote_id, project_remote_id, name, status, data)
VALUES ($1,NULLIF($2,''),$3,NULLIF($4,''),$5::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    project_remote_id=EXCLUDED.project_remote_id, name=EXCLUDED.name,
    status=EXCLUDED.status, data=EXCLUDED.data`,
			id, dokployStr(item, "projectId"),
			firstNonEmpty(dokployStr(item, "name", "appName"), id),
			dokployStr(item, "composeStatus", "status"), raw)
		return err
	case "environments":
		id, ierr := dokployItemID(entity, item)
		if ierr != nil {
			return ierr
		}
		project := dokployStr(item, "projectId")
		if project == "" {
			return errValidation("environment item missing projectId") // column is NOT NULL
		}
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_environments(remote_id, project_remote_id, name, data)
VALUES ($1,$2,$3,$4::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    project_remote_id=EXCLUDED.project_remote_id, name=EXCLUDED.name, data=EXCLUDED.data`,
			id, project, firstNonEmpty(dokployStr(item, "name"), id), raw)
		return err
	case "domains":
		id, ierr := dokployItemID(entity, item)
		if ierr != nil {
			return ierr
		}
		// overview.domains rows carry serviceOwnerId+serviceOwnerType
		// ("application"/"compose"); dedicated domain endpoints may carry
		// applicationId/composeId directly.
		appRemote := dokployStr(item, "applicationId")
		composeRemote := dokployStr(item, "composeId")
		if owner := dokployStr(item, "serviceOwnerId"); owner != "" &&
			appRemote == "" && composeRemote == "" {
			if dokployStr(item, "serviceOwnerType") == "compose" {
				composeRemote = owner
			} else {
				appRemote = owner
			}
		}
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_domains(remote_id, application_remote_id, compose_remote_id, domain, data)
VALUES ($1,NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),$5::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    application_remote_id=EXCLUDED.application_remote_id,
    compose_remote_id=EXCLUDED.compose_remote_id,
    domain=EXCLUDED.domain, data=EXCLUDED.data`,
			id, appRemote, composeRemote,
			dokployStr(item, "host", "domain", "uniqueConfigKey"), raw)
		return err
	case "backups":
		id, ierr := dokployItemID(entity, item)
		if ierr != nil {
			return ierr
		}
		databaseRemote := firstNonEmpty(
			dokployStr(item, "databaseId"),
			dokployStr(item, "postgresId", "mysqlId", "mariadbId", "mongoId", "redisId", "libsqlId"))
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_backups(remote_id, db_type, database_remote_id, schedule, data)
VALUES ($1,NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),$5::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    db_type=EXCLUDED.db_type, database_remote_id=EXCLUDED.database_remote_id,
    schedule=EXCLUDED.schedule, data=EXCLUDED.data`,
			id,
			dokployStr(item, "dbType", "databaseType", "type"),
			databaseRemote,
			dokployStr(item, "schedule", "cron", "scheduleCron"), raw)
		return err
	case "deployments":
		id, ierr := dokployItemID(entity, item)
		if ierr != nil {
			return ierr
		}
		// resource_kind is NOT NULL and CHECK-constrained; sanitize anything
		// unexpected down to an inference from the id keys present.
		kind := dokployStr(item, "resourceKind", "kind", "type")
		switch kind {
		case "application", "compose", "server":
		default:
			switch {
			case dokployStr(item, "composeId") != "":
				kind = "compose"
			case dokployStr(item, "serverId") != "":
				kind = "server"
			default:
				kind = "application"
			}
		}
		resource := dokployStr(item, "applicationId", "composeId", "serverId")
		_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_deployments(remote_id, resource_kind, resource_remote_id, status, data)
VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    resource_kind=EXCLUDED.resource_kind,
    resource_remote_id=EXCLUDED.resource_remote_id,
    status=EXCLUDED.status, data=EXCLUDED.data`,
			id, kind, resource, dokployStr(item, "status", "deploymentStatus"), raw)
		return err
	default:
		return errValidation("unsupported sync entity: " + entity)
	}
}

// dokployUpsertDatabase persists one per-type database search item with
// db_type stamped from its source op. Key candidates are broad because every
// live search returned zero rows at probe time (shapes unverified); the full
// raw object is always preserved in data.
func (s *Server) dokployUpsertDatabase(ctx context.Context, dbType string, item map[string]any) error {
	raw, _ := json.Marshal(item)
	id := dokployStr(item, dbType+"Id", dbType+"ID", "databaseId", "id")
	if id == "" {
		return errValidation("item missing " + dbType + " database id")
	}
	_, err := s.db.Exec(ctx, `
INSERT INTO dokploy_databases(remote_id, db_type, project_remote_id, name, status, data)
VALUES ($1,$2,NULLIF($3,''),$4,NULLIF($5,''),$6::jsonb)
ON CONFLICT (remote_id) DO UPDATE SET
    db_type=EXCLUDED.db_type, project_remote_id=EXCLUDED.project_remote_id,
    name=EXCLUDED.name, status=EXCLUDED.status, data=EXCLUDED.data`,
		id, dbType, dokployStr(item, "projectId"),
		firstNonEmpty(dokployStr(item, "name", "appName", "databaseName"), id),
		dokployStr(item, "applicationStatus", "databaseStatus", "dbStatus", "status"), raw)
	return err
}

// dokployStr returns the first key present as a scalar string; numbers are
// formatted losslessly because upstream ids may be numeric.
func dokployStr(m map[string]any, keys ...string) string {
	for _, k := range keys {
		v, ok := m[k]
		if !ok || v == nil {
			continue
		}
		switch t := v.(type) {
		case string:
			return t
		case float64:
			if t == float64(int64(t)) {
				return strconv.FormatInt(int64(t), 10)
			}
			return strconv.FormatFloat(t, 'f', -1, 64)
		case bool:
			return strconv.FormatBool(t)
		}
	}
	return ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func truncateSnippet(b []byte) string {
	const max = 512
	if len(b) > max {
		return string(b[:max])
	}
	return string(b)
}

// ---- Mirror reads & cleanup ----

// adminDokployDBList lists local mirror rows for any known entity with
// ?limit&offset pagination (limit default 50, capped at 500).
func (s *Server) adminDokployDBList(c fiber.Ctx) error {
	entity := lower(strings.TrimSpace(c.Params("entity")))
	ent, ok := dokployEntities[entity]
	if !ok {
		keys := make([]string, 0, len(dokployEntities))
		for k := range dokployEntities {
			keys = append(keys, k)
		}
		return mw.WriteError(c, errValidation("unknown entity; supported: "+strings.Join(keys, ", ")))
	}

	limit := 50
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}

	ctx := c.Context()
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM `+ent.table).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}

	selects := make([]string, 0, len(ent.columns)+1)
	for _, col := range ent.columns {
		if col == "data" {
			continue
		}
		if col == "id" {
			selects = append(selects, `id::text`)
			continue
		}
		selects = append(selects, col+"::text")
	}
	selects = append(selects, `data::text AS __data`)
	rows, err := s.db.Query(ctx,
		`SELECT `+strings.Join(selects, ", ")+` FROM `+ent.table+` ORDER BY created_at ASC LIMIT $1 OFFSET $2`,
		limit, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	items := []map[string]any{}
	vals := make([]any, len(ent.columns)) // all text cols + __data
	ptrs := make([]any, len(vals))
	for rows.Next() {
		for i := range ptrs {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return mw.WriteError(c, err)
		}
		row := make(map[string]any, len(ent.columns))
		for i, col := range ent.columns {
			if col == "data" {
				var parsed any
				_ = json.Unmarshal([]byte(asString(vals[i])), &parsed)
				row["data"] = parsed
				continue
			}
			row[col] = asString(vals[i])
		}
		items = append(items, row)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.dokploy.db_list", "provider", nil, map[string]any{
		"entity": entity, "count": len(items),
	})
	return mw.JSON(c, 200, fiber.Map{
		"entity": entity, "items": items,
		"limit": limit, "offset": offset, "total": total,
	}, nil)
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	if v == nil {
		return ""
	}
	b, _ := v.([]byte)
	return string(b)
}

// adminDokployDBDelete removes one local mirror row by remote_id — used to
// clean orphans whose upstream record is already gone. Local-only: nothing
// is forwarded to Dokploy.
func (s *Server) adminDokployDBDelete(c fiber.Ctx) error {
	entity := lower(strings.TrimSpace(c.Params("entity")))
	ent, ok := dokployEntities[entity]
	if !ok {
		keys := make([]string, 0, len(dokployEntities))
		for k := range dokployEntities {
			keys = append(keys, k)
		}
		return mw.WriteError(c, errValidation("unknown entity; supported: "+strings.Join(keys, ", ")))
	}
	remoteID := strings.TrimSpace(c.Params("remote_id"))
	if remoteID == "" {
		return mw.WriteError(c, errValidation("remote_id path parameter is required"))
	}

	tag, err := s.db.Exec(c.Context(),
		`DELETE FROM `+ent.table+` WHERE remote_id=$1`, remoteID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeNotFound,
			"%s row %q not found", entity, remoteID))
	}
	s.admAuditMeta(c, "admin.dokploy.db_delete", "provider", nil, map[string]any{
		"entity": entity, "remote_id": remoteID,
	})
	return c.SendStatus(204)
}
