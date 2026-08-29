// Types for the customer instances feature (verified against live API).
export interface CustomerInstance {
  id: string
  public_id?: string
  organization_id?: string
  provider_id?: string
  name: string
  status: string
  service_kind?: string
  power_status?: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  bandwidth_gb?: number | null
  primary_ipv4?: string
  primary_ipv6?: string
  currency?: string
  recurring_amount?: number
  created_at?: string
}

export interface Region {
  id: string
  code: string
  name: string
  country_code?: string
  city?: string
  enabled: boolean
}

export interface Plan {
  id: string
  code: string
  name: string
  description?: string
  product_id: string
  price_mode: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  bandwidth_gb?: number
  featured?: boolean
}

export interface InstanceType {
  id: string
  external_id?: string
  name: string
  category: string
  max_vcpu: number
  max_ram_mb: number
  max_disk_gb: number
  network_rate?: number
}

export interface PriceQuote {
  quote_id: string
  currency: string
  subtotal: number
  discount: number
  tax: number
  setup_fee?: number
  total: number
  billing_period?: string
}
