const BASE = 'http://localhost:3000'

async function test() {
  // Auth
  const email = 'cattest_' + Date.now() + '@budget.test'
  let r = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'testpass123' })
  })
  const { token } = await r.json()
  const h = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }

  function pass(msg) { console.log('  ok  ' + msg) }
  function fail(msg) { console.log('  FAIL ' + msg); process.exit(1) }

  // --- Get categories - verify new ones exist ---
  r = await fetch(BASE + '/api/categories', { headers: h })
  const { categories } = await r.json()
  const names = categories.map(c => c.name)

  if (!names.includes('Fast Food'))           fail('Fast Food missing')
  if (!names.includes('Alcohol'))             fail('Alcohol missing')
  if (!names.includes('Cigarettes & Tobacco')) fail('Cigarettes & Tobacco missing')
  pass('All 3 new system categories present (' + categories.length + ' total)')

  // --- Create a custom category ---
  r = await fetch(BASE + '/api/categories', {
    method: 'POST', headers: h,
    body: JSON.stringify({ name: 'My Custom Cat', icon: '⭐', color: '#f59e0b', isIncome: false })
  })
  if (r.status !== 201) fail('Create custom category: ' + r.status)
  const created = (await r.json()).category
  pass('Created custom category: ' + created.name + ' ' + created.icon)
  const customId = created.id

  // --- Block delete of system category ---
  const systemCat = categories.find(c => c.isSystem)
  r = await fetch(BASE + '/api/categories/' + systemCat.id, { method: 'DELETE', headers: h })
  if (r.status !== 404) fail('System cat delete should return 404, got ' + r.status)
  pass('System category correctly blocked from deletion (404)')

  // --- Delete the custom category ---
  r = await fetch(BASE + '/api/categories/' + customId, { method: 'DELETE', headers: h })
  const del = await r.json()
  if (!del.deleted) fail('Delete custom category failed: ' + JSON.stringify(del))
  pass('Custom category deleted successfully')

  // --- Verify it is gone ---
  r = await fetch(BASE + '/api/categories', { headers: h })
  const after = await r.json()
  const stillThere = after.categories.find(c => c.id === customId)
  if (stillThere) fail('Custom cat still in list after delete')
  pass('Custom category removed from list')

  // --- Test auto-categorization with new categories ---
  const acct = await (await fetch(BASE + '/api/accounts', {
    method: 'POST', headers: h,
    body: JSON.stringify({ name: 'Cat Test Account', accountType: 'checking' })
  })).json()

  const csv = [
    'Date,Description,Amount',
    '2024-03-01,MCDONALD S #8822 BOSTON,-12.50',
    '2024-03-02,TACO BELL #12345 CAMBRIDGE,-9.99',
    '2024-03-03,TOTAL WINE AND MORE #44,-45.00',
    '2024-03-04,BEVMO #123 SAN FRANCISCO,-38.50',
    '2024-03-05,SMOKE SHOP DOWNTOWN,-18.00',
    '2024-03-06,VAPE SHOP CENTRAL,-22.00',
    '2024-03-07,CHICK-FIL-A #3904,-14.75',
    '2024-03-08,WHOLE FOODS MARKET,-89.00',
    '2024-03-09,STARBUCKS #12345,-6.50',
  ].join('\n')

  const fd = new FormData()
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'cat_test.csv')
  fd.append('accountId', acct.account.id)
  const up = await fetch(BASE + '/api/uploads', {
    method: 'POST', body: fd,
    headers: { 'Authorization': 'Bearer ' + token }
  })
  const upData = await up.json()
  pass('Uploaded ' + upData.accepted + ' transactions')

  r = await fetch(BASE + '/api/transactions?limit=50', { headers: h })
  const txs = (await r.json()).transactions

  console.log('\n  Auto-categorization results:')
  console.log('  ' + '─'.repeat(58))
  for (const tx of txs) {
    const cat  = (tx.category?.name || 'None').padEnd(22)
    const desc = tx.description.slice(0, 28).padEnd(30)
    const src  = tx.categorizationSource === 'user' ? '✏️' : tx.categorizationSource === 'rule' ? '⚙️' : '🤖'
    console.log('  ' + desc + cat + src)
  }
  console.log('  ' + '─'.repeat(58))

  // Verify specific categorizations
  const mcdo = txs.find(t => t.description.includes('MCDONALD'))
  const wine = txs.find(t => t.description.includes('TOTAL WINE'))
  const vape = txs.find(t => t.description.includes('VAPE'))
  const wf   = txs.find(t => t.description.includes('WHOLE FOODS'))

  if (mcdo?.category?.name !== 'Fast Food')           fail('McDonalds should be Fast Food, got: ' + mcdo?.category?.name)
  pass('McDonalds -> Fast Food')

  if (wine?.category?.name !== 'Alcohol')             fail('Total Wine should be Alcohol, got: ' + wine?.category?.name)
  pass('Total Wine -> Alcohol')

  if (vape?.category?.name !== 'Cigarettes & Tobacco') fail('Vape Shop should be Cigarettes & Tobacco, got: ' + vape?.category?.name)
  pass('Vape Shop -> Cigarettes & Tobacco')

  if (wf?.category?.name !== 'Groceries')            fail('Whole Foods should be Groceries, got: ' + wf?.category?.name)
  pass('Whole Foods still -> Groceries (not affected by new rules)')

  console.log('\n  All category tests passed!')
}

test().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
