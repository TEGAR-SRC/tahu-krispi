// Package objectstorage wraps minio-go for Kilat Cloud's internal
// S3-compatible bucket (R2/S3/MinIO). It intentionally exposes only the
// operations needed by application services.
package objectstorage

import (
	"context"
	"io"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// storageErr converts transport-level failures into the stable
// PROVIDER_UNAVAILABLE application error while keeping the underlying detail.
func storageErr(op string, err error) error {
	return apperrors.Newf(apperrors.CodeProviderUnavailable, "object storage %s failed: %v", op, err)
}

// Client binds a minio.Client to a single bucket and ensures that bucket
// exists on construction.
type Client struct {
	mc     *minio.Client
	bucket string
}

// New creates a client for endpoint and guarantees bucket exists by probing
// with BucketExists first and creating it (MakeBucket) when missing, so the
// operation is idempotent across restarts.
func New(ctx context.Context, endpoint, accessKey, secretKey, region, bucket string, useSSL bool) (*Client, error) {
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
		Region: region,
	})
	if err != nil {
		return nil, storageErr("client init for "+endpoint, err)
	}
	exists, err := mc.BucketExists(ctx, bucket)
	if err != nil {
		return nil, storageErr("bucket probe "+bucket, err)
	}
	if !exists {
		if err = mc.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: region}); err != nil {
			return nil, storageErr("bucket create "+bucket, err)
		}
	}
	return &Client{mc: mc, bucket: bucket}, nil
}

// PutObject stores r under key and returns the resulting ETag.
func (c *Client) PutObject(ctx context.Context, key string, r io.Reader, size int64, contentType string) (string, error) {
	info, err := c.mc.PutObject(ctx, c.bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return "", storageErr("put "+key, err)
	}
	return info.ETag, nil
}

// PresignedGet returns a temporary download URL valid for ttl.
func (c *Client) PresignedGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	u, err := c.mc.PresignedGetObject(ctx, c.bucket, key, ttl, nil)
	if err != nil {
		return "", storageErr("presign get "+key, err)
	}
	return u.String(), nil
}

// PresignedPut returns a temporary upload URL valid for ttl.
func (c *Client) PresignedPut(ctx context.Context, key string, ttl time.Duration) (string, error) {
	u, err := c.mc.PresignedPutObject(ctx, c.bucket, key, ttl)
	if err != nil {
		return "", storageErr("presign put "+key, err)
	}
	return u.String(), nil
}

// Remove deletes the object under key; removing a missing key is not an error.
func (c *Client) Remove(ctx context.Context, key string) error {
	if err := c.mc.RemoveObject(ctx, c.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return storageErr("remove "+key, err)
	}
	return nil
}

// StatSize reports whether key exists along with its size in bytes. A missing
// object yields (0, false, nil); any other failure is an error.
func (c *Client) StatSize(ctx context.Context, key string) (int64, bool, error) {
	info, err := c.mc.StatObject(ctx, c.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		resp := minio.ToErrorResponse(err)
		if resp.Code == "NoSuchKey" || resp.Code == "NotFound" || resp.StatusCode == 404 {
			return 0, false, nil
		}
		return 0, false, storageErr("stat "+key, err)
	}
	return info.Size, true, nil
}
