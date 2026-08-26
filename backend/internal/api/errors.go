package api

import (
	"github.com/gofiber/fiber/v3"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// JSONError writes the standard error envelope for any error.
func JSONError(c fiber.Ctx, err error) error {
	status := 500
	code := "INTERNAL_ERROR"
	msg := "internal server error"
	var fields map[string]string
	if ae, ok := err.(*apperrors.AppError); ok {
		status = ae.HTTPStatus
		code = string(ae.Code)
		msg = ae.Message
		fields = ae.Fields
	} else if fe, ok := err.(*fiber.Error); ok {
		status = fe.Code
		code = "HTTP_ERROR"
		msg = fe.Message
	}
	reqID, _ := c.Locals("request_id").(string)
	return c.Status(status).JSON(fiber.Map{
		"error": fiber.Map{
			"code":    code,
			"message": msg,
			"fields":  fields,
		},
		"request_id": reqID,
	})
}
