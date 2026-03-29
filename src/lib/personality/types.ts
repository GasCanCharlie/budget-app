import type { MasterKey } from '@/lib/categories/masters'

export type PersonalityTier = 'premium' | 'core' | 'trait'

export type CorePersonalityId =
  // Universal
  | 'full_send'
  | 'wire_dancer'
  | 'breakeven_poet'
  | 'adrenaline_accountant'
  | 'chaos_controller'
  | 'big_ticket_player'
  | 'subscription_collector'
  | 'low_key_saver'
  | 'safety_buffer'
  | 'smooth_operator'
  | 'savvy_spender'
  | 'flow_master'
  | 'steady_builder'
  // Bank-specific
  | 'overdraft_artist'
  | 'cash_keeper'
  | 'direct_depositor'
  // Credit-specific
  | 'revolving_door'
  | 'points_chaser'
  | 'minimum_payer'
  | 'cashback_architect'
  | 'one_card_wonder'
  | 'utilization_king'
  | 'balance_transfer'

export type PremiumPersonalityId =
  | 'quiet_millionaire'
  | 'strategic_deployer'
  | 'compounding_machine'  // future — stubbed

export type TraitId =
  // Legacy traits (kept for compatibility)
  | 'fork_and_knife'
  | 'friday_flush'
  | 'health_nut'
  | 'morning_stack'
  | 'gear_head'
  | 'home_economist'
  | 'nest_builder'
  | 'frequent_flyer'
  | 'night_owl'
  | 'glow_up'
  | 'grind_setter'
  | 'digital_native'
  | 'personal_cfo'
  | 'social_butterfly'
  | 'card_carrier'
  // Discretionary spending traits
  | 'margin_eater'       // FOOD
  | 'cash_casserole'     // GROCERY
  | 'drive_thru_cfo'     // FAST_FOOD
  | 'liquid_assets'      // ALCOHOL
  | 'daily_grind'        // COFFEE
  | 'never_home'         // ENTERTAINMENT
  | 'delivery_regular'   // SHOPPING
  | 'wellness_bill'      // HEALTH
  | 'free_trial_life'    // DIGITAL
  | 'glowing_broke'      // PERSONAL_CARE
  | 'degree_debt'        // EDUCATION
  | 'mail_goes_home'     // TRAVEL
  | 'corner_office'      // PETS
  | 'burn_rate'          // TOBACCO
  | 'heaven_sent'        // SOCIAL
  | 'currency_combustion'// TRANSPORT

export interface PersonalitySignals {
  income:           number
  spending:         number
  net:              number
  spendRatio:       number
  savingsRate:      number
  topCatName:                string
  topCatMaster:              MasterKey | null
  topCatPct:                 number
  secondCatName:             string
  secondCatMaster:           MasterKey | null
  secondCatPct:              number
  topDiscretionaryCatMaster: MasterKey | null  // top non-HOME/FINANCIAL category
  catSpread:        number         // topCatPct - secondCatPct
  subCount:         number
  anomalyCount:     number
  statementType:    'bank' | 'credit' | 'unknown'
  interestDetected: boolean
  balanceCarried:   boolean
  utilizationRate:  number         // 0–1, credit only
}

export interface PersonalityMeta {
  id:       CorePersonalityId | PremiumPersonalityId | TraitId
  name:     string           // "The Subscription Collector"
  tagline:  string
  vibe:     string
  accent:   string
  accentBg: string
  isCaution:  boolean        // Minimum Payer, Overdraft Artist
  isPremium:  boolean
  isDisabled: boolean        // future / not enough data yet
}

export interface PersonalityResult {
  premium?:   PersonalityMeta
  core:       PersonalityMeta
  trait?:     PersonalityMeta
  softTrait?: PersonalityMeta   // 25–29% threshold
  // Convenience display string e.g. "The Smooth Operator · Fork & Knife"
  display:    string
}
