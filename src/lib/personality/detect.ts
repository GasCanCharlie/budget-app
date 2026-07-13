import { getPersonalityMeta } from './registry'
import type {
  PersonalitySignals,
  PersonalityResults,
  RankedPersonality,
  CorePersonalityId,
  PremiumPersonalityId,
  TraitId,
} from './types'
import type { MasterKey } from '@/lib/categories/masters'

type AnyPersonalityId = CorePersonalityId | PremiumPersonalityId | TraitId

// All personality IDs to score (stable order for tie-breaking; excludes disabled & legacy traits)
const ALL_SCORED_IDS: AnyPersonalityId[] = [
  // Premium
  'quiet_millionaire', 'strategic_deployer',
  // Core — universal
  'full_send', 'adrenaline_accountant', 'chaos_controller',
  'breakeven_poet', 'wire_dancer', 'big_ticket_player',
  'subscription_collector', 'low_key_saver',
  // Core — bank
  'overdraft_artist', 'cash_keeper', 'direct_depositor',
  // Core — credit
  'minimum_payer', 'utilization_king', 'revolving_door',
  'balance_transfer', 'one_card_wonder', 'cashback_architect', 'points_chaser',
  // Core — universal fallbacks
  'safety_buffer', 'smooth_operator', 'flow_master', 'savvy_spender', 'steady_builder',
  // Discretionary traits
  'margin_eater', 'cash_casserole', 'drive_thru_cfo', 'dollar_shots', 'daily_grind',
  'never_home', 'delivery_doorstep', 'wellness_bill', 'free_trial_life', 'glowing_broke',
  'degree_debt', 'mail_goes_home', 'corner_office', 'burn_rate', 'heaven_sent',
  'currency_combustion', 'grind_setter',
]

// Discretionary trait → master keys that trigger it (corner_office appears in PETS and LIFESTYLE)
const TRAIT_MASTERS: Partial<Record<TraitId, MasterKey[]>> = {
  margin_eater:        ['FOOD'],
  cash_casserole:      ['GROCERY'],
  drive_thru_cfo:      ['FAST_FOOD'],
  dollar_shots:        ['ALCOHOL'],
  daily_grind:         ['COFFEE'],
  never_home:          ['ENTERTAINMENT'],
  delivery_doorstep:   ['SHOPPING'],
  wellness_bill:       ['HEALTH'],
  free_trial_life:     ['DIGITAL'],
  glowing_broke:       ['PERSONAL_CARE'],
  degree_debt:         ['EDUCATION'],
  mail_goes_home:      ['TRAVEL'],
  corner_office:       ['PETS', 'LIFESTYLE'],
  burn_rate:           ['TOBACCO'],
  heaven_sent:         ['SOCIAL'],
  currency_combustion: ['TRANSPORT'],
  grind_setter:        ['BUSINESS'],
}

// ─── Score one personality against signals ────────────────────────────────────

function scoreOne(
  id: AnyPersonalityId,
  s: PersonalitySignals,
): { score: number; rules: string[]; eligible: boolean } {
  const rules: string[] = []
  let score = 0
  let eligible = true

  const add = (pts: number, rule: string) => {
    score = Math.min(100, score + pts)
    rules.push(rule)
  }

  switch (id) {
    // ── PREMIUM ──────────────────────────────────────────────────────────────
    case 'quiet_millionaire':
      if (s.income >= 10000)       add(35, `income ${s.income.toFixed(0)} ≥ 10k`)
      if (s.spendRatio < 0.4)      add(40, `spendRatio ${s.spendRatio.toFixed(2)} < 0.4`)
      else if (s.spendRatio < 0.5) add(28, `spendRatio ${s.spendRatio.toFixed(2)} < 0.5`)
      if (s.savingsRate > 0.5)      add(25, `savingsRate ${s.savingsRate.toFixed(2)} > 0.5`)
      else if (s.savingsRate > 0.4) add(18, `savingsRate ${s.savingsRate.toFixed(2)} > 0.4`)
      break

    case 'strategic_deployer':
      if (s.spendRatio >= 0.85 && s.spendRatio <= 0.95)    add(40, `spendRatio ${s.spendRatio.toFixed(2)} in [0.85, 0.95]`)
      else if (s.spendRatio >= 0.80 && s.spendRatio < 0.85) add(20, `spendRatio ${s.spendRatio.toFixed(2)} near 0.85`)
      if (s.anomalyCount === 0)      add(35, 'zero anomalies')
      else if (s.anomalyCount === 1) add(15, 'one anomaly')
      if (s.catSpread < 10)      add(25, `catSpread ${s.catSpread.toFixed(0)} < 10`)
      else if (s.catSpread < 15) add(12, `catSpread ${s.catSpread.toFixed(0)} < 15`)
      break

    // ── CORE — Universal ─────────────────────────────────────────────────────
    case 'full_send':
      if (s.spendRatio > 1.2)       add(100, `spendRatio ${s.spendRatio.toFixed(2)} > 1.2`)
      else if (s.spendRatio > 1.1)  add(85,  `spendRatio ${s.spendRatio.toFixed(2)} > 1.1`)
      else if (s.spendRatio > 1.05) add(70,  `spendRatio ${s.spendRatio.toFixed(2)} > 1.05`)
      else if (s.spendRatio > 1.0)  add(45,  `spendRatio ${s.spendRatio.toFixed(2)} > 1.0`)
      break

    case 'adrenaline_accountant':
      if (s.anomalyCount >= 5)      add(50, `anomalies ${s.anomalyCount} ≥ 5`)
      else if (s.anomalyCount >= 3) add(35, `anomalies ${s.anomalyCount} ≥ 3`)
      else if (s.anomalyCount >= 1) add(15, `anomalies ${s.anomalyCount} ≥ 1`)
      if (s.spendRatio > 0.92)      add(40, `spendRatio ${s.spendRatio.toFixed(2)} > 0.92`)
      else if (s.spendRatio > 0.88) add(25, `spendRatio ${s.spendRatio.toFixed(2)} > 0.88`)
      break

    case 'chaos_controller':
      if (s.anomalyCount >= 8)      add(65, `anomalies ${s.anomalyCount} ≥ 8`)
      else if (s.anomalyCount >= 5) add(50, `anomalies ${s.anomalyCount} ≥ 5`)
      else if (s.anomalyCount >= 3) add(25, `anomalies ${s.anomalyCount} ≥ 3`)
      if (s.net >= 0)  add(30, `net ${s.net.toFixed(0)} ≥ 0`)
      else             add(15, 'net positive-ish despite anomalies')
      break

    case 'breakeven_poet':
      if (s.income > 0) {
        const ratio = Math.abs(s.net) / s.income
        if (ratio < 0.01)      add(95, `|net/income| ${(ratio * 100).toFixed(1)}% < 1%`)
        else if (ratio < 0.02) add(80, `|net/income| ${(ratio * 100).toFixed(1)}% < 2%`)
        else if (ratio < 0.03) add(60, `|net/income| ${(ratio * 100).toFixed(1)}% < 3%`)
        else if (ratio < 0.05) add(35, `|net/income| ${(ratio * 100).toFixed(1)}% < 5%`)
      }
      break

    case 'wire_dancer':
      if (s.income > 0 && s.net > 0) {
        const surplus = s.net / s.income
        if (surplus < 0.02)      add(95, `surplus ${(surplus * 100).toFixed(1)}% < 2%`)
        else if (surplus < 0.03) add(80, `surplus ${(surplus * 100).toFixed(1)}% < 3%`)
        else if (surplus < 0.05) add(65, `surplus ${(surplus * 100).toFixed(1)}% < 5%`)
        else if (surplus < 0.08) add(30, `surplus ${(surplus * 100).toFixed(1)}% < 8%`)
      }
      break

    case 'big_ticket_player': {
      // Don't fire on Income/Transfer/Uncategorized (null masterKey) or fixed obligations
      const BTP_EXCLUDED = new Set<string | null>([null, 'HOME', 'FINANCIAL'])
      if (BTP_EXCLUDED.has(s.topCatMaster)) break
      if (s.topCatPct > 70)      add(95, `topCatPct ${s.topCatPct.toFixed(0)}% > 70`)
      else if (s.topCatPct > 60) add(80, `topCatPct ${s.topCatPct.toFixed(0)}% > 60`)
      else if (s.topCatPct > 50) add(62, `topCatPct ${s.topCatPct.toFixed(0)}% > 50`)
      else if (s.topCatPct > 40) add(35, `topCatPct ${s.topCatPct.toFixed(0)}% > 40`)
      break
    }

    case 'subscription_collector':
      if (s.subCount >= 12)      add(95, `subCount ${s.subCount} ≥ 12`)
      else if (s.subCount >= 8)  add(80, `subCount ${s.subCount} ≥ 8`)
      else if (s.subCount >= 5)  add(62, `subCount ${s.subCount} ≥ 5`)
      else if (s.subCount >= 3)  add(35, `subCount ${s.subCount} ≥ 3`)
      else if (s.subCount >= 1)  add(12, `subCount ${s.subCount} ≥ 1`)
      break

    case 'low_key_saver':
      if (s.spendRatio < 0.3 && s.net > 0)      add(95, `spendRatio ${s.spendRatio.toFixed(2)} < 0.3`)
      else if (s.spendRatio < 0.4 && s.net > 0) add(80, `spendRatio ${s.spendRatio.toFixed(2)} < 0.4`)
      else if (s.spendRatio < 0.5 && s.net > 0) add(62, `spendRatio ${s.spendRatio.toFixed(2)} < 0.5`)
      break

    // ── CORE — Bank Specific ─────────────────────────────────────────────────
    case 'overdraft_artist':
      if (s.statementType !== 'bank') { eligible = false; break }
      if (s.net < -100)   add(60, `net ${s.net.toFixed(0)} < -100`)
      else if (s.net < 0) add(45, `net ${s.net.toFixed(0)} < 0`)
      if (s.anomalyCount > 2 && s.spendRatio > 0.95) add(40, `anomalies ${s.anomalyCount} + spendRatio > 0.95`)
      else if (s.anomalyCount > 1)                    add(20, `anomalies ${s.anomalyCount} > 1`)
      break

    case 'cash_keeper':
      if (s.statementType !== 'bank') { eligible = false; break }
      if (s.spendRatio < 0.25)      add(95, `spendRatio ${s.spendRatio.toFixed(2)} < 0.25`)
      else if (s.spendRatio < 0.35) add(80, `spendRatio ${s.spendRatio.toFixed(2)} < 0.35`)
      else if (s.spendRatio < 0.4)  add(62, `spendRatio ${s.spendRatio.toFixed(2)} < 0.4`)
      break

    case 'direct_depositor':
      if (s.statementType !== 'bank') { eligible = false; break }
      if (s.anomalyCount === 0)      add(40, 'zero anomalies')
      else if (s.anomalyCount === 1) add(18, 'one anomaly')
      if (s.spendRatio >= 0.50 && s.spendRatio < 0.65)  add(55, `spendRatio ${s.spendRatio.toFixed(2)} in [0.5, 0.65]`)
      else if (s.spendRatio >= 0.65 && s.spendRatio < 0.75) add(35, `spendRatio ${s.spendRatio.toFixed(2)} in [0.65, 0.75]`)
      break

    // ── CORE — Credit Specific ───────────────────────────────────────────────
    case 'minimum_payer':
      if (s.statementType !== 'credit') { eligible = false; break }
      if (s.utilizationRate > 0.95)      add(95, `utilization ${(s.utilizationRate * 100).toFixed(0)}% > 95`)
      else if (s.utilizationRate > 0.90) add(80, `utilization ${(s.utilizationRate * 100).toFixed(0)}% > 90`)
      else if (s.utilizationRate > 0.85) add(55, `utilization ${(s.utilizationRate * 100).toFixed(0)}% > 85`)
      break

    case 'utilization_king':
      if (s.statementType !== 'credit') { eligible = false; break }
      if (s.utilizationRate > 0.85)      add(80, `utilization ${(s.utilizationRate * 100).toFixed(0)}% > 85`)
      else if (s.utilizationRate > 0.75) add(62, `utilization ${(s.utilizationRate * 100).toFixed(0)}% > 75`)
      else if (s.utilizationRate > 0.65) add(38, `utilization ${(s.utilizationRate * 100).toFixed(0)}% > 65`)
      break

    case 'revolving_door':
      if (s.statementType !== 'credit') { eligible = false; break }
      if (s.balanceCarried)    add(50, 'balance carried')
      if (s.interestDetected)  add(50, 'interest detected')
      break

    case 'balance_transfer':
      if (s.statementType !== 'credit') { eligible = false; break }
      if (s.interestDetected && !s.balanceCarried) add(75, 'interest + no carried balance')
      else if (s.interestDetected)                 add(50, 'interest detected')
      break

    case 'one_card_wonder':
      if (s.statementType !== 'credit') { eligible = false; break }
      if (s.catSpread > 45)      add(95, `catSpread ${s.catSpread.toFixed(0)} > 45`)
      else if (s.catSpread > 35) add(80, `catSpread ${s.catSpread.toFixed(0)} > 35`)
      else if (s.catSpread > 25) add(62, `catSpread ${s.catSpread.toFixed(0)} > 25`)
      break

    case 'cashback_architect':
      if (s.statementType !== 'credit') { eligible = false; break }
      if (!s.balanceCarried)       add(30, 'no balance carried')
      if (s.catSpread < 10)        add(45, `catSpread ${s.catSpread.toFixed(0)} < 10`)
      else if (s.catSpread < 15)   add(28, `catSpread ${s.catSpread.toFixed(0)} < 15`)
      if (s.spendRatio > 0.8)      add(25, `spendRatio ${s.spendRatio.toFixed(2)} > 0.8`)
      else if (s.spendRatio > 0.7) add(15, `spendRatio ${s.spendRatio.toFixed(2)} > 0.7`)
      break

    case 'points_chaser':
      if (s.statementType !== 'credit') { eligible = false; break }
      if (!s.balanceCarried)           add(35, 'no balance carried')
      if (s.spendRatio > 0.9)          add(55, `spendRatio ${s.spendRatio.toFixed(2)} > 0.9`)
      else if (s.spendRatio > 0.8)     add(38, `spendRatio ${s.spendRatio.toFixed(2)} > 0.8`)
      break

    // ── CORE — Universal fallbacks ────────────────────────────────────────────
    case 'safety_buffer':
      if (s.spendRatio >= 0.50 && s.spendRatio < 0.65 && s.net > 0) add(70, `spendRatio ${s.spendRatio.toFixed(2)} in [0.5, 0.65]`)
      else if (s.spendRatio >= 0.65 && s.spendRatio < 0.72 && s.net > 0) add(55, `spendRatio ${s.spendRatio.toFixed(2)} in [0.65, 0.72]`)
      else if (s.net > 0 && s.spendRatio < 0.72) add(30, `positive net + spendRatio < 0.72`)
      break

    case 'smooth_operator':
      if (s.net > 0)                add(30, 'positive net')
      if (s.anomalyCount === 0)      add(40, 'zero anomalies')
      else if (s.anomalyCount === 1) add(18, 'one anomaly')
      if (s.spendRatio < 0.65)      add(30, `spendRatio ${s.spendRatio.toFixed(2)} < 0.65`)
      else if (s.spendRatio < 0.80) add(18, `spendRatio ${s.spendRatio.toFixed(2)} < 0.80`)
      break

    case 'flow_master':
      if (s.income > 8000)      add(55, `income ${s.income.toFixed(0)} > 8k`)
      else if (s.income > 5000) add(38, `income ${s.income.toFixed(0)} > 5k`)
      if (s.spendRatio > 0.90)      add(45, `spendRatio ${s.spendRatio.toFixed(2)} > 0.9`)
      else if (s.spendRatio > 0.85) add(28, `spendRatio ${s.spendRatio.toFixed(2)} > 0.85`)
      break

    case 'savvy_spender':
      if (s.net > 0)                add(45, 'positive net')
      if (s.spendRatio < 0.75)      add(35, `spendRatio ${s.spendRatio.toFixed(2)} < 0.75`)
      else if (s.spendRatio < 0.85) add(22, `spendRatio ${s.spendRatio.toFixed(2)} < 0.85`)
      else if (s.spendRatio < 0.90) add(12, `spendRatio ${s.spendRatio.toFixed(2)} < 0.90`)
      break

    case 'steady_builder':
      add(20, 'base fallback')
      if (s.net > 0)          add(20, 'positive net')
      if (s.anomalyCount <= 1) add(10, 'low anomalies')
      break

    // ── Discretionary Traits ─────────────────────────────────────────────────
    default: {
      const masters = TRAIT_MASTERS[id as TraitId]
      if (!masters) {
        // Legacy trait — no scoreable signal
        eligible = false
        break
      }

      // Sum the actual percentage across all matching master keys (e.g. corner_office: PETS + LIFESTYLE)
      const pct = masters.reduce((sum, m) => sum + (s.categoryPct[m] ?? 0), 0)

      // Only score if this category has meaningful spending
      if (pct < 5) break

      // Whether this is the top discretionary (bonus for dominance)
      const isTopDisc = !!s.topDiscretionaryCatMaster && masters.includes(s.topDiscretionaryCatMaster)
      const label = `${masters[0]} @ ${pct.toFixed(0)}%${isTopDisc ? ' (top disc)' : ''}`

      if (pct >= 50)      add(90, label)
      else if (pct >= 35) add(75, label)
      else if (pct >= 20) add(isTopDisc ? 55 : 40, label)
      else if (pct >= 10) add(isTopDisc ? 35 : 20, label)
      else                add(12, label)
      break
    }
  }

  return { score: Math.min(100, Math.max(0, score)), rules, eligible }
}

// ─── Public: rank all personalities by score ──────────────────────────────────

export function rankPersonalities(signals: PersonalitySignals): RankedPersonality[] {
  const scored = ALL_SCORED_IDS
    .map(id => {
      const meta = getPersonalityMeta(id)
      if (meta.isDisabled) return null
      const { score, rules, eligible } = scoreOne(id, signals)
      return { meta, score, rules, eligible }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score)

  const maxScore = scored[0]?.score ?? 1

  return scored.map((entry, i) => ({
    rank:            i + 1,
    meta:            entry.meta,
    score:           entry.score,
    normalizedScore: maxScore > 0 ? Math.round((entry.score / maxScore) * 100) : 0,
    matchedRules:    entry.rules,
    eligible:        entry.eligible,
  }))
}

// ─── Public: detect personality (single source of truth) ─────────────────────

export function detectPersonality(signals: PersonalitySignals): PersonalityResults {
  const ranked = rankPersonalities(signals)

  // #1 and #2 from eligible personalities with score > 0
  const eligible = ranked.filter(r => r.eligible && r.score > 0)

  // Guarantee at least a fallback (steady_builder always scores > 0)
  const main  = eligible[0] ?? ranked[0]
  const alter = eligible[1] ?? null

  const mainMeta  = main.meta
  const alterMeta = alter?.meta ?? null

  const display = alterMeta
    ? `${mainMeta.name} · ${alterMeta.name}`
    : mainMeta.name

  // #3 for hazing line on the card (only show if meaningfully scored)
  const soft3 = (eligible[2] && eligible[2].score > 15) ? eligible[2].meta : undefined

  return {
    // Canonical
    mainPersonality:     mainMeta,
    alterEgo:            alterMeta,
    rankedPersonalities: ranked,
    display,
    // Legacy compat
    core:      mainMeta,
    trait:     alterMeta ?? undefined,
    softTrait: soft3,
    premium:   mainMeta.isPremium ? mainMeta : undefined,
  }
}
