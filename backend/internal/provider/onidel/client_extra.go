// client_extra.go adds Onidel API operations that were not part of the
// original client.go: SSH key updates, measured boot image upload, per-VM
// backups and object storage service details.
package onidel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
)

// UpdateSSHKey PATCHes /ssh_keys/{id} to change an SSH key's name and/or
// public key material. Per OpenAPI the body requires team_id, name and ssh_key.
func (c *Client) UpdateSSHKey(ctx context.Context, sshKeyID, teamID, name, publicKey string) error {
	body := map[string]string{"team_id": teamID, "name": name, "ssh_key": publicKey}
	return c.do(ctx, http.MethodPatch, "/ssh_keys/"+sshKeyID, body, nil)
}

// UploadMeasuredBootImage POSTs a UKI (unified kernel image) file to
// /measured-boot-images as multipart/form-data with fields file, team_id and
// description. Exactly size bytes are read from data.
func (c *Client) UploadMeasuredBootImage(ctx context.Context, teamID, filename, description string, data io.Reader, size int64) (*MeasuredBootImage, error) {
	if filename == "" {
		return nil, fmt.Errorf("onidel: measured boot upload requires a filename")
	}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("team_id", teamID); err != nil {
		return nil, err
	}
	if description != "" {
		if err := mw.WriteField("description", description); err != nil {
			return nil, err
		}
	}
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return nil, err
	}
	if _, err := io.CopyN(part, data, size); err != nil {
		return nil, fmt.Errorf("onidel: reading measured boot image: %w", err)
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/measured-boot-images", &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Token "+c.apiKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("onidel request: %w", err)
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 400 {
		return nil, &APIError{StatusCode: resp.StatusCode, Body: string(respBytes)}
	}
	var img MeasuredBootImage
	if len(respBytes) > 0 {
		if err := json.Unmarshal(respBytes, &img); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}
	}
	return &img, nil
}

// GetVMBackups GETs /vm/{id}/backups and returns all backups of that VM.
func (c *Client) GetVMBackups(ctx context.Context, vmID, teamID string) ([]Backup, error) {
	path := "/vm/" + vmID + "/backups"
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var backups []Backup
	err := c.do(ctx, http.MethodGet, path, nil, &backups)
	return backups, err
}

// ObjectStorageServiceDetail is an object storage service enriched with its
// billing amount and transfer usage counters (allOf in the OpenAPI schema).
type ObjectStorageServiceDetail struct {
	ObjectStorageService
	RecurringAmount float64 `json:"recurring_amount"`
	DownloadUsage   int64   `json:"download_usage"` // bytes
	UploadUsage     int64   `json:"upload_usage"`   // bytes
}

// GetObjectStorageServiceDetail GETs /object-storage/{service_id} and returns
// the detailed view of one object storage service.
func (c *Client) GetObjectStorageServiceDetail(ctx context.Context, serviceID, teamID string) (*ObjectStorageServiceDetail, error) {
	path := "/object-storage/" + serviceID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var svc ObjectStorageServiceDetail
	err := c.do(ctx, http.MethodGet, path, nil, &svc)
	if err != nil {
		return nil, err
	}
	return &svc, nil
}
