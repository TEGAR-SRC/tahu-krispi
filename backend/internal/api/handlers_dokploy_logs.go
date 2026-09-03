package api

import (
	"encoding/json"
	"net/url"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

func (s *Server) adminDokployLogs(c fiber.Ctx) error {
	cl, err := s.getDokployClient(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}

	tailStr := strings.TrimSpace(c.Query("tail", "100"))
	tail, perr := strconv.Atoi(tailStr)
	if perr != nil || tail < 1 {
		tail = 100
	}
	if tail > 10000 {
		tail = 10000
	}

	since := strings.TrimSpace(c.Query("since"))
	search := strings.TrimSpace(c.Query("search"))
	containerID := strings.TrimSpace(c.Query("containerId"))

	applicationID := strings.TrimSpace(c.Query("applicationId"))
	deploymentID := strings.TrimSpace(c.Query("deploymentId"))
	composeID := strings.TrimSpace(c.Query("composeId"))
	postgresID := strings.TrimSpace(c.Query("postgresId"))
	mysqlID := strings.TrimSpace(c.Query("mysqlId"))
	mariadbID := strings.TrimSpace(c.Query("mariadbId"))
	mongoID := strings.TrimSpace(c.Query("mongoId"))
	redisID := strings.TrimSpace(c.Query("redisId"))
	libsqlID := strings.TrimSpace(c.Query("libsqlId"))

	var opPath string
	q := url.Values{}
	q.Set("tail", strconv.Itoa(tail))
	if since != "" {
		q.Set("since", since)
	}
	if search != "" {
		q.Set("search", search)
	}

	switch {
	case deploymentID != "":
		opPath = "deployment.readLogs"
		q.Set("deploymentId", deploymentID)
	case applicationID != "":
		opPath = "application.readLogs"
		q.Set("applicationId", applicationID)
	case composeID != "":
		if containerID == "" {
			return mw.WriteError(c, errValidation("compose.readLogs requires containerId"))
		}
		opPath = "compose.readLogs"
		q.Set("composeId", composeID)
		q.Set("containerId", containerID)
	case postgresID != "":
		opPath = "postgres.readLogs"
		q.Set("postgresId", postgresID)
	case mysqlID != "":
		opPath = "mysql.readLogs"
		q.Set("mysqlId", mysqlID)
	case mariadbID != "":
		opPath = "mariadb.readLogs"
		q.Set("mariadbId", mariadbID)
	case mongoID != "":
		opPath = "mongo.readLogs"
		q.Set("mongoId", mongoID)
	case redisID != "":
		opPath = "redis.readLogs"
		q.Set("redisId", redisID)
	case libsqlID != "":
		opPath = "libsql.readLogs"
		q.Set("libsqlId", libsqlID)
	default:
		return mw.WriteError(c, errValidation("missing log target: provide deploymentId, applicationId, composeId+containerId, or database id (postgresId/mysqlId/mariadbId/mongoId/redisId/libsqlId)"))
	}

	status, payload, derr := cl.Do(c.Context(), fiber.MethodGet, opPath, q, nil)
	if derr != nil {
		return mw.WriteError(c, derr)
	}
	if status < 200 || status >= 300 {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"dokploy %s answered %d: %s", opPath, status, truncateSnippet(payload)))
	}

	logs := dokployUnwrapLogs(payload)

	return mw.JSON(c, 200, fiber.Map{"logs": logs, "tail": tail, "op": opPath}, nil)
}

func dokployUnwrapLogs(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var env struct {
		Result struct {
			Data struct {
				Json json.RawMessage `json:"json"`
			} `json:"data"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &env); err == nil && len(env.Result.Data.Json) > 0 {
		var s string
		if err := json.Unmarshal(env.Result.Data.Json, &s); err == nil {
			return s
		}
		if len(env.Result.Data.Json) > 0 && env.Result.Data.Json[0] == '"' {
			var raw string
			if err := json.Unmarshal(env.Result.Data.Json, &raw); err == nil {
				return raw
			}
		}
		return string(env.Result.Data.Json)
	}
	var s string
	if err := json.Unmarshal(body, &s); err == nil {
		return s
	}
	return string(body)
}
