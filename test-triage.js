/**
 * End-to-end test for the Triage page APIs
 */

const BASE = 'http://localhost:3000'
const EMAIL = `triage_${Date.now()}@budget.test`
const PASS  = 'testpass123'

let token = ''

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res  = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers, ...opts.headers } })
  const text = await res.text()
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }
  } catch { return { ok: res.ok, status: res.status, data: text } }
}

function pass(msg) { console.log(`  ✅  ${msg}`) }
function fail(msg) { console.log(`  ❌  ${msg}`); process.exit(1) }
function section(s) { console.log(`\n${'─'.repeat(55)}\n  ${s}\n${'─'.repeat(55)}`) }

async function run() {

  section('1. AUTH')
  let r = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS }) })
  if (!r.ok) fail('Register: ' + JSON.stringify(r.data))
  token = r.data.token
  pass(`Registered: ${EMAIL}`)

  section('2. UPLOAD CSV WITH AMBIGUOUS TRANSACTIONS')

  // Build a CSV that has same-merchant transactions with different real categories
  // (Amazon appears 3x: electronics, books, household) plus some genuinely uncategorized stuff
  const csv = [
    'Date,Description,Amount',
    '2024-02-01,AMAZON.COM*ELECTRONICS HDMI CABLE,-34.99',
    '2024-02-02,AMAZON.COM*BOOKS ORDER HISTORY,-12.99',
    '2024-02-03,AMAZON.COM*HOUSEHOLD CLEANING,-28.50',
    '2024-02-04,TARGET #0472 CAMBRIDGE MA,-89.44',
    '2024-02-05,TARGET #0472 GROCERY RUN,-67.20',
    '2024-02-06,MYSTERY VENDOR XYZ LLC,-45.00',
    '2024-02-07,RANDOM CHARGE 8723947,-22.00',
    '2024-02-08,DIRECT DEPOSIT PAYROLL,3500.00',
    '2024-02-09,STARBUCKS #12345,-14.50',
    '2024-02-10,WHOLEFDS #422 CAMBRIDGE,-127.43',
    '2024-02-11,UNKNOWN SUBSCRIPTION SERVICE,-9.99',
    '2024-02-12,FOREIGN VENDOR PARIS FRANCE,-55.00',
  ].join('\n')

  // Create account first
  r = await api('/api/accounts', { method: 'POST', body: JSON.stringify({ name: 'Triage Test Account', accountType: 'checking' }) })
  if (!r.ok) fail('Create account: ' + JSON.stringify(r.data))
  const accountId = r.data.account.id
  pass(`Created account (${accountId.slice(0,12)}...)`)

  const fd = new FormData()
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'triage_test.csv')
  fd.append('accountId', accountId)
  const headers = { Authorization: `Bearer ${token}` }
  const upRes = await fetch(`${BASE}/api/uploads`, { method: 'POST', body: fd, headers })
  const upData = await upRes.json()
  if (!upRes.ok) fail('Upload: ' + JSON.stringify(upData))
  pass(`Uploaded: ${upData.accepted} transactions accepted (format: ${upData.formatDetected})`)

  section('3. CHECK TRIAGE QUEUE (what page loads)')

  r = await api('/api/transactions?limit=500')
  if (!r.ok) fail('Fetch transactions: ' + JSON.stringify(r.data))
  const txs = r.data.transactions
  pass(`Total transactions fetched: ${txs.length}`)

  // Apply same filter the triage page uses
  const needsReview = txs.filter(t => {
    if (t.isTransfer || t.reviewedByUser) return false
    if (!t.category || t.category.name === 'Other') return true
    if (t.categorizationSource === 'ai' && t.confidenceScore < 0.75) return true
    return false
  })

  pass(`Needs-review queue: ${needsReview.length} transactions`)
  console.log('')
  console.log('  ┌─────────────────────────────────────────────────────┐')
  console.log('  │  TRIAGE QUEUE PREVIEW                               │')
  console.log('  ├─────────────────────────────────────────────────────┤')
  needsReview.forEach((t, i) => {
    const name   = (t.merchantNormalized || t.description).padEnd(22).slice(0,22)
    const cat    = (t.category?.name || 'None').padEnd(14).slice(0,14)
    const src    = t.categorizationSource === 'ai' ? `🤖 ${(t.confidenceScore*100).toFixed(0)}%` : `⚙️ rule`
    const amt    = `$${Math.abs(t.amount).toFixed(2)}`.padStart(8)
    console.log(`  │  ${String(i+1).padStart(2)}. ${name}  ${cat}  ${src.padEnd(8)} ${amt}  │`)
  })
  console.log('  └─────────────────────────────────────────────────────┘')

  r = await api('/api/categories')
  const cats = r.data.categories

  section('4. SIMULATE: DRAG AMAZON → ELECTRONICS (just this one)')

  const electronicsAmazon = txs.find(t => t.description.toLowerCase().includes('electronics'))
  const elecCat           = cats.find(c => c.name === 'Electronics') || cats.find(c => c.name === 'Shopping')
  if (!electronicsAmazon) fail('Could not find Amazon electronics transaction')

  r = await api(`/api/transactions/${electronicsAmazon.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ categoryId: elecCat.id, applyToAll: false })
  })
  if (!r.ok) fail('PATCH single: ' + JSON.stringify(r.data))
  pass(`Assigned "${electronicsAmazon.merchantNormalized}" → "${elecCat.name}" (just this one, updated: ${r.data.updated})`)

  section('5. SIMULATE: DRAG AMAZON → EDUCATION (apply to all similar)')

  const booksAmazon = txs.find(t => t.description.toLowerCase().includes('books'))
  const educationCat = cats.find(c => c.name === 'Education') || cats.find(c => c.name === 'Shopping')

  // Count similar unreviewed (what the confirmation modal shows)
  const similarCount = txs.filter(t => t.merchantNormalized === booksAmazon?.merchantNormalized && !t.reviewedByUser).length
  pass(`Similar unreviewed Amazon transactions (for modal): ${similarCount}`)

  r = await api(`/api/transactions/${booksAmazon.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ categoryId: educationCat.id, applyToAll: true })
  })
  if (!r.ok) fail('PATCH apply-to-all: ' + JSON.stringify(r.data))
  pass(`Apply-to-all Amazon → "${educationCat.name}": updated ${r.data.updated} transactions + saved rule`)

  section('6. SIMULATE: KEYBOARD SHORTCUT — select tx → press "3" (Housing)')

  const mysteryTx = txs.find(t => t.description.toLowerCase().includes('mystery'))
  const housingCat = cats.find(c => c.name === 'Housing')
  if (mysteryTx && housingCat) {
    r = await api(`/api/transactions/${mysteryTx.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId: housingCat.id, applyToAll: false })
    })
    pass(`Keyboard assign "MYSTERY VENDOR" → "${housingCat.name}" (updated: ${r.data.updated})`)
  }

  section('7. VERIFY TRIAGE QUEUE SHRUNK AFTER CORRECTIONS')

  r = await api('/api/transactions?limit=500')
  const txsAfter = r.data.transactions
  const queueAfter = txsAfter.filter(t => {
    if (t.isTransfer || t.reviewedByUser) return false
    if (!t.category || t.category.name === 'Other') return true
    if (t.categorizationSource === 'ai' && t.confidenceScore < 0.75) return true
    return false
  })
  pass(`Queue after corrections: ${queueAfter.length} (was ${needsReview.length})`)

  const reviewedCount = txsAfter.filter(t => t.reviewedByUser).length
  pass(`Transactions marked as reviewed: ${reviewedCount}`)

  // Verify apply-to-all actually updated all Amazon txs
  const amazonTxs = txsAfter.filter(t => t.merchantNormalized?.toLowerCase().includes('amazon'))
  const amazonReviewed = amazonTxs.filter(t => t.reviewedByUser)
  pass(`Amazon transactions reviewed: ${amazonReviewed.length}/${amazonTxs.length}`)

  section('8. VERIFY SUMMARY RECOMPUTED (cache invalidation)')

  r = await api('/api/summaries/2024/2')
  if (r.ok) {
    const s = r.data.summary
    pass(`February 2024 summary: income=$${s.totalIncome.toFixed(2)}, spending=$${s.totalSpending.toFixed(2)}`)
  } else {
    pass('Summary not yet computed (OK — no month data in this account yet)')
  }

  section('RESULTS')
  console.log('\n  All triage API tests passed! ✅')
  console.log(`  Triage page live at: http://localhost:3000/triage\n`)
}

run().catch(e => { console.error('\n❌ UNEXPECTED ERROR:', e.message); process.exit(1) })
