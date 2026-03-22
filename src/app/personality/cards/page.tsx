'use client'

import Image from 'next/image'

const CARDS = [
  { id: 'subscription_collector', src: '/personalities/subscription-collector.webp' },
  { id: 'wire_dancer',            src: '/personalities/wire-dancer.webp' },
  { id: 'full_send',              src: '/personalities/full-send.webp' },
  { id: 'currency_combustion',    src: '/personalities/currency-combustion.webp' },
  { id: 'balance_transfer',       src: '/personalities/balance_transfer.webp' },
  { id: 'utilization_king',       src: '/personalities/utilization_king.webp' },
  { id: 'cashback_architect',     src: '/personalities/cashback_architect.webp' },
  { id: 'minimum_payer',          src: '/personalities/minimum_payer.webp' },
  { id: 'points_chaser',          src: '/personalities/points_chaser.webp' },
  { id: 'revolving_door',         src: '/personalities/revolving_door.webp' },
  { id: 'direct_depositor',       src: '/personalities/direct_depositor.webp' },
  { id: 'cash_keeper',            src: '/personalities/cash_keeper.webp' },
  { id: 'flow_master',            src: '/personalities/flow_master.webp' },
  { id: 'breakeven_poet',         src: '/personalities/breakeven_poet.webp' },
  { id: 'overdraft_artist',       src: '/personalities/overdraft_artist.webp' },
  { id: 'quiet_millionaire',      src: '/personalities/quiet_millionaire.webp' },
  { id: 'savvy_spender',          src: '/personalities/savvy_spender.webp' },
  { id: 'low_key_saver',          src: '/personalities/low_key_saver.webp' },
  { id: 'big_ticket_player',      src: '/personalities/big_ticket_player.webp' },
  { id: 'safety_buffer',          src: '/personalities/safety_buffer.webp' },
  { id: 'glowing_broke',          src: '/personalities/glowing-broke.webp' },
]

export default function PersonalityCardsPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0f',
      padding: '40px 32px',
    }}>
      <h1 style={{
        color: '#e2e8f0',
        fontSize: 22,
        fontWeight: 600,
        marginBottom: 32,
        letterSpacing: '0.02em',
      }}>
        Personality Cards — {CARDS.length} total
      </h1>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
        gap: 24,
      }}>
        {CARDS.map(card => (
          <div key={card.id} style={{
            borderRadius: 14,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ position: 'relative', width: '100%', aspectRatio: '3/2' }}>
              <Image
                src={card.src}
                alt={card.id}
                fill
                style={{ objectFit: 'cover' }}
                unoptimized
              />
            </div>
            <div style={{
              padding: '10px 14px',
              color: 'rgba(148,163,184,0.8)',
              fontSize: 12,
              fontFamily: 'monospace',
            }}>
              {card.id}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
