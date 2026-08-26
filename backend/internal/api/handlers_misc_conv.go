package api

import (
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/support"
)

func supportCreateTicketInput(orgID, userID uuid.UUID, in ticketInput) support.CreateTicketInput {
	return support.CreateTicketInput{
		OrganizationID: orgID,
		CreatedBy:      userID,
		Subject:        in.Subject,
		Category:       in.Category,
		Priority:       in.Priority,
		Body:           in.Body,
	}
}
