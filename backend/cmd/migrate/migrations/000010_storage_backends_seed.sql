-- Per-asset-category storage backends. Each asset type gets its OWN bucket,
-- endpoint and credentials row (credentials encrypted at rest via
-- credentials_ciphertext; NULL endpoint/credentials inherit the global R2_*
-- environment fallback resolved at runtime).
INSERT INTO object_storage_backends (code, name, driver, endpoint, region, bucket_name, enabled)
VALUES
  ('avatar',   'User avatar uploads',      's3', NULL, NULL, 'kilat-avatars',   true),
  ('document', 'Profile / KYC documents',  's3', NULL, NULL, 'kilat-documents', true),
  ('iso',      'Custom ISO images',        's3', NULL, NULL, 'kilat-isos',      true),
  ('ticket',   'Ticket attachments',       's3', NULL, NULL, 'kilat-tickets',   true),
  ('invoice',  'Invoice PDF documents',    's3', NULL, NULL, 'kilat-invoices',  true)
ON CONFLICT (code) DO NOTHING;
