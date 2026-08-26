// Package errors defines stable application error codes and a typed error.
package errors

import "fmt"

type Code string

const (
	CodeValidation          Code = "VALIDATION_ERROR"
	CodeEmailExists         Code = "EMAIL_ALREADY_EXISTS"
	CodePhoneExists         Code = "PHONE_ALREADY_EXISTS"
	CodeUsernameExists      Code = "USERNAME_ALREADY_EXISTS"
	CodeEmailNotVerified    Code = "EMAIL_NOT_VERIFIED"
	CodePhoneNotVerified    Code = "PHONE_NOT_VERIFIED"
	CodeInvalidCredentials  Code = "INVALID_CREDENTIALS"
	CodeAccountLocked       Code = "ACCOUNT_LOCKED"
	CodeUnauthorized        Code = "UNAUTHORIZED"
	CodeForbidden           Code = "FORBIDDEN"
	CodeNotFound            Code = "RESOURCE_NOT_FOUND"
	CodeConflict            Code = "CONFLICT"
	CodeInsufficientBalance Code = "INSUFFICIENT_BALANCE"
	CodeInvoiceAlreadyPaid  Code = "INVOICE_ALREADY_PAID"
	CodeQuoteExpired        Code = "QUOTE_EXPIRED"
	CodePlanUnavailable     Code = "PLAN_UNAVAILABLE"
	CodeRegionUnavailable   Code = "REGION_UNAVAILABLE"
	CodeLimitExceeded       Code = "RESOURCE_LIMIT_EXCEEDED"
	CodeProviderUnavailable Code = "PROVIDER_UNAVAILABLE"
	CodeRateLimited         Code = "PROVIDER_RATE_LIMITED"
	CodeProvisionFailed     Code = "PROVISION_FAILED"
	CodeInvalidState        Code = "INSTANCE_INVALID_STATE"
	CodeIdempotencyConflict Code = "IDEMPOTENCY_CONFLICT"
	CodeUnsupported         Code = "PROVIDER_UNSUPPORTED"
	CodeInternal            Code = "INTERNAL_ERROR"
)

// AppError carries a machine-readable code plus optional field errors.
type AppError struct {
	Code       Code
	Message    string
	Fields     map[string]string
	HTTPStatus int
}

func (e *AppError) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

func New(code Code, message string) *AppError {
	return &AppError{Code: code, Message: message, HTTPStatus: defaultStatus(code)}
}

func Newf(code Code, format string, args ...any) *AppError {
	return New(code, fmt.Sprintf(format, args...))
}

func WithFields(err *AppError, fields map[string]string) *AppError {
	e := *err
	e.Fields = fields
	return &e
}

func defaultStatus(c Code) int {
	switch c {
	case CodeValidation:
		return 400
	case CodeUnauthorized, CodeInvalidCredentials, CodeEmailNotVerified, CodePhoneNotVerified:
		return 401
	case CodeForbidden, CodeAccountLocked, CodeInsufficientBalance:
		return 403
	case CodeNotFound:
		return 404
	case CodeConflict, CodeEmailExists, CodePhoneExists, CodeUsernameExists,
		CodeInvoiceAlreadyPaid, CodeQuoteExpired, CodePlanUnavailable,
		CodeRegionUnavailable, CodeLimitExceeded, CodeInvalidState, CodeIdempotencyConflict:
		return 409
	case CodeRateLimited:
		return 429
	case CodeUnsupported:
		// The provider exists but does not implement the operation.
		return 501
	case CodeProviderUnavailable, CodeProvisionFailed:
		// Upstream/infrastructure failures: distinct from a bug in our own
		// code and retryable from the client's perspective.
		return 503
	default:
		return 500
	}
}
