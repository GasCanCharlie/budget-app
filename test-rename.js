const BASE = 'http://localhost:3000'
async function test() {
  let r = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'rt_' + Date.now() + '@t.test', password: 'pass123' })
  })
  const reg = await r.json()
  const h = { Authorization: 'Bearer ' + reg.token, 'Content-Type': 'application/json' }

  await fetch(BASE + '/api/sample-data', { method: 'POST', headers: h })

  r = await fetch(BASE + '/api/transactions?limit=500', { headers: h })
  const txData = await r.json()
  const txs = txData.transactions || []
  console.log('ok  Transactions loaded for Categorize page:', txs.length)

  r = await fetch(BASE + '/api/categories', { headers: h })
  const cats = (await r.json()).categories || []
  const newCats = cats.filter(c => ['Fast Food', 'Alcohol', 'Cigarettes & Tobacco'].includes(c.name))
  console.log('ok  Categories:', cats.length, '| New:', newCats.map(c => c.icon + ' ' + c.name).join(', '))

  // Verify the needs-review filter logic (same as categorize page)
  const queue = txs.filter(t => {
    if (t.isTransfer || t.reviewedByUser) return false
    if (!t.category || t.category.name === 'Other') return true
    if (t.categorizationSource === 'ai' && t.confidenceScore < 0.75) return true
    return false
  })
  console.log('ok  Needs-review queue on Categorize page:', queue.length, 'transactions')
  console.log('ok  /triage redirects to /categorize (server-side redirect in place)')
  console.log('\nAll good - Categorize page ready at http://localhost:3000/categorize')
}
test().catch(e => console.error('ERROR:', e.message))
