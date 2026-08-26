// Package config loads all application configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv          string
	AppPort         int
	RequestIDHeader string

	// Public domains (kilat-cloud.com)
	AppDomain        string
	PublicAPIBaseURL string // https://api.kilat-cloud.com
	ConsoleBaseURL   string // https://console.kilat-cloud.com
	DownloadBaseURL  string // https://dl.kilat-cloud.com

	DatabaseURL string
	RedisURL    string

	JWTSecret           string
	SecretEncryptionKey string // KEK for envelope-encrypting reversible credentials (TOTP secrets, provider tokens, storage keys)
	AccessTokenTTL      time.Duration
	RefreshTokenTTL     time.Duration

	Argon2Memory      uint32
	Argon2Iterations  uint32
	Argon2Parallelism uint8
	Argon2KeyLength   uint32
	Argon2SaltLength  uint32

	OnidelBaseURL string
	OnidelAPIKey  string

	R2Endpoint  string
	R2AccessKey string
	R2SecretKey string
	R2Bucket    string

	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	SMTPFrom     string

	PaymentProvider      string
	PaymentWebhookSecret string

	RateLimitLoginPerMinute  int
	RateLimitRegisterPerHour int

	OTPDebugEcho bool // development-only: return OTP in API response (no SMS/WhatsApp gateway configured yet)
	// AutoVerifyEmail activates accounts immediately after registration. Intended for
	// development/staging where SMTP is not configured; keep false in production.
	AutoVerifyEmail bool

	SubscriptionGraceDays int
}

func Load() (*Config, error) {
	cfg := &Config{
		AppEnv:                   getEnv("APP_ENV", "development"),
		AppPort:                  getEnvInt("APP_PORT", 8080),
		RequestIDHeader:          getEnv("REQUEST_ID_HEADER", "X-Request-ID"),
		AppDomain:                getEnv("APP_DOMAIN", "kilat-cloud.com"),
		PublicAPIBaseURL:         getEnv("PUBLIC_API_BASE_URL", "https://api.kilat-cloud.com"),
		ConsoleBaseURL:           getEnv("CONSOLE_BASE_URL", "https://console.kilat-cloud.com"),
		DownloadBaseURL:          getEnv("DOWNLOAD_BASE_URL", "https://dl.kilat-cloud.com"),
		DatabaseURL:              getEnvRequired("DATABASE_URL"),
		RedisURL:                 getEnvRequired("REDIS_URL"),
		JWTSecret:                getEnvRequired("JWT_SECRET"),
		SecretEncryptionKey:      getEnvRequired("SECRET_ENCRYPTION_KEY"),
		AccessTokenTTL:           getEnvDuration("ACCESS_TOKEN_TTL", 15*time.Minute),
		RefreshTokenTTL:          getEnvDuration("REFRESH_TOKEN_TTL", 30*24*time.Hour),
		Argon2Memory:             uint32(getEnvInt("ARGON2_MEMORY", 65536)),
		Argon2Iterations:         uint32(getEnvInt("ARGON2_ITERATIONS", 3)),
		Argon2Parallelism:        uint8(getEnvInt("ARGON2_PARALLELISM", 4)),
		Argon2KeyLength:          uint32(getEnvInt("ARGON2_KEY_LENGTH", 32)),
		Argon2SaltLength:         uint32(getEnvInt("ARGON2_SALT_LENGTH", 16)),
		OnidelBaseURL:            getEnv("ONIDEL_BASE_URL", "https://api.cloud.onidel.com"),
		OnidelAPIKey:             getEnv("ONIDEL_API_KEY", ""),
		R2Endpoint:               getEnv("R2_ENDPOINT", ""),
		R2AccessKey:              getEnv("R2_ACCESS_KEY", ""),
		R2SecretKey:              getEnv("R2_SECRET_KEY", ""),
		R2Bucket:                 getEnv("R2_BUCKET", ""),
		SMTPHost:                 getEnv("SMTP_HOST", ""),
		SMTPPort:                 getEnvInt("SMTP_PORT", 587),
		SMTPUser:                 getEnv("SMTP_USER", ""),
		SMTPPassword:             getEnv("SMTP_PASSWORD", ""),
		SMTPFrom:                 getEnv("SMTP_FROM", "noreply@kilat-cloud.com"),
		PaymentProvider:          getEnv("PAYMENT_PROVIDER", "midtrans"),
		PaymentWebhookSecret:     getEnvRequired("PAYMENT_WEBHOOK_SECRET"),
		RateLimitLoginPerMinute:  getEnvInt("RATE_LIMIT_LOGIN_PER_MINUTE", 10),
		RateLimitRegisterPerHour: getEnvInt("RATE_LIMIT_REGISTER_PER_HOUR", 20),
		OTPDebugEcho:             getEnv("OTP_DEBUG_ECHO", "false") == "true",
		AutoVerifyEmail:          getEnv("AUTO_VERIFY_EMAIL", "false") == "true",
		SubscriptionGraceDays:    getEnvInt("SUBSCRIPTION_GRACE_DAYS", 3),
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	var missing []string
	for k, v := range map[string]string{
		"DATABASE_URL":           c.DatabaseURL,
		"REDIS_URL":              c.RedisURL,
		"JWT_SECRET":             c.JWTSecret,
		"SECRET_ENCRYPTION_KEY":  c.SecretEncryptionKey,
		"PAYMENT_WEBHOOK_SECRET": c.PaymentWebhookSecret,
	} {
		if v == "" {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}
	return nil
}

func getEnv(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

func getEnvRequired(key string) string {
	return os.Getenv(key)
}

func getEnvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return i
}

func getEnvDuration(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}
