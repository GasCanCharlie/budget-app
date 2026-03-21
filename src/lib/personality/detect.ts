import { getPersonalityMeta } from './registry'
import type {
  PersonalitySignals,
  PersonalityResult,
  CorePersonalityId,
  PremiumPersonalityId,
  TraitId,
} from './types'
import type { MasterKey } from '@/lib/categories/masters'

// ─── Premium detection ────────────────────────────────────────────────────────

function detectPremium(s: PersonalitySignals): PremiumPersonalityId | null {
  // Compounding Machine is disabled (needs multi-month data) — skip

  // Quiet Millionaire: high income, low spend, strong savings
  if (s.income >= 10000 && s.spendRatio < 0.5 && s.savingsRate > 0.4) {
    return 'quiet_millionaire'
  }

  // Strategic Deployer: high spend ratio but zero anomalies, no dominant category
  if (
    s.spendRatio >= 0.85 && s.spendRatio <= 0.95 &&
    s.anomalyCount === 0 &&
    s.catSpread < 10
  ) {
    return 'strategic_deployer'
  }

  return null
}

// ─── Core detection ───────────────────────────────────────────────────────────

function detectCore(s: PersonalitySignals): CorePersonalityId {
  // ── Universal overrides (run before statement-specific) ──────────────────

  // Full Send: spending exceeds income
  if (s.spendRatio > 1.05) return 'full_send'

  // Adrenaline Accountant: high anomalies + near-overspend (before chaos so it's more specific)
  if (s.anomalyCount >= 3 && s.spendRatio > 0.88) return 'adrenaline_accountant'

  // Chaos Controller: very high anomalies but net is okay
  if (s.anomalyCount >= 5 && s.net >= 0) return 'chaos_controller'

  // Breakeven Poet: net within 3% of income (near-zero, not negative)
  if (s.income > 0 && Math.abs(s.net) < s.income * 0.03) return 'breakeven_poet'

  // Wire Dancer: barely positive (0–5% surplus)
  if (s.net > 0 && s.income > 0 && s.net / s.income < 0.05) return 'wire_dancer'

  // Big Ticket Player: one category dominates
  if (s.topCatPct > 50) return 'big_ticket_player'

  // Subscription Collector
  if (s.subCount >= 5) return 'subscription_collector'

  // Low-Key Saver: keeps more than half
  if (s.spendRatio < 0.5 && s.net > 0) return 'low_key_saver'

  // ── Bank-specific ─────────────────────────────────────────────────────────

  if (s.statementType === 'bank') {
    // Overdraft Artist: dipped below but recovered (net < 0 or just above 0 with anomalies)
    if (s.net < 0 || (s.anomalyCount > 1 && s.spendRatio > 0.95)) return 'overdraft_artist'

    // Cash Keeper: very low spend ratio, healthy balance
    if (s.spendRatio < 0.4) return 'cash_keeper'

    // Direct Depositor: stable income, predictable spend, no anomalies
    if (s.anomalyCount === 0 && s.spendRatio >= 0.5 && s.spendRatio < 0.75) return 'direct_depositor'
  }

  // ── Credit-specific ───────────────────────────────────────────────────────

  if (s.statementType === 'credit') {
    // Minimum Payer: high utilization signal (most important caution)
    if (s.utilizationRate > 0.9) return 'minimum_payer'

    // Utilization King: consistently near limit
    if (s.utilizationRate > 0.75) return 'utilization_king'

    // Revolving Door: balance carried with interest
    if (s.balanceCarried && s.interestDetected) return 'revolving_door'

    // Balance Transfer: interest detected but may not have carried balance flag
    if (s.interestDetected) return 'balance_transfer'

    // One Card Wonder: very high category concentration (everything on one card)
    if (s.catSpread > 30) return 'one_card_wonder'

    // Cashback Architect: spread spending, paid in full, no balance
    if (!s.balanceCarried && s.catSpread < 15 && s.spendRatio > 0.7) return 'cashback_architect'

    // Points Chaser: high spend, diverse, paid in full
    if (!s.balanceCarried && s.spendRatio > 0.8) return 'points_chaser'
  }

  // ── Universal fallbacks ───────────────────────────────────────────────────

  // Safety Buffer: moderate saver, cushion in place
  if (s.spendRatio >= 0.5 && s.spendRatio < 0.72 && s.net > 0) return 'safety_buffer'

  // Smooth Operator: controlled, no anomalies
  if (s.net > 0 && s.anomalyCount === 0 && s.spendRatio < 0.8) return 'smooth_operator'

  // Flow Master: high income, high flow
  if (s.income > 5000 && s.spendRatio > 0.85) return 'flow_master'

  // Savvy Spender: positive net, reasonable spend
  if (s.net > 0 && s.spendRatio < 0.9) return 'savvy_spender'

  // Steady Builder: fallback
  return 'steady_builder'
}

// ─── Trait detection ──────────────────────────────────────────────────────────

// Maps master key → trait ID (v1: one mapping per master, no ambiguity)
const MASTER_TO_TRAIT: Partial<Record<MasterKey, TraitId>> = {
  FOOD:         'fork_and_knife',
  COFFEE:       'morning_stack',
  ENTERTAINMENT:'friday_flush',
  HEALTH:       'health_nut',
  TRANSPORT:    'gear_head',
  HOME:         'home_economist',
  TRAVEL:       'frequent_flyer',
  DIGITAL:      'digital_native',
  PERSONAL_CARE:'glow_up',
  EDUCATION:    'personal_cfo',
  BUSINESS:     'grind_setter',
  SOCIAL:       'social_butterfly',
  SHOPPING:     'glow_up',   // maps to glow_up in v1
  FINANCIAL:    'card_carrier',
}

function detectTrait(s: PersonalitySignals): { trait: TraitId | null; soft: TraitId | null } {
  const master = s.topCatMaster

  // No master = noisy/generic category, skip trait
  if (!master) return { trait: null, soft: null }

  // No mapping for FINANCIAL, LIFESTYLE, SYSTEM — skip trait
  const traitId = MASTER_TO_TRAIT[master]
  if (!traitId) return { trait: null, soft: null }

  const strongTrait = s.topCatPct >= 30 && s.catSpread >= 10
  const softTrait   = s.topCatPct >= 25 && s.topCatPct < 30

  if (strongTrait) return { trait: traitId, soft: null }
  if (softTrait)   return { trait: null, soft: traitId }

  return { trait: null, soft: null }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function detectPersonality(signals: PersonalitySignals): PersonalityResult {
  // 1. Premium check
  const premiumId = detectPremium(signals)
  if (premiumId) {
    const meta = getPersonalityMeta(premiumId)
    if (!meta.isDisabled) {
      return {
        premium: meta,
        core:    meta,   // premium replaces core in display
        display: meta.name,
      }
    }
  }

  // 2. Core
  const coreId   = detectCore(signals)
  const coreMeta = getPersonalityMeta(coreId)

  // 3. Trait
  const { trait: traitId, soft: softId } = detectTrait(signals)
  const traitMeta = traitId ? getPersonalityMeta(traitId) : undefined
  const softMeta  = softId  ? getPersonalityMeta(softId)  : undefined

  // 4. Display string
  const display = traitMeta
    ? `${coreMeta.name} · ${traitMeta.name}`
    : coreMeta.name

  return {
    core:      coreMeta,
    trait:     traitMeta,
    softTrait: softMeta,
    display,
  }
}
