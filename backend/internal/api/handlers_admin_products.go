// Admin products pricing API (revenue gap fix): object storage and reserved
// IPs are billed monthly at the price captured when their subscription is
// created. GET /admin/products is served by adminListProducts in
// handlers_admin_catalog.go and includes default_monthly_amount; this file
// owns PATCH /admin/products/{product_id}.
//
// IMPORTANT: changing default_monthly_amount affects ONLY FUTURE
// subscriptions — billing.AttachProductSubscription copies the effective
// charge into subscriptions.recurring_amount at attach time, so existing
// subscriptions keep renewing at their stored amount until cancelled.
package api

import (
	"errors"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

type admPatchProductInput struct {
	DefaultMonthlyAmount *float64 `json:"default_monthly_amount"`
	Enabled              *bool    `json:"enabled"`
	Description          *string  `json:"description"`
}

func (s *Server) adminPatchProduct(c fiber.Ctx) error {
	productID, err := admParseUUIDParam(c, "product_id", "product_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in admPatchProductInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	if in.DefaultMonthlyAmount == nil && in.Enabled == nil && in.Description == nil {
		return mw.WriteError(c, errValidation("nothing to update"))
	}
	if in.DefaultMonthlyAmount != nil && *in.DefaultMonthlyAmount < 0 {
		return mw.WriteError(c, vErrField("default_monthly_amount", "must be >= 0"))
	}
	if in.Description != nil && len(*in.Description) > 2000 {
		return mw.WriteError(c, vErrField("description", "must be at most 2000 characters"))
	}

	var p admProductRow
	var defAmt string
	err = s.db.QueryRow(c.Context(), `
UPDATE products SET
    default_monthly_amount=COALESCE($2, default_monthly_amount),
    enabled=COALESCE($3, enabled),
    description=COALESCE($4, description)
WHERE id=$1
RETURNING id, code::text, name, service_kind::text, COALESCE(description,''), enabled, sort_order,
          default_monthly_amount::text, created_at::text`,
		productID, in.DefaultMonthlyAmount, in.Enabled, in.Description).
		Scan(&p.ID, &p.Code, &p.Name, &p.ServiceKind, &p.Description, &p.Enabled, &p.SortOrder,
			&defAmt, &p.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "product not found"))
		}
		return mw.WriteError(c, err)
	}
	p.DefaultMonthlyAmount = admParseFloat(defAmt)

	s.admAuditMeta(c, "admin.product.updated", "product", &productID, map[string]any{
		"default_monthly_amount": in.DefaultMonthlyAmount,
		"enabled":                in.Enabled,
	})
	return mw.JSON(c, 200, p, nil)
}
