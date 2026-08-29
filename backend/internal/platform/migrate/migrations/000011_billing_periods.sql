-- Multi-year billing periods (owner request): 2 / 3 / 5 years join the
-- existing hourly..annual ladder so plan prices, custom resource rates,
-- quotes and subscriptions all accept them.
ALTER TYPE app.billing_period ADD VALUE IF NOT EXISTS 'biennial' AFTER 'annual';
ALTER TYPE app.billing_period ADD VALUE IF NOT EXISTS 'triennial' AFTER 'biennial';
ALTER TYPE app.billing_period ADD VALUE IF NOT EXISTS 'quinquennial' AFTER 'triennial';
