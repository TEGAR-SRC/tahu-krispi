// Package api assembles the HTTP API.
package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"kilat.cloud/backend/internal/affiliate"
	"kilat.cloud/backend/internal/apikey"
	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/auth"
	"kilat.cloud/backend/internal/billing"
	"kilat.cloud/backend/internal/catalog"
	"kilat.cloud/backend/internal/compute"
	"kilat.cloud/backend/internal/network"
	"kilat.cloud/backend/internal/notification"
	"kilat.cloud/backend/internal/organization"
	"kilat.cloud/backend/internal/payment"
	"kilat.cloud/backend/internal/platform/config"
	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/platform/logger"
	mailpkg "kilat.cloud/backend/internal/platform/mail"
	objstore "kilat.cloud/backend/internal/platform/objectstorage"
	"kilat.cloud/backend/internal/pricing"
	"kilat.cloud/backend/internal/provider"
	"kilat.cloud/backend/internal/provider/onidel"
	"kilat.cloud/backend/internal/provider/proxmox"
	"kilat.cloud/backend/internal/provider/vmware"
	"kilat.cloud/backend/internal/storage"
	"kilat.cloud/backend/internal/subscription"
	"kilat.cloud/backend/internal/support"
	"kilat.cloud/backend/internal/user"
	"kilat.cloud/backend/internal/wallet"
	"kilat.cloud/backend/internal/webhook"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

type Server struct {
	app          *fiber.App
	cfg          *config.Config
	log          *logger.Logger
	db           *pgxpool.Pool
	rdb          *goredis.Client
	authSvc      *auth.Service
	userSvc      *user.Service
	userRepo     *user.Repository
	mfaMgr       *user.MFAManager
	passkeyMgr   *user.PasskeyManager
	apikeySvc    *apikey.Service
	affiliateSvc *affiliate.Service
	catalogSvc   *catalog.Service
	computeSvc   *compute.Service
	orgSvc       *organization.Service
	pricingSvc   *pricing.Service
	billingSvc   *billing.Service
	paymentSvc   *payment.Service
	networkSvc   *network.Service
	storageSvc   *storage.Service
	subSvc       *subscription.Service
	supportSvc   *support.Service
	notifSvc     *notification.Service
	webhookSvc   *webhook.Service
	auditSvc     *audit.Service
	mailSender   *mailpkg.Sender
	prov         provider.ComputeProvider
	encKey       []byte
}

func NewServer(cfg *config.Config, log *logger.Logger, db *pgxpool.Pool, rdb *goredis.Client) (*Server, error) {
	authSvc := auth.NewService(db, rdb, cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	encKey := crypto.DeriveKey("kilat-secret-kek", cfg.SecretEncryptionKey)
	// WebAuthn Relying Party config derives from the existing public-domain
	// settings: RPID is the bare registrable domain, origins are where the
	// user/admin consoles run navigator.credentials.create().
	passkeyMgr, err := user.NewPasskeyManager(db, rdb, encKey, cfg.AppDomain, []string{cfg.ConsoleBaseURL, cfg.AdminConsoleBaseURL})
	if err != nil {
		return nil, err
	}
	onidelAdapter := onidel.NewAdapter(cfg.OnidelBaseURL, cfg.OnidelAPIKey)
	provider.Register(onidelAdapter)
	proxmox.RegisterFactoryFromDB(db, encKey)
	vmware.RegisterFactoryFromDB(db, encKey)

	s := &Server{
		cfg: cfg, log: log, db: db, rdb: rdb,
		encKey:       encKey,
		authSvc:      authSvc,
		userSvc:      user.NewService(db, rdb, authSvc, user.NewMFAManager(db, encKey), cfg),
		userRepo:     user.NewRepository(db),
		mfaMgr:       user.NewMFAManager(db, encKey),
		passkeyMgr:   passkeyMgr,
		apikeySvc:    apikey.NewService(db),
		affiliateSvc: affiliate.NewService(db),
		catalogSvc:   catalog.NewService(db),
		orgSvc:       organization.NewService(db),
		pricingSvc:   pricing.NewService(db),
		billingSvc:   billing.NewService(db, wallet.NewService(db)),
		paymentSvc:   payment.NewServiceWithSumopod(db, cfg.PaymentProvider, cfg.PaymentWebhookSecret, cfg.SumopodAPIKey, cfg.SumopodBaseURL, cfg.SumopodWebhookSecret, cfg.SumopodWebhookToken, cfg.ConsoleBaseURL),
		networkSvc:   network.NewService(db),
		storageSvc:   storage.NewService(db),
		subSvc:       subscription.NewService(db, cfg.SubscriptionGraceDays),
		supportSvc:   support.NewService(db),
		notifSvc:     notification.NewService(db),
		webhookSvc:   webhook.NewService(db),
		auditSvc:     audit.NewService(db),
		mailSender:   mailpkg.NewSender(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom),
	}
	s.prov = onidelAdapter
	mw.ServerErrorLogger = func(code, msg string) {
		log.Error("server error response", map[string]any{"error": msg, "detail": code})
	}
	s.computeSvc = compute.NewServiceWithBaseURL(db, onidelAdapter, cfg.DownloadBaseURL)
	app := fiber.New(fiber.Config{
		AppName:      "kilat-cloud-backend",
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		BodyLimit:    16 * 1024 * 1024,
		ErrorHandler: func(c fiber.Ctx, err error) error {
			if e, ok := err.(*apperrors.AppError); !ok || e.HTTPStatus >= 500 {
				s.log.Error("request failed", map[string]any{
					"method": c.Method(), "path": c.Path(), "error": err.Error(),
				})
			}
			return mw.WriteError(c, err)
		},
	})
	app.Use(recover.New())
	app.Use(mw.RequestID())
	app.Use(mw.SecurityHeaders())
	app.Use(s.resolveAudience)
	app.Use(s.enforceAudienceScope)
	app.Use(cors.New(cors.Config{
		AllowOrigins:     strings.Split(s.cfg.CORSOrigins(), ","),
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowHeaders:     []string{"Content-Type", "Authorization", "X-Request-ID", "X-Organization-ID"},
		AllowCredentials: true,
		MaxAge:           86400,
	}))
	app.Use(func(c fiber.Ctx) error {
		start := time.Now()
		err := c.Next()
		reqID, _ := c.Locals(mw.RequestIDKey).(string)
		s.log.Info(fmt.Sprintf("%s %s -> %d (%s) [%s]",
			c.Method(), c.Path(), c.Response().StatusCode(),
			time.Since(start).Round(time.Millisecond), reqID), nil)
		return err
	})
	s.app = app
	s.registerRoutes()
	s.InstallAttachmentUploadLimits()
	return s, nil
}

// storageFallback exposes the global R2_* environment values so purpose-scoped
// backend rows can inherit them when they do not override credentials.
func (s *Server) storageFallback() storage.FallbackStorage {
	return storage.FallbackStorage{
		Endpoint:  s.cfg.R2Endpoint,
		AccessKey: s.cfg.R2AccessKey,
		SecretKey: s.cfg.R2SecretKey,
		Bucket:    s.cfg.R2Bucket,
	}
}

// objClientFor resolves the dedicated object-storage backend registered for an
// asset category (avatar/document/iso/ticket/invoice) and returns its client
// plus backend id for stored_objects attribution.
func (s *Server) objClientFor(ctx context.Context, code string) (*objstore.Client, uuid.UUID, error) {
	id, cl, err := s.storageSvc.ResolveBackend(ctx, s.encKey, code, s.storageFallback())
	return cl, id, err
}

func (s *Server) registerRoutes() {
	v1 := s.app.Group("/v1")

	// Health endpoints (unauthenticated).
	s.app.Get("/healthz", func(c fiber.Ctx) error {
		return c.SendString("ok")
	})
	s.app.Get("/readyz", s.readyz)
	s.app.Get("/metrics", s.metrics)

	authLimiter := mw.RateLimit(s.rdb, "login", s.cfg.RateLimitLoginPerMinute, time.Minute)
	regLimiter := mw.RateLimit(s.rdb, "register", s.cfg.RateLimitRegisterPerHour, time.Hour)
	idem := s.idempotency()

	// ---- Auth & identity ----
	v1.Post("/auth/register", regLimiter, s.handleRegister)
	v1.Post("/auth/login", authLimiter, s.handleLogin)
	v1.Post("/auth/login/mfa", authLimiter, s.handleLoginMFA)
	v1.Post("/auth/passkey/begin-login", authLimiter, s.handleBeginPasskeyLogin)
	v1.Post("/auth/passkey/login", authLimiter, s.handlePasskeyLogin)
	v1.Get("/auth/oauth/:provider", s.handleOAuthLogin)
	v1.Get("/auth/oauth/:provider/callback", s.handleOAuthCallback)
	v1.Post("/auth/refresh", s.handleRefresh)
	v1.Post("/auth/logout", s.authAny(), s.handleLogout)
	v1.Post("/auth/logout-all", s.authAny(), s.handleLogoutAll)
	v1.Post("/auth/password/forgot", authLimiter, s.handleForgotPassword)
	v1.Post("/auth/password/reset", authLimiter, s.handleResetPassword)
	v1.Post("/auth/email/verify", s.handleVerifyEmail)
	v1.Post("/auth/email/resend", authLimiter, s.handleResendEmailVerification)

	v1.Get("/me", s.authAny(), s.handleMe)
	v1.Patch("/me/profile", s.authJWT(), s.handleUpdateProfile)
	v1.Post("/me/password/change", s.authJWT(), s.handleChangePassword)
	v1.Get("/me/sessions", s.authJWT(), s.handleListSessions)
	v1.Delete("/me/sessions/:session_id", s.authJWT(), s.handleRevokeSession)
	v1.Get("/me/security/events", s.authJWT(), s.handleListSecurityEvents)
	v1.Get("/me/resource-limits", s.authJWT(), s.handleGetResourceLimits)
	v1.Get("/me/profile-completion", s.authJWT(), s.handleProfileCompletion)
	v1.Post("/me/contact-change", s.authJWT(), s.handleRequestContactChange)
	v1.Post("/me/phone/otp/request", s.authJWT(), s.handleRequestPhoneOTP)
	v1.Post("/me/phone/otp/verify", s.authJWT(), s.handleVerifyPhoneOTP)
	v1.Post("/contact-change/confirm", s.handleConfirmContactChange)

	// MFA.
	v1.Get("/me/mfa", s.authJWT(), s.handleGetMFAStatus)
	v1.Post("/me/mfa/totp/setup", s.authJWT(), s.handleMFASetupTOTP)
	v1.Post("/me/mfa/totp/confirm", s.authJWT(), s.handleMFAConfirmTOTP)
	v1.Post("/me/mfa/totp/disable", s.authJWT(), s.handleMFADisable)
	v1.Post("/me/mfa/recovery-codes", s.authJWT(), s.handleRegenerateRecoveryCodes)

	// Passkeys (WebAuthn).
	v1.Get("/me/mfa/passkeys", s.authJWT(), s.handleListPasskeys)
	v1.Post("/me/mfa/passkeys/begin-registration", s.authJWT(), s.handleBeginPasskeyRegistration)
	v1.Post("/me/mfa/passkeys/register", s.authJWT(), s.handleRegisterPasskey)
	v1.Delete("/me/mfa/passkeys/:method_id", s.authJWT(), s.handleRemovePasskey)

	// API keys.
	v1.Get("/api-keys", s.authAny(), s.handleListAPIKeys)
	v1.Post("/api-keys", s.authAny(), idem, s.handleCreateAPIKey)
	v1.Get("/api-keys/:key_id", s.authAny(), s.handleGetAPIKey)
	v1.Patch("/api-keys/:key_id", s.authAny(), s.handleUpdateAPIKey)
	v1.Delete("/api-keys/:key_id", s.authAny(), s.handleRevokeAPIKey)
	v1.Post("/api-keys/:key_id/rotate", s.authAny(), s.handleRotateAPIKey)

	// User addresses.
	v1.Get("/me/addresses", s.authJWT(), s.handleListAddresses)
	v1.Post("/me/addresses", s.authJWT(), s.handleCreateAddress)
	v1.Patch("/me/addresses/:address_id", s.authJWT(), s.handleUpdateAddress)
	v1.Delete("/me/addresses/:address_id", s.authJWT(), s.handleDeleteAddress)
	v1.Post("/me/addresses/:address_id/default", s.authJWT(), s.handleSetDefaultAddress)

	// Profile files.
	v1.Post("/me/avatar", s.authJWT(), s.handleUploadAvatar)
	v1.Get("/me/avatar", s.authJWT(), s.handleGetAvatar)
	v1.Post("/me/documents", s.authJWT(), s.handleUploadDocument)
	v1.Get("/me/documents", s.authJWT(), s.handleListDocuments)

	// Catalog (public read).
	v1.Get("/regions", s.handleListRegions)
	v1.Get("/plans", s.handleListPlans)
	v1.Get("/instance-types", s.handleListInstanceTypes)
	v1.Get("/os-templates", s.handleListOSTemplates)

	// Landing / marketing content (public, published sections only).
	v1.Get("/landing", s.handlePublicLanding)
	// Documentation (public, published only).
	v1.Get("/docs", s.handlePublicDocs)
	v1.Get("/docs/:slug", s.handlePublicDocBySlug)
	// Blog (public, published only).
	v1.Get("/blog", s.handlePublicBlog)
	v1.Get("/blog/:slug", s.handlePublicBlogBySlug)
	// Public media (landing/docs images & logos).
	v1.Get("/media/:id", s.handleGetMedia)

	// Organizations.
	v1.Get("/organizations", s.authAny(), s.handleListOrganizations)
	v1.Post("/organizations", s.authJWT(), s.handleCreateOrganization)
	v1.Post("/organizations/:org_id/invitations", s.authJWT(), s.handleInviteMember)
	v1.Post("/organizations/invitations/accept", s.authJWT(), s.handleAcceptInvitation)

	// SSH keys / startup scripts.
	v1.Get("/ssh-keys", s.authAny(), s.withOrg(s.handleListSSHKeys))
	v1.Post("/ssh-keys", s.authAny(), s.withOrg(s.handleCreateSSHKey))
	v1.Patch("/ssh-keys/:key_id", s.authAny(), s.withOrg(s.handleUpdateSSHKey))
	v1.Delete("/ssh-keys/:key_id", s.authAny(), s.withOrg(s.handleDeleteSSHKey))
	v1.Get("/startup-scripts", s.authAny(), s.withOrg(s.handleListStartupScripts))
	v1.Post("/startup-scripts", s.authAny(), s.withOrg(s.handleCreateStartupScript))
	v1.Patch("/startup-scripts/:script_id", s.authAny(), s.withOrg(s.handleUpdateStartupScript))
	v1.Delete("/startup-scripts/:script_id", s.authAny(), s.withOrg(s.handleDeleteStartupScript))

	// Pricing.
	v1.Post("/pricing/quote", s.authAny(), s.handleQuote)

	// Billing.
	v1.Post("/orders", s.authAny(), idem, s.withOrg(s.handleCreateOrder))
	v1.Get("/orders", s.authAny(), s.withOrg(s.handleListOrders))
	v1.Get("/orders/:order_id", s.authAny(), s.withOrg(s.handleGetOrder))
	v1.Post("/orders/:order_id/cancel", s.authAny(), s.withOrg(s.handleCancelOrder))
	v1.Get("/invoices", s.authAny(), s.withOrg(s.handleListInvoices))
	v1.Get("/invoices/:invoice_id", s.authAny(), s.withOrg(s.handleGetInvoice))
	v1.Post("/invoices/:invoice_id/pay-wallet", s.authAny(), s.withOrg(s.handlePayInvoiceWithWallet))
	v1.Post("/invoices/:invoice_id/payments", s.authAny(), idem, s.withOrg(s.handleCreatePayment))
	v1.Post("/payments/webhook", s.handlePaymentWebhook)

	// Wallet.
	v1.Get("/wallet", s.authAny(), s.withOrg(s.handleWalletBalance))
	v1.Get("/wallet/transactions", s.authAny(), s.withOrg(s.handleWalletTransactions))
	v1.Post("/wallet/topup", s.authAny(), idem, s.withOrg(s.handleWalletTopup))

	// Subscriptions.
	v1.Get("/subscriptions", s.authAny(), s.withOrg(s.handleListSubscriptions))
	v1.Get("/subscriptions/:subscription_id", s.authAny(), s.withOrg(s.handleGetSubscription))
	v1.Post("/subscriptions/:subscription_id/cancel", s.authAny(), s.withOrg(s.handleCancelSubscription))

	// Instances.
	v1.Get("/instances", s.authAny(), s.withOrg(s.handleListInstances))
	v1.Get("/instances/:id", s.authAny(), s.withOrg(s.handleGetInstance))
	v1.Post("/instances", s.authAny(), idem, s.withOrg(s.handleProvisionInstance))
	v1.Patch("/instances/:id", s.authAny(), s.withOrg(s.handleUpdateInstance))
	v1.Delete("/instances/:id", s.authAny(), s.withOrg(s.handleTerminateInstance))
	v1.Post("/instances/:id/start", s.authAny(), s.withOrg(s.handleStartInstance))
	v1.Post("/instances/:id/stop", s.authAny(), s.withOrg(s.handleStopInstance))
	v1.Post("/instances/:id/reboot", s.authAny(), s.withOrg(s.handleRebootInstance))
	v1.Post("/instances/:id/resize", s.authAny(), s.withOrg(s.handleResizeInstance))
	v1.Post("/instances/:id/snapshot", s.authAny(), idem, s.withOrg(s.handleCreateSnapshot))
	v1.Post("/instances/:id/restore-snapshot", s.authAny(), s.withOrg(s.handleRestoreSnapshot))
	v1.Post("/instances/:id/restore-backup", s.authAny(), s.withOrg(s.handleRestoreBackup))
	v1.Post("/instances/:id/vnc", s.authAny(), s.withOrg(s.handleVNCSession))
	v1.Post("/instances/:id/serial-console", s.authAny(), s.withOrg(s.handleSerialConsole))
	v1.Post("/instances/:id/reset", s.authAny(), s.withOrg(s.handleInstancePowerAction("reset")))
	v1.Post("/instances/:id/pause", s.authAny(), s.withOrg(s.handleInstancePowerAction("pause")))
	v1.Post("/instances/:id/resume", s.authAny(), s.withOrg(s.handleInstancePowerAction("resume")))
	v1.Post("/instances/:id/hibernate", s.authAny(), s.withOrg(s.handleInstancePowerAction("hibernate")))
	v1.Get("/instances/:id/notes", s.authAny(), s.withOrg(s.handleGetInstanceNotes))
	v1.Put("/instances/:id/notes", s.authAny(), s.withOrg(s.handleUpdateInstanceNotes))
	v1.Get("/instances/:id/tags", s.authAny(), s.withOrg(s.handleGetInstanceTags))
	v1.Put("/instances/:id/tags", s.authAny(), s.withOrg(s.handleUpdateInstanceTags))
	v1.Get("/instances/:id/metrics", s.authAny(), s.withOrg(s.handleInstanceMetrics))
	v1.Get("/instances/:id/agent/osinfo", s.authAny(), s.withOrg(s.handleAgentOSInfo))
	v1.Get("/instances/:id/agent/fsinfo", s.authAny(), s.withOrg(s.handleAgentFSInfo))
	v1.Get("/instances/:id/agent/info", s.authAny(), s.withOrg(s.handleAgentInfo))
	v1.Post("/instances/:id/agent/ping", s.authAny(), s.withOrg(s.handleAgentPing))
	v1.Get("/instances/:id/firewall/rules", s.authAny(), s.withOrg(s.handleListVMFirewallRules))
	v1.Post("/instances/:id/firewall/rules", s.authAny(), s.withOrg(s.handleCreateVMFirewallRule))
	v1.Delete("/instances/:id/firewall/rules/:pos", s.authAny(), s.withOrg(s.handleDeleteVMFirewallRule))
	v1.Get("/instances/:id/firewall/options", s.authAny(), s.withOrg(s.handleGetVMFirewallOptions))
	v1.Put("/instances/:id/firewall/options", s.authAny(), s.withOrg(s.handleUpdateVMFirewallOptions))
	v1.Get("/instances/:id/firewall/ipsets", s.authAny(), s.withOrg(s.handleListVMFirewallIPSets))
	v1.Post("/instances/:id/firewall/ipsets", s.authAny(), s.withOrg(s.handleCreateVMFirewallIPSet))
	v1.Delete("/instances/:id/firewall/ipsets/:name", s.authAny(), s.withOrg(s.handleDeleteVMFirewallIPSet))
	v1.Get("/instances/:id/firewall/ipsets/:name/entries", s.authAny(), s.withOrg(s.handleListVMFirewallIPSetEntries))
	v1.Post("/instances/:id/firewall/ipsets/:name/entries", s.authAny(), s.withOrg(s.handleAddVMFirewallIPSetEntry))
	v1.Put("/instances/:id/firewall/ipsets/:name/entries/*", s.authAny(), s.withOrg(s.handleUpdateVMFirewallIPSetEntry))
	// The wildcard form matches cidr-in-path callers; the bare form serves the
	// documented DELETE .../entries?cidr= shape (cidr query stays mandatory).
	v1.Delete("/instances/:id/firewall/ipsets/:name/entries", s.authAny(), s.withOrg(s.handleRemoveVMFirewallIPSetEntry))
	v1.Delete("/instances/:id/firewall/ipsets/:name/entries/*", s.authAny(), s.withOrg(s.handleRemoveVMFirewallIPSetEntry))
	v1.Post("/instances/:id/attach-measured-boot", s.authAny(), s.withOrg(s.handleAttachMeasuredBoot))
	v1.Post("/instances/:id/detach-measured-boot", s.authAny(), s.withOrg(s.handleDetachMeasuredBoot))
	v1.Get("/snapshots", s.authAny(), s.withOrg(s.handleListSnapshots))
	v1.Post("/snapshots/:snapshot_id/download-url", s.authAny(), s.withOrg(s.handleGenSnapshotURL))
	v1.Delete("/snapshots/:snapshot_id", s.authAny(), s.withOrg(s.handleDeleteSnapshot))
	v1.Get("/backups", s.authAny(), s.withOrg(s.handleListBackups))
	v1.Post("/backups/:backup_id/download-url", s.authAny(), s.withOrg(s.handleGenBackupURL))

	// ISOs & measured boot images.
	v1.Get("/isos", s.authAny(), s.withOrg(s.handleListISOs))
	v1.Post("/isos", s.authAny(), s.withOrg(s.handleCreateISO))
	v1.Post("/isos/upload", s.authAny(), s.withOrg(s.handleUploadISO))
	v1.Post("/isos/:iso_id/retry", s.authAny(), s.withOrg(s.handleRetryISO))
	v1.Get("/isos/:iso_id", s.authAny(), s.withOrg(s.handleGetISO))
	v1.Delete("/isos/:iso_id", s.authAny(), s.withOrg(s.handleDeleteISO))
	v1.Get("/measured-boot-images", s.authAny(), s.withOrg(s.handleListMeasuredBootImages))
	v1.Post("/measured-boot-images", s.authAny(), s.withOrg(s.handleUploadMeasuredBootImage))
	v1.Delete("/measured-boot-images/:image_id", s.authAny(), s.withOrg(s.handleDeleteMeasuredBootImage))

	// Network.
	v1.Get("/vpcs", s.authAny(), s.withOrg(s.handleListVPCs))
	v1.Post("/vpcs", s.authAny(), s.withOrg(s.handleCreateVPC))
	v1.Patch("/vpcs/:vpc_id", s.authAny(), s.withOrg(s.handleUpdateVPC))
	v1.Delete("/vpcs/:vpc_id", s.authAny(), s.withOrg(s.handleDeleteVPC))
	v1.Get("/firewall-groups", s.authAny(), s.withOrg(s.handleListFirewalls))
	v1.Post("/firewall-groups", s.authAny(), s.withOrg(s.handleCreateFirewall))
	v1.Put("/firewall-groups/:firewall_id", s.authAny(), s.withOrg(s.handleUpdateFirewall))
	v1.Delete("/firewall-groups/:firewall_id", s.authAny(), s.withOrg(s.handleDeleteFirewall))
	v1.Get("/firewall-groups/:firewall_id/rules", s.authAny(), s.withOrg(s.handleListFirewallRules))
	v1.Post("/firewall-groups/:firewall_id/rules", s.authAny(), s.withOrg(s.handleCreateFirewallRule))
	v1.Patch("/firewall-groups/:firewall_id/rules/:rule_id", s.authAny(), s.withOrg(s.handleUpdateFirewallRule))
	v1.Delete("/firewall-groups/:firewall_id/rules/:rule_id", s.authAny(), s.withOrg(s.handleDeleteFirewallRule))
	v1.Get("/ip-lists", s.authAny(), s.withOrg(s.handleListIPLists))
	v1.Post("/ip-lists", s.authAny(), s.withOrg(s.handleCreateIPList))
	v1.Get("/ip-lists/:list_id", s.authAny(), s.withOrg(s.handleGetIPList))
	v1.Patch("/ip-lists/:list_id", s.authAny(), s.withOrg(s.handleUpdateIPList))
	v1.Delete("/ip-lists/:list_id", s.authAny(), s.withOrg(s.handleDeleteIPList))
	v1.Post("/ip-lists/:list_id/entries", s.authAny(), s.withOrg(s.handleAddIPListEntry))
	v1.Delete("/ip-lists/:list_id/entries/:entry_id", s.authAny(), s.withOrg(s.handleDeleteIPListEntry))
	v1.Get("/reserved-ips", s.authAny(), s.withOrg(s.handleListReservedIPs))
	v1.Post("/reserved-ips", s.authAny(), idem, s.withOrg(s.handleCreateReservedIP))
	v1.Post("/reserved-ips/convert", s.authAny(), s.withOrg(s.handleConvertReservedIP))
	v1.Delete("/reserved-ips/:rip_id", s.authAny(), s.withOrg(s.handleDeleteReservedIP))
	v1.Patch("/reserved-ips/:rip_id", s.authAny(), s.withOrg(s.handlePatchReservedIP))
	v1.Get("/instances/:id/rdns", s.authAny(), s.withOrg(s.handleListRDNS))
	v1.Post("/instances/:id/rdns", s.authAny(), s.withOrg(s.handleSetRDNS))
	v1.Delete("/instances/:id/rdns/*", s.authAny(), s.withOrg(s.handleDeleteRDNS))
	v1.Post("/instances/:id/enable-bgp", s.authAny(), s.withOrg(s.handleEnableBGP))
	v1.Post("/instances/:id/disable-bgp", s.authAny(), s.withOrg(s.handleDisableBGP))

	// Storage.
	v1.Post("/object-storage", s.authAny(), idem, s.withOrg(s.handleCreateStorageService))
	v1.Delete("/object-storage/:service_id", s.authAny(), s.withOrg(s.handleDeleteStorageService))
	v1.Get("/object-storage", s.authAny(), s.withOrg(s.handleListStorageServices))
	v1.Get("/object-storage/:service_id", s.authAny(), s.withOrg(s.handleGetStorageServiceDetail))
	v1.Get("/object-storage/:service_id/buckets", s.authAny(), s.withOrg(s.handleListBuckets))
	v1.Post("/object-storage/:service_id/buckets", s.authAny(), s.withOrg(s.handleCreateBucket))
	v1.Get("/object-storage/:service_id/buckets/:bucket_name/access_keys", s.authAny(), s.withOrg(s.handleListAccessKeys))

	// Support.
	v1.Get("/tickets", s.authAny(), s.withOrg(s.handleListTickets))
	v1.Post("/tickets", s.authAny(), s.withOrg(s.handleCreateTicket))
	v1.Get("/tickets/:ticket_id/messages", s.authAny(), s.withOrg(s.handleListTicketMessages))
	v1.Post("/tickets/:ticket_id/messages", s.authAny(), s.withOrg(s.handleReplyTicket))
	v1.Post("/tickets/:ticket_id/close", s.authAny(), s.withOrg(s.handleCloseTicket))
	v1.Post("/tickets/:ticket_id/messages/attachments", s.authAny(), s.withOrg(s.handleCreateTicketMessageAttachments))
	v1.Get("/tickets/:ticket_id/messages/:message_id/attachments/:attachment_id", s.authAny(), s.withOrg(s.handleGetTicketMessageAttachment))

	// Notifications.
	v1.Get("/notifications", s.authJWT(), s.handleListNotifications)
	v1.Post("/notifications/:notification_id/read", s.authJWT(), s.handleMarkNotificationRead)
	v1.Post("/notifications/read-all", s.authJWT(), s.handleMarkAllNotificationsRead)
	v1.Get("/notifications/preferences", s.authJWT(), s.handleGetNotificationPrefs)
	v1.Patch("/notifications/preferences", s.authJWT(), s.handleUpdateNotificationPrefs)

	// Webhooks.
	v1.Get("/webhooks", s.authAny(), s.withOrg(s.handleListWebhooks))
	v1.Post("/webhooks", s.authAny(), s.withOrg(s.handleCreateWebhook))
	v1.Delete("/webhooks/:webhook_id", s.authAny(), s.withOrg(s.handleDeleteWebhook))
	v1.Get("/webhook-deliveries", s.authAny(), s.withOrg(s.handleListWebhookDeliveries))

	// Dashboard.
	v1.Get("/dashboard/summary", s.authAny(), s.withOrg(s.handleDashboardSummary))

	// Audit.
	v1.Get("/audit-logs", s.authAny(), s.withOrg(s.handleListAuditLogs))

	// Affiliate / referral program.
	v1.Get("/me/affiliate", s.authJWT(), s.handleGetAffiliateDashboard)
	v1.Post("/me/affiliate/code", s.authJWT(), s.handleEnsureAffiliateCode)
	v1.Post("/me/affiliate/withdraw", s.authJWT(), s.handleAffiliateWithdraw)
	v1.Post("/affiliate/track/:code", s.handleTrackReferral)

	// Admin (platform admins only). Only reachable via the admin API domain.
	admin := v1.Group("/admin", s.authJWT(), s.allowAudiences(audienceAdmin))
	admin.Get("/users", s.requireStaff("users"), s.adminListUsers)
	admin.Patch("/users/:user_id/limits", s.requireStaff(""), s.adminUpdateUserLimits)
	admin.Get("/affiliate/settings", s.requireStaff("billing"), s.handleAdminGetAffiliateSettings)
	admin.Put("/affiliate/settings", s.requireStaff("billing"), s.handleAdminUpdateAffiliateSettings)
	admin.Get("/affiliate/earnings", s.requireStaff("billing"), s.handleAdminListAffiliateEarnings)
	admin.Post("/affiliate/earnings/:earning_id/reverse", s.requireStaff("billing"), s.handleAdminReverseAffiliateEarning)
	admin.Post("/users/:user_id/suspend", s.requireStaff(""), s.adminSuspendUser)
	admin.Post("/users/:user_id/activate", s.requireStaff(""), s.adminActivateUser)
	admin.Post("/users/:user_id/grant-admin", s.requireStaff(""), s.adminGrantAdmin)
	admin.Get("/organizations", s.requireStaff(""), s.adminListOrgs)
	admin.Post("/organizations/:org_id/suspend", s.requireStaff(""), s.adminSuspendOrg)
	admin.Put("/organizations/:org_id/provider-account", s.requireStaff("infra"), s.adminUpsertProviderAccount)
	admin.Get("/providers", s.requireStaff("auto"), s.adminListProviders)
	admin.Post("/providers", s.requireStaff("auto"), s.adminUpsertProvider)
	admin.Post("/providers/:provider_id/sync", s.requireStaff("auto"), s.adminTriggerProviderSync)
	admin.Delete("/providers/:provider_id", s.requireStaff("auto"), s.adminDeleteProvider)
	// Proxmox cluster observability (NOC): raw PVE inventory from the adapter's
	// helper methods; requireStaff("auto") resolves /providers GET to "infra".
	admin.Get("/providers/:provider_id/cluster", s.requireStaff("auto"), s.adminProviderCluster)
	admin.Get("/providers/:provider_id/containers", s.requireStaff("auto"), s.adminProviderContainers)
	admin.Get("/providers/:provider_id/nodes/:node/storages", s.requireStaff("auto"), s.adminProviderNodeStorages)
	admin.Get("/providers/:provider_id/nodes/:node/tasks", s.requireStaff("auto"), s.adminProviderNodeTasks)
	// VMware vSphere infrastructure inventory (NOC): raw vCenter hosts,
	// datastores, clusters and resource pools from the adapter helper, plus a
	// provider-agnostic guest performance endpoint shared with Proxmox.
	admin.Get("/providers/:provider_id/inventory", s.requireStaff("auto"), s.adminVMwareInventory)
	admin.Get("/providers/:provider_id/perf", s.requireStaff("auto"), s.adminProviderPerf)
	// Proxmox node & cluster operations (Fase 5B). requireStaff("auto") keeps
	// GET routes NOC-readable while mutations stay platform_admin-only.
	admin.Get("/providers/:provider_id/nodes/:node/detail", s.requireStaff("auto"), s.adminNodeDetail)
	admin.Get("/providers/:provider_id/nodes/:node/disks", s.requireStaff("auto"), s.adminNodeDisks)
	admin.Get("/providers/:provider_id/nodes/:node/certs", s.requireStaff("auto"), s.adminNodeCertificates)
	admin.Post("/providers/:provider_id/nodes/:node/command", s.requireStaff("auto"), s.adminNodeCommand)
	admin.Post("/providers/:provider_id/nodes/:node/backup", s.requireStaff("auto"), s.adminNodeBackup)
	admin.Get("/providers/:provider_id/storages/:storage/content", s.requireStaff("auto"), s.adminStorageContentList)
	admin.Delete("/providers/:provider_id/storages/:storage/content", s.requireStaff("auto"), s.adminDeleteStorageContent)
	admin.Get("/providers/:provider_id/storages/:storage/file-restore", s.requireStaff("auto"), s.adminBackupFileRestoreList)
	admin.Get("/providers/:provider_id/backup-jobs", s.requireStaff("auto"), s.adminListBackupJobs)
	admin.Post("/providers/:provider_id/backup-jobs", s.requireStaff("auto"), s.adminCreateBackupJob)
	admin.Put("/providers/:provider_id/backup-jobs/:job_id", s.requireStaff("auto"), s.adminUpdateBackupJob)
	admin.Delete("/providers/:provider_id/backup-jobs/:job_id", s.requireStaff("auto"), s.adminDeleteBackupJob)
	admin.Post("/providers/:provider_id/backup-jobs/:job_id/run", s.requireStaff("auto"), s.adminBackupJobRunNow)
	admin.Get("/providers/:provider_id/ha-resources", s.requireStaff("auto"), s.adminListHAResources)
	admin.Post("/providers/:provider_id/ha-resources", s.requireStaff("auto"), s.adminCreateHAResource)
	admin.Delete("/providers/:provider_id/ha-resources", s.requireStaff("auto"), s.adminDeleteHAResource)
	admin.Post("/providers/:provider_id/ha/arm", s.requireStaff("auto"), s.adminHAArm)
	admin.Post("/providers/:provider_id/ha/disarm", s.requireStaff("auto"), s.adminHADisarm)
	admin.Get("/providers/:provider_id/cluster/log", s.requireStaff("auto"), s.adminClusterLog)
	admin.Get("/providers/:provider_id/cluster/tasks", s.requireStaff("auto"), s.adminClusterTasks)
	admin.Get("/providers/:provider_id/fw-groups", s.requireStaff("auto"), s.adminListFWGroups)
	admin.Post("/providers/:provider_id/fw-groups", s.requireStaff("auto"), s.adminCreateFWGroup)
	admin.Delete("/providers/:provider_id/fw-groups", s.requireStaff("auto"), s.adminDeleteFWGroup)
	admin.Get("/providers/:provider_id/fw-groups/:group/rules", s.requireStaff("auto"), s.adminListFWGroupRules)
	admin.Post("/providers/:provider_id/fw-groups/:group/rules", s.requireStaff("auto"), s.adminCreateFWGroupRule)
	admin.Delete("/providers/:provider_id/fw-groups/:group/rules/:pos", s.requireStaff("auto"), s.adminDeleteFWGroupRule)
	admin.Get("/providers/:provider_id/firewall-rules", s.requireStaff("auto"), s.adminListClusterFirewallRules)
	admin.Post("/providers/:provider_id/firewall-rules", s.requireStaff("auto"), s.adminCreateClusterFirewallRule)
	admin.Delete("/providers/:provider_id/firewall-rules/:pos", s.requireStaff("auto"), s.adminDeleteClusterFirewallRule)
	admin.Get("/providers/:provider_id/pools", s.requireStaff("auto"), s.adminListPools)
	admin.Post("/providers/:provider_id/pools", s.requireStaff("auto"), s.adminCreatePool)
	admin.Put("/providers/:provider_id/pools/:pool_id", s.requireStaff("auto"), s.adminUpdatePool)
	admin.Delete("/providers/:provider_id/pools/:pool_id", s.requireStaff("auto"), s.adminDeletePool)
	admin.Put("/providers/:provider_id/pools/:pool_id/members", s.requireStaff("auto"), s.adminPoolUpdateMembers)
	admin.Get("/providers/:provider_id/ceph-status", s.requireStaff("auto"), s.adminCephStatus)
	admin.Get("/providers/:provider_id/sdn/zones", s.requireStaff("auto"), s.adminSDNZones)
	admin.Get("/providers/:provider_id/sdn/vnets", s.requireStaff("auto"), s.adminSDNVNets)
	// Adapter-only cluster storage, node resolver/clock and CPU model surface.
	admin.Get("/providers/:provider_id/cluster-storages", s.requireStaff("auto"), s.adminClusterStoragesList)
	admin.Post("/providers/:provider_id/cluster-storages", s.requireStaff("auto"), s.adminClusterStorageCreate)
	admin.Put("/providers/:provider_id/cluster-storages/:name", s.requireStaff("auto"), s.adminClusterStorageUpdate)
	admin.Delete("/providers/:provider_id/cluster-storages/:name", s.requireStaff("auto"), s.adminClusterStorageDelete)
	admin.Get("/providers/:provider_id/nodes/:node/dns", s.requireStaff("auto"), s.adminNodeDNSGet)
	admin.Put("/providers/:provider_id/nodes/:node/dns", s.requireStaff("auto"), s.adminNodeDNSSet)
	admin.Get("/providers/:provider_id/nodes/:node/time", s.requireStaff("auto"), s.adminNodeTimeGet)
	admin.Get("/providers/:provider_id/cpu-models", s.requireStaff("auto"), s.adminProviderCPUModels)
	admin.Get("/products", s.requireStaff("billing"), s.adminListProducts)
	admin.Post("/products", s.requireStaff("billing"), s.adminUpsertProduct)
	admin.Get("/plans", s.requireStaff("billing"), s.adminListPlansAdmin)
	admin.Post("/plans", s.requireStaff("billing"), s.adminUpsertPlan)
	admin.Patch("/products/:product_id", s.requireStaff("billing"), s.adminPatchProduct)
	admin.Get("/storage-backends", s.requireStaff("infra"), s.handleListStorageBackends)
	admin.Put("/storage-backends/:code", s.requireStaff("infra"), s.handleUpsertStorageBackend)
	admin.Delete("/storage-backends/:code", s.requireStaff("infra"), s.handleDisableStorageBackend)
	// Landing / marketing content editor (platform admin + NOC).
	admin.Get("/landing", s.requireStaff("marketing"), s.handleListLandingSections)
	admin.Post("/landing", s.requireStaff("marketing"), s.handleCreateLandingSection)
	admin.Put("/landing/:id", s.requireStaff("marketing"), s.handleUpdateLandingSection)
	admin.Delete("/landing/:id", s.requireStaff("marketing"), s.handleDeleteLandingSection)
	// Documentation editor (platform admin + NOC).
	admin.Get("/docs", s.requireStaff("marketing"), s.handleListDocs)
	admin.Post("/docs", s.requireStaff("marketing"), s.handleCreateDoc)
	admin.Put("/docs/:id", s.requireStaff("marketing"), s.handleUpdateDoc)
	admin.Delete("/docs/:id", s.requireStaff("marketing"), s.handleDeleteDoc)
	// Blog editor (platform admin + NOC).
	admin.Get("/blog", s.requireStaff("marketing"), s.handleListBlogPosts)
	admin.Post("/blog", s.requireStaff("marketing"), s.handleCreateBlogPost)
	admin.Put("/blog/:id", s.requireStaff("marketing"), s.handleUpdateBlogPost)
	admin.Delete("/blog/:id", s.requireStaff("marketing"), s.handleDeleteBlogPost)
	// Media uploads (logos/images) for landing & docs (platform admin + NOC).
	admin.Post("/media", s.requireStaff("marketing"), s.handleUploadMedia)
	admin.Get("/media", s.requireStaff("marketing"), s.handleListMedia)
	admin.Delete("/media/:id", s.requireStaff("marketing"), s.handleDeleteMedia)
	admin.Post("/plans/:plan_id/prices", s.requireStaff("billing"), s.adminUpsertPlanPrice)
	admin.Get("/custom-rates", s.requireStaff("billing"), s.adminListCustomRates)
	admin.Post("/custom-rates", s.requireStaff("billing"), s.adminUpsertCustomRate)
	admin.Get("/regions", s.requireStaff("billing"), s.adminListRegions)
	admin.Post("/regions", s.requireStaff("billing"), s.adminUpsertRegion)
	admin.Get("/coupons", s.requireStaff("billing"), s.adminListCoupons)
	admin.Post("/coupons", s.requireStaff("billing"), s.adminUpsertCoupon)
	admin.Delete("/coupons/:coupon_id", s.requireStaff("billing"), s.adminDeleteCoupon)
	admin.Get("/feature-flags/:key", s.requireStaff(""), s.adminGetFlag)
	admin.Put("/feature-flags/:key", s.requireStaff(""), s.adminSetFlag)
	admin.Get("/app-settings/:key", s.requireStaff(""), s.adminGetSetting)
	admin.Put("/app-settings/:key", s.requireStaff(""), s.adminSetSetting)
	admin.Get("/orders", s.requireStaff("billing"), s.adminListOrders)
	admin.Get("/orders/:order_id", s.requireStaff("billing"), s.handleAdminOrderDetail)
	admin.Get("/invoices/:invoice_id", s.requireStaff("billing"), s.handleAdminInvoiceDetail)
	admin.Get("/coupons/:coupon_id", s.requireStaff("billing"), s.handleAdminCouponDetail)
	admin.Post("/orders/:order_id/void", s.requireStaff("billing"), s.adminVoidOrder)
	admin.Get("/invoices", s.requireStaff("billing"), s.adminListInvoices)
	admin.Post("/invoices/:invoice_id/void", s.requireStaff("billing"), s.adminVoidInvoice)
	admin.Get("/payments", s.requireStaff("billing"), s.adminListPayments)
	admin.Get("/finance/summary", s.requireStaff("auto"), s.adminFinanceSummary)
	admin.Post("/wallets/:org_id/adjust", s.requireStaff("billing"), s.adminAdjustWallet)
	admin.Get("/instances", s.requireStaff("infra"), s.adminListInstances)
	admin.Get("/instances/:instance_id", s.requireStaff("infra"), s.handleAdminInstanceDetail)
	admin.Get("/jobs/:job_id", s.requireStaff("infra"), s.handleAdminJobDetail)
	admin.Post("/instances/:instance_id/suspend", s.requireStaff("infra"), s.adminSuspendInstance)
	admin.Post("/instances/:instance_id/unsuspend", s.requireStaff("infra"), s.adminUnsuspendInstance)
	admin.Post("/instances/:instance_id/terminate", s.requireStaff("infra"), s.adminForceTerminateInstance)
	admin.Post("/instances/:instance_id/clone", s.requireStaff("auto"), s.adminCloneInstance)
	admin.Post("/instances/:instance_id/template", s.requireStaff("auto"), s.adminConvertToTemplate)
	admin.Post("/instances/:instance_id/move-volume", s.requireStaff("auto"), s.adminMoveVolume)
	admin.Post("/instances/:instance_id/migrate", s.requireStaff("auto"), s.adminMigrateInstance)
	admin.Get("/jobs", s.requireStaff("infra"), s.adminListJobs)
	admin.Post("/jobs/:job_id/retry", s.requireStaff("infra"), s.adminRetryJob)
	admin.Post("/jobs/:job_id/cancel", s.requireStaff("infra"), s.adminCancelJob)
	admin.Get("/orphans", s.requireStaff("infra"), s.adminListOrphans)
	admin.Post("/orphans/:orphan_id/resolve", s.requireStaff("infra"), s.adminResolveOrphan)
	admin.Get("/security-incidents", s.requireStaff("infra"), s.adminListIncidents)
	admin.Post("/security-incidents/:incident_id/resolve", s.requireStaff("infra"), s.adminResolveIncident)
	admin.Get("/blocked-networks", s.requireStaff("infra"), s.adminListBlockedNetworks)
	admin.Post("/blocked-networks", s.requireStaff("infra"), s.adminAddBlockedNetwork)
	admin.Delete("/blocked-networks/:network_id", s.requireStaff("infra"), s.adminDeleteBlockedNetwork)
	admin.Get("/tickets", s.requireStaff("tickets"), s.adminListTickets)
	admin.Post("/tickets/:ticket_id/reply", s.requireStaff("tickets"), s.adminReplyTicket)
	admin.Post("/tickets/:ticket_id/reply/attachments", s.requireStaff("tickets"), s.adminReplyTicketAttachments)
	admin.Get("/tickets/:ticket_id/messages/:message_id/attachments/:attachment_id", s.requireStaff("tickets"), s.adminGetTicketMessageAttachment)
	admin.Post("/tickets/:ticket_id/assign", s.requireStaff("tickets"), s.adminAssignTicket)
	admin.Post("/tickets/:ticket_id/close", s.requireStaff("tickets"), s.adminCloseTicketStaff)
	admin.Get("/audit-logs", s.requireStaff(""), s.adminListAuditLogs)

	// Dokploy PaaS integration. The universal proxy relays every upstream
	// operation (/tag.method) verbatim; requireStaff("auto") resolves both
	// /dokploy prefixes to "" (platform_admin only) via staffAreaFor — the
	// proxy reaches server-level operations, so it must never leak to staff
	// roles or customers until org scoping lands. Mirror sync/read/delete are
	// admin-only by construction (they live under /admin).
	v1.All("/dokploy/*", s.authAny(), s.requireStaff("auto"), s.dokployProxy)
	admin.Post("/dokploy/sync", s.requireStaff("auto"), s.adminDokploySync)
	admin.Get("/dokploy/db/:entity", s.requireStaff("auto"), s.adminDokployDBList)
	admin.Delete("/dokploy/db/:entity/:remote_id", s.requireStaff("auto"), s.adminDokployDBDelete)
}

// withOrg extracts the organization id and verifies the user is a member with the given permission.
func (s *Server) withOrg(h fiber.Handler) fiber.Handler {
	return func(c fiber.Ctx) error {
		orgIDStr := c.Get("X-Organization-ID")
		if orgIDStr == "" {
			orgIDStr = c.Query("organization_id")
		}
		if orgIDStr == "" {
			return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "missing organization context (set X-Organization-ID header)"))
		}
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			return mw.WriteError(c, errInvalidOrganizationID())
		}
		userIDStr, _ := c.Locals(auth.LocalsUserID).(string)
		userID, _ := uuid.Parse(userIDStr)
		c.Locals("org_id", orgID.String())
		c.Locals("user_id_uuid", userID)
		return h(c)
	}
}

func (s *Server) readyz(c fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.Context(), 3*time.Second)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		return fiber.NewError(503, "postgres not ready")
	}
	if err := s.rdb.Ping(ctx).Err(); err != nil {
		return fiber.NewError(503, "redis not ready")
	}
	return c.SendString("ready")
}

func (s *Server) metrics(c fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"uptime_seconds": int(time.Since(startTime).Seconds()),
	})
}

var startTime = time.Now()

// Listen starts the HTTP server.
func (s *Server) Listen() error {
	return s.app.Listen(fmt.Sprintf(":%d", s.cfg.AppPort))
}

// App exposes the underlying fiber app for graceful shutdown.
func (s *Server) App() *fiber.App { return s.app }
