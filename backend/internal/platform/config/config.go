// Package config loads all application configuration from environment variables.
package config

import (
	"bufio"
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
	AppDomain           string
	PublicAPIBaseURL    string // https://api.kilat-cloud.com
	ConsoleBaseURL      string // https://console.kilat-cloud.com (user console)
	AdminConsoleBaseURL string // https://admin.kilat-cloud.com (staff console)
	AuthConsoleBaseURL  string // https://auth.kilat-cloud.com (standalone auth console)
	DownloadBaseURL     string // https://dl.kilat-cloud.com

	// Per-console API domains used for audience scoping. Each console only
	// reaches the endpoints its API domain is allowed to serve.
	AdminAPIDomain   string // https://api-admin.kilat-cloud.com
	UserAPIDomain    string // https://api-user.kilat-cloud.com
	AuthAPIDomain    string // https://api-auth.kilat-cloud.com (auth console only)
	LandingAPIDomain string // https://api-landing.kilat-cloud.com
	DocsAPIDomain    string // https://api-docs.kilat-cloud.com

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

	// OAuth (Google / GitHub). Empty means the provider is disabled — the
	// login button will still render but the backend will answer 503 with a
	// clear message instead of redirecting.
	GoogleClientID     string
	GoogleClientSecret string
	GithubClientID     string
	GithubClientSecret string

	PaymentProvider      string
	PaymentWebhookSecret string

	// SumoPod payment gateway (https://api-pay.sumopod.com)
	SumopodAPIKey        string
	SumopodBaseURL       string
	SumopodWebhookSecret string // whsec_... for svix signature
	SumopodWebhookToken  string // whtok_... for X-Webhook-Token

	RateLimitLoginPerMinute  int
	RateLimitRegisterPerHour int
	CORSAllowedOrigins       string // comma-separated list; defaults to known Kilat Cloud domains

	OTPDebugEcho bool // development-only: return OTP in API response (no SMS/WhatsApp gateway configured yet)
	// AutoVerifyEmail activates accounts immediately after registration. Intended for
	// development/staging where SMTP is not configured; keep false in production.
	AutoVerifyEmail bool

	SubscriptionGraceDays int
}

func Load() (*Config, error) {
	loadDotEnv(".env")
	cfg := &Config{
		AppEnv:                   getEnv("APP_ENV", "development"),
		AppPort:                  getEnvInt("APP_PORT", 8080),
		RequestIDHeader:          getEnv("REQUEST_ID_HEADER", "X-Request-ID"),
		AppDomain:                getEnv("APP_DOMAIN", "kilat-cloud.com"),
		PublicAPIBaseURL:         getEnv("PUBLIC_API_BASE_URL", "https://api.kilat-cloud.com"),
		ConsoleBaseURL:           getEnv("CONSOLE_BASE_URL", "https://console.kilat-cloud.com"),
		AdminConsoleBaseURL:      getEnv("ADMIN_CONSOLE_BASE_URL", "https://admin.kilat-cloud.com"),
		AuthConsoleBaseURL:       getEnv("AUTH_CONSOLE_BASE_URL", "https://auth.kilat-cloud.com"),
		DownloadBaseURL:          getEnv("DOWNLOAD_BASE_URL", "https://dl.kilat-cloud.com"),
		AdminAPIDomain:           getEnv("ADMIN_API_DOMAIN", "https://api-admin.kilat-cloud.com"),
		UserAPIDomain:            getEnv("USER_API_DOMAIN", "https://api-user.kilat-cloud.com"),
		AuthAPIDomain:            getEnv("AUTH_API_DOMAIN", "https://api-auth.kilat-cloud.com"),
		LandingAPIDomain:         getEnv("LANDING_API_DOMAIN", "https://api-landing.kilat-cloud.com"),
		DocsAPIDomain:            getEnv("DOCS_API_DOMAIN", "https://api-docs.kilat-cloud.com"),
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
		GoogleClientID:           getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:       getEnv("GOOGLE_CLIENT_SECRET", ""),
		GithubClientID:           getEnv("GITHUB_CLIENT_ID", ""),
		GithubClientSecret:       getEnv("GITHUB_CLIENT_SECRET", ""),
		PaymentProvider:          getEnv("PAYMENT_PROVIDER", "midtrans"),
		PaymentWebhookSecret:     getEnvRequired("PAYMENT_WEBHOOK_SECRET"),
		SumopodAPIKey:            getEnv("SUMOPOD_API_KEY", ""),
		SumopodBaseURL:           getEnv("SUMOPOD_BASE_URL", "https://api-pay.sumopod.com"),
		SumopodWebhookSecret:     getEnv("SUMOPOD_WEBHOOK_SECRET", ""),
		SumopodWebhookToken:      getEnv("SUMOPOD_WEBHOOK_TOKEN", ""),
		RateLimitLoginPerMinute:  getEnvInt("RATE_LIMIT_LOGIN_PER_MINUTE", 10),
		RateLimitRegisterPerHour: getEnvInt("RATE_LIMIT_REGISTER_PER_HOUR", 20),
		CORSAllowedOrigins:       getEnv("CORS_ALLOWED_ORIGINS", ""),
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

// CORSOrigins returns the configured CORS origins or a safe default
// covering the known Kilat Cloud domains. Each origin includes its scheme.
func (c *Config) CORSOrigins() string {
	if c.CORSAllowedOrigins != "" {
		return c.CORSAllowedOrigins
	}
	origins := []string{}
	add := func(url string) {
		if url != "" {
			origins = append(origins, url)
		}
	}
	add(c.PublicAPIBaseURL)
	add(c.ConsoleBaseURL)
	add(c.AdminConsoleBaseURL)
	add(c.AuthConsoleBaseURL)
	// AppDomain is bare (kilat-cloud.com); prefix with https:// for valid origin.
	if c.AppDomain != "" {
		origins = append(origins, "https://"+c.AppDomain)
	}
	// Localhost origins are useful for local development only; never expose
	// them as allowed origins in production.
	if c.AppEnv != "production" {
		origins = append(origins, []string{
			"http://localhost:8080",
			"http://localhost:5173",
		}...)
	}
	return strings.Join(origins, ",")
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

// loadDotEnv reads a .env file from path and exports its KEY=VALUE entries
// into the process environment. Variables already present in the environment
// take precedence (real env wins over the file). Lines starting with '#' and
// blank lines are ignored; surrounding whitespace and optional double quotes
// are stripped from values.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.Index(line, "=")
		if eq <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		val = strings.Trim(val, `"`)
		if key == "" {
			continue
		}
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
}
