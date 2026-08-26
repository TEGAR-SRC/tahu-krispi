package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "kilat.cloud/backend/pkg/errors"
	"kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Orders ----

var orderStatuses = map[string]bool{
	"draft": true, "pending_payment": true, "paid": true, "processing": true,
	"completed": true, "cancelled": true, "failed": true, "refunded": true,
}

type orderItemOut struct {
	ID             uuid.UUID       `json:"id"`
	ProductID      *uuid.UUID      `json:"product_id,omitempty"`
	PlanID         *uuid.UUID      `json:"plan_id,omitempty"`
	RegionID       *uuid.UUID      `json:"region_id,omitempty"`
	ServiceKind    string          `json:"service_kind"`
	Description    string          `json:"description"`
	Quantity       float64         `json:"quantity"`
	UnitPrice      float64         `json:"unit_price"`
	Subtotal       float64         `json:"subtotal"`
	BillingPeriod  string          `json:"billing_period,omitempty"`
	ResourceConfig json.RawMessage `json:"resource_config"`
	ProviderID     *uuid.UUID      `json:"provider_id,omitempty"`
}

type orderOut struct {
	ID             uuid.UUID         `json:"id"`
	PublicID       string            `json:"public_id"`
	OrganizationID uuid.UUID         `json:"organization_id"`
	Currency       string            `json:"currency"`
	Subtotal       float64           `json:"subtotal"`
	Discount       float64           `json:"discount"`
	Tax            float64           `json:"tax"`
	Total          float64           `json:"total"`
	Status         string            `json:"status"`
	Metadata       json.RawMessage   `json:"metadata"`
	CreatedAt      time.Time         `json:"created_at"`
	CompletedAt    *time.Time        `json:"completed_at,omitempty"`
	CancelledAt    *time.Time        `json:"cancelled_at,omitempty"`
	Items          []orderItemOut    `json:"items"`
	Invoices       []orderInvoiceOut `json:"invoices"`
}

type orderInvoiceOut struct {
	ID        uuid.UUID `json:"id"`
	PublicID  string    `json:"public_id"`
	Status    string    `json:"status"`
	Total     float64   `json:"total"`
	AmountDue float64   `json:"amount_due"`
}

const orderColumns = `id, public_id, organization_id, currency::text, subtotal::text,
	discount::text, tax::text, total::text, status::text, metadata,
	created_at, completed_at, cancelled_at`

func scanOrderRow(row pgx.Row) (*orderOut, error) {
	var o orderOut
	var subtotal, discount, tax, total string
	if err := row.Scan(&o.ID, &o.PublicID, &o.OrganizationID, &o.Currency,
		&subtotal, &discount, &tax, &total, &o.Status, &o.Metadata,
		&o.CreatedAt, &o.CompletedAt, &o.CancelledAt); err != nil {
		return nil, err
	}
	fmt.Sscanf(subtotal, "%f", &o.Subtotal)
	fmt.Sscanf(discount, "%f", &o.Discount)
	fmt.Sscanf(tax, "%f", &o.Tax)
	fmt.Sscanf(total, "%f", &o.Total)
	o.Items = []orderItemOut{}
	o.Invoices = []orderInvoiceOut{}
	return &o, nil
}

// orderItemsFor loads all items belonging to the given orders and groups them
// by order id.
func (s *Server) orderItemsFor(c fiber.Ctx, orderIDs []uuid.UUID) (map[uuid.UUID][]orderItemOut, error) {
	out := map[uuid.UUID][]orderItemOut{}
	if len(orderIDs) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(c.Context(), `
SELECT id, order_id, product_id, plan_id, region_id, service_kind::text, description,
       quantity, unit_price, subtotal::text, billing_period::text,
       resource_config, provider_id
FROM order_items WHERE order_id = ANY($1)`, orderIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			it          orderItemOut
			orderID     uuid.UUID
			qty, price  float64
			subtotalStr string
			billingPer  *string
		)
		if err := rows.Scan(&it.ID, &orderID, &it.ProductID, &it.PlanID, &it.RegionID,
			&it.ServiceKind, &it.Description, &qty, &price, &subtotalStr,
			&billingPer, &it.ResourceConfig, &it.ProviderID); err != nil {
			return nil, err
		}
		it.Quantity = qty
		it.UnitPrice = price
		fmt.Sscanf(subtotalStr, "%f", &it.Subtotal)
		if billingPer != nil {
			it.BillingPeriod = *billingPer
		}
		out[orderID] = append(out[orderID], it)
	}
	return out, rows.Err()
}

// orderInvoicesFor loads invoice references belonging to the given orders and
// groups them by order id.
func (s *Server) orderInvoicesFor(c fiber.Ctx, orderIDs []uuid.UUID) (map[uuid.UUID][]orderInvoiceOut, error) {
	out := map[uuid.UUID][]orderInvoiceOut{}
	if len(orderIDs) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(c.Context(), `
SELECT order_id, id, public_id, status::text, total::text, amount_due::text
FROM invoices WHERE order_id = ANY($1) ORDER BY created_at DESC`, orderIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			inv      orderInvoiceOut
			orderID  uuid.UUID
			totalStr string
			dueStr   string
		)
		if err := rows.Scan(&orderID, &inv.ID, &inv.PublicID, &inv.Status, &totalStr, &dueStr); err != nil {
			return nil, err
		}
		fmt.Sscanf(totalStr, "%f", &inv.Total)
		fmt.Sscanf(dueStr, "%f", &inv.AmountDue)
		out[orderID] = append(out[orderID], inv)
	}
	return out, rows.Err()
}

// handleListOrders returns the organization's orders, newest first, optionally
// filtered by ?status=<order_status>, paginated.
func (s *Server) handleListOrders(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	page, perPage := httputil.Page(c)

	args := []any{orgID}
	where := "organization_id=$1"
	if status := lower(c.Query("status")); status != "" {
		if !orderStatuses[status] {
			return mw.WriteError(c, vErrField("status", "invalid order status"))
		}
		args = append(args, status)
		where += fmt.Sprintf(" AND status=$%d", len(args))
	}

	var total int
	if err := s.db.QueryRow(c.Context(),
		"SELECT COUNT(*) FROM orders WHERE "+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}

	rows, err := s.db.Query(c.Context(),
		"SELECT "+orderColumns+" FROM orders WHERE "+where+" ORDER BY created_at DESC LIMIT $"+fmt.Sprint(len(args)+1)+" OFFSET $"+fmt.Sprint(len(args)+2),
		append(args, perPage, (page-1)*perPage)...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	orders := []*orderOut{}
	for rows.Next() {
		o, serr := scanOrderRow(rows)
		if serr != nil {
			return mw.WriteError(c, serr)
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}

	ids := make([]uuid.UUID, len(orders))
	for i, o := range orders {
		ids[i] = o.ID
	}
	itemsByOrder, err := s.orderItemsFor(c, ids)
	if err != nil {
		return mw.WriteError(c, err)
	}
	for _, o := range orders {
		if its, ok := itemsByOrder[o.ID]; ok {
			o.Items = its
		}
	}
	return httputil.OK(c, 200, orders, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

// handleGetOrder returns one organization order including its items.
// Accepts either the internal uuid or the public_id (ord_...) form.
func (s *Server) handleGetOrder(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	idParam := c.Params("order_id")
	where := "id=$1"
	if _, err := uuid.Parse(idParam); err != nil {
		if !strings.HasPrefix(idParam, "ord_") {
			return mw.WriteError(c, errValidation("invalid order id"))
		}
		where = "public_id=$1"
	}
	o, err := scanOrderRow(s.db.QueryRow(c.Context(),
		"SELECT "+orderColumns+" FROM orders WHERE "+where+" AND organization_id=$2", idParam, orgID))
	if err == pgx.ErrNoRows {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "order not found"))
	}
	if err != nil {
		return mw.WriteError(c, err)
	}
	orderID := o.ID
	itemsByOrder, err := s.orderItemsFor(c, []uuid.UUID{orderID})
	if err != nil {
		return mw.WriteError(c, err)
	}
	if its, ok := itemsByOrder[orderID]; ok {
		o.Items = its
	}
	invoicesByOrder, err := s.orderInvoicesFor(c, []uuid.UUID{orderID})
	if err != nil {
		return mw.WriteError(c, err)
	}
	if invs, ok := invoicesByOrder[orderID]; ok {
		o.Invoices = invs
	}
	return mw.JSON(c, 200, o, nil)
}

// handleCancelOrder cancels a draft/pending_payment/processing order, voids its
// unpaid invoices and writes an audit entry. Paid or completed orders are final.
func (s *Server) handleCancelOrder(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	userID := mustUserID(c)
	orderID, err := uuid.Parse(c.Params("order_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid order id"))
	}

	tx, err := s.db.Begin(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer tx.Rollback(c.Context())

	var status string
	err = tx.QueryRow(c.Context(),
		"SELECT status::text FROM orders WHERE id=$1 AND organization_id=$2 FOR UPDATE",
		orderID, orgID).Scan(&status)
	if err == pgx.ErrNoRows {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "order not found"))
	}
	if err != nil {
		return mw.WriteError(c, err)
	}
	switch status {
	case "draft", "pending_payment", "processing":
	default:
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeInvalidState,
			"order with status %q cannot be cancelled", status))
	}
	if _, err = tx.Exec(c.Context(),
		"UPDATE orders SET status='cancelled', cancelled_at=now() WHERE id=$1", orderID); err != nil {
		return mw.WriteError(c, fmt.Errorf("cancel order: %w", err))
	}
	if _, err = tx.Exec(c.Context(), `
UPDATE invoices SET status='void', voided_at=now()
WHERE order_id=$1 AND status IN ('unpaid','overdue') AND amount_paid=0`, orderID); err != nil {
		return mw.WriteError(c, fmt.Errorf("void order invoices: %w", err))
	}
	if err = tx.Commit(c.Context()); err != nil {
		return mw.WriteError(c, err)
	}

	s.auditSvc.Log(c.Context(), auditEntry(c, orgID, &userID, "order.cancel",
		"order", orderID, map[string]any{"previous_status": status}))

	o, err := scanOrderRow(s.db.QueryRow(c.Context(),
		"SELECT "+orderColumns+" FROM orders WHERE id=$1", orderID))
	if err == pgx.ErrNoRows {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "order not found"))
	}
	if err != nil {
		return mw.WriteError(c, err)
	}
	itemsByOrder, err := s.orderItemsFor(c, []uuid.UUID{orderID})
	if err != nil {
		return mw.WriteError(c, err)
	}
	if its, ok := itemsByOrder[orderID]; ok {
		o.Items = its
	}
	return mw.JSON(c, 200, o, nil)
}

// ---- Invoices ----

var invoiceStatuses = map[string]bool{
	"draft": true, "unpaid": true, "paid": true, "overdue": true,
	"void": true, "refunded": true, "partially_refunded": true,
}

type invoiceItemOut struct {
	ID          uuid.UUID       `json:"id"`
	Description string          `json:"description"`
	Quantity    float64         `json:"quantity"`
	UnitPrice   float64         `json:"unit_price"`
	Subtotal    float64         `json:"subtotal"`
	TaxAmount   float64         `json:"tax_amount"`
	Total       float64         `json:"total"`
	Metadata    json.RawMessage `json:"metadata"`
}

type invoiceOut struct {
	ID             uuid.UUID        `json:"id"`
	PublicID       string           `json:"public_id"`
	InvoiceNumber  string           `json:"invoice_number"`
	OrganizationID uuid.UUID        `json:"organization_id"`
	OrderID        *uuid.UUID       `json:"order_id,omitempty"`
	Currency       string           `json:"currency"`
	Subtotal       float64          `json:"subtotal"`
	Discount       float64          `json:"discount"`
	Tax            float64          `json:"tax"`
	Total          float64          `json:"total"`
	AmountPaid     float64          `json:"amount_paid"`
	AmountDue      float64          `json:"amount_due"`
	Status         string           `json:"status"`
	IssuedAt       *time.Time       `json:"issued_at,omitempty"`
	DueAt          *time.Time       `json:"due_at,omitempty"`
	PaidAt         *time.Time       `json:"paid_at,omitempty"`
	CreatedAt      time.Time        `json:"created_at"`
	PdfObjectID    *uuid.UUID       `json:"-"`
	PdfURL         string           `json:"pdf_url,omitempty"`
	Items          []invoiceItemOut `json:"items"`
}

const invoiceColumns = `id, public_id, invoice_number, organization_id, order_id,
	currency::text, subtotal::text, discount::text, tax::text, total::text,
	amount_paid::text, amount_due::text, status::text, issued_at, due_at, paid_at,
	created_at, pdf_object_id`

func scanInvoiceRow(row pgx.Row) (*invoiceOut, error) {
	var inv invoiceOut
	var subtotal, discount, tax, total, paid, due string
	err := row.Scan(&inv.ID, &inv.PublicID, &inv.InvoiceNumber, &inv.OrganizationID,
		&inv.OrderID, &inv.Currency, &subtotal, &discount, &tax, &total,
		&paid, &due, &inv.Status, &inv.IssuedAt, &inv.DueAt, &inv.PaidAt,
		&inv.CreatedAt, &inv.PdfObjectID)
	if err != nil {
		return nil, err
	}
	fmt.Sscanf(subtotal, "%f", &inv.Subtotal)
	fmt.Sscanf(discount, "%f", &inv.Discount)
	fmt.Sscanf(tax, "%f", &inv.Tax)
	fmt.Sscanf(total, "%f", &inv.Total)
	fmt.Sscanf(paid, "%f", &inv.AmountPaid)
	fmt.Sscanf(due, "%f", &inv.AmountDue)
	inv.Items = []invoiceItemOut{}
	return &inv, nil
}

// handleListInvoices returns the organization's invoices, newest first,
// optionally filtered by ?status=<invoice_status>, paginated.
func (s *Server) handleListInvoices(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	page, perPage := httputil.Page(c)

	args := []any{orgID}
	where := "organization_id=$1"
	if status := lower(c.Query("status")); status != "" {
		if !invoiceStatuses[status] {
			return mw.WriteError(c, vErrField("status", "invalid invoice status"))
		}
		args = append(args, status)
		where += fmt.Sprintf(" AND status=$%d", len(args))
	}

	var total int
	if err := s.db.QueryRow(c.Context(),
		"SELECT COUNT(*) FROM invoices WHERE "+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}

	rows, err := s.db.Query(c.Context(),
		"SELECT "+invoiceColumns+" FROM invoices WHERE "+where+
			fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2),
		append(args, perPage, (page-1)*perPage)...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	invoices := []*invoiceOut{}
	for rows.Next() {
		inv, serr := scanInvoiceRow(rows)
		if serr != nil {
			return mw.WriteError(c, serr)
		}
		invoices = append(invoices, inv)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, invoices, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

// invoiceItems loads the line items of a single invoice.
func (s *Server) invoiceItems(c fiber.Ctx, invoiceID uuid.UUID) ([]invoiceItemOut, error) {
	rows, err := s.db.Query(c.Context(), `
SELECT id, description, quantity, unit_price, subtotal::text,
       tax_amount::text, total::text, metadata
FROM invoice_items WHERE invoice_id=$1 ORDER BY id`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []invoiceItemOut{}
	for rows.Next() {
		var it invoiceItemOut
		var qty, price float64
		var subtotalStr, taxStr, totalStr string
		if err := rows.Scan(&it.ID, &it.Description, &qty, &price, &subtotalStr,
			&taxStr, &totalStr, &it.Metadata); err != nil {
			return nil, err
		}
		it.Quantity = qty
		it.UnitPrice = price
		fmt.Sscanf(subtotalStr, "%f", &it.Subtotal)
		fmt.Sscanf(taxStr, "%f", &it.TaxAmount)
		fmt.Sscanf(totalStr, "%f", &it.Total)
		items = append(items, it)
	}
	return items, rows.Err()
}

// pdfURL resolves the download URL for an invoice PDF: a presigned object
// storage URL when storage is configured and the object exists, otherwise the
// public download base link for the invoice.
func (s *Server) pdfURL(c fiber.Ctx, inv *invoiceOut) string {
	if inv.PdfObjectID == nil {
		return ""
	}
	fallback := s.cfg.DownloadBaseURL + "/invoices/" + inv.PublicID
	cl, _, err := s.objClientFor(c.Context(), "invoice")
	if err != nil {
		return fallback
	}
	var objectKey string
	err = s.db.QueryRow(c.Context(),
		"SELECT object_key FROM stored_objects WHERE id=$1 AND deleted_at IS NULL",
		*inv.PdfObjectID).Scan(&objectKey)
	if err != nil {
		return fallback
	}
	url, perr := cl.PresignedGet(c.Context(), objectKey, 15*time.Minute)
	if perr != nil {
		return fallback
	}
	return url
}

// handleGetInvoice returns one organization invoice including line items and
// pdf_url when a PDF has been generated for it.
func (s *Server) handleGetInvoice(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	invoiceID, err := uuid.Parse(c.Params("invoice_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid invoice id"))
	}
	inv, err := scanInvoiceRow(s.db.QueryRow(c.Context(),
		"SELECT "+invoiceColumns+" FROM invoices WHERE id=$1 AND organization_id=$2",
		invoiceID, orgID))
	if err == pgx.ErrNoRows {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "invoice not found"))
	}
	if err != nil {
		return mw.WriteError(c, err)
	}
	if inv.Items, err = s.invoiceItems(c, invoiceID); err != nil {
		return mw.WriteError(c, err)
	}
	inv.PdfURL = s.pdfURL(c, inv)
	return mw.JSON(c, 200, inv, nil)
}
