/**
 * AuditLens — TypeScript Type Definitions
 * Shared types for the entire frontend application.
 */

export interface LineItem {
  description: string
  englishDescription?: string
  quantity: number
  unitPrice: number
  total: number
}

export interface TaxDetail {
  type: string
  rate: number
  amount: number
}

export interface Document {
  id: string
  type: 'invoice' | 'purchase_order' | 'contract' | 'credit_note' | 'debit_note' | 'goods_receipt'
  documentName?: string
  vendor?: string
  vendorNormalized?: string
  vendorEnglish?: string
  amount: number
  subtotal: number
  taxDetails: TaxDetail[]
  totalTax: number
  issueDate?: string
  status: string
  lineItems: LineItem[]
  confidence: number
  confidenceFactors?: Record<string, unknown>
  extractionSource?: string
  extractedAt?: string
  currency: string
  locale?: string
  documentLanguage?: string
  paymentTerms?: string
  notes?: string
  uploadedBy?: string
  uploadedByEmail?: string

  // Type-specific
  invoiceNumber?: string
  poReference?: string
  dueDate?: string
  poNumber?: string
  deliveryDate?: string
  contractNumber?: string
  pricingTerms?: unknown[]
  contractTerms?: Record<string, unknown>
  grnNumber?: string
  receivedDate?: string
  documentNumber?: string

  // Triage
  triageLane?: string
  triageConfidence?: number
  triageReasons?: unknown[]
}

export interface Anomaly {
  id: string
  invoiceId?: string
  invoiceNumber?: string
  vendor?: string
  currency: string
  type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description?: string
  amount_at_risk: number
  contract_clause?: string
  recommendation?: string
  status: string
  detectedAt?: string
  resolvedAt?: string
  resolvedBy?: string
  aiExplanation?: string
  aiConfidence?: number
}

export interface Match {
  id: string
  invoiceId: string
  invoiceNumber?: string
  invoiceAmount: number
  invoiceSubtotal: number
  vendor?: string
  poId: string
  poNumber?: string
  poAmount: number
  matchScore: number
  signals: string[]
  amountDifference: number
  status?: string
  matchType: 'two_way' | 'three_way'
  grnStatus?: string
  grnIds?: string[]
  totalReceived?: number
  matchedAt?: string
}

export interface Case {
  id: string
  type: string
  title: string
  description?: string
  status: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  invoiceId?: string
  anomalyIds: string[]
  vendor?: string
  amountAtRisk: number
  currency: string
  createdAt?: string
  createdBy?: string
  assignedTo?: string
  sla?: Record<string, unknown>
  notes?: unknown[]
  investigationBrief?: string
}

export interface VendorProfile {
  vendor: string
  vendorNormalized?: string
  riskScore: number
  riskLevel: string
  riskTrend: string
  factors: Record<string, unknown>
  invoiceCount: number
  totalSpend: number
  openAnomalies: number
  totalAnomalies: number
}

export interface User {
  id: string
  email: string
  name: string
  role: string
  roleTitle?: string
}

export interface AppState {
  user: User | null
  token: string | null
  tab: string
  loading: boolean
  toast: { msg: string; type: 'success' | 'error' | 'info' } | null
  ps: {
    rc?: number    // rule count
    lc?: number    // language count
    ml?: string    // model label
    v?: string     // version
    auth?: Array<{ title: string; unlimited?: boolean; limit_usd?: number }>
    rules?: string[]
  }
  invoices: Document[]
  purchaseOrders: Document[]
  contracts: Document[]
  goodsReceipts: Document[]
  matches: Match[]
  anomalies: Anomaly[]
  cases: Case[]
  activityLog: unknown[]
  vendorProfiles: VendorProfile[]
}

export interface AuthorityLevel {
  title: string
  level: number
  limits: Record<string, number>
  unlimited?: boolean
}
