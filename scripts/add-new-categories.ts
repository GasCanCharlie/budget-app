/**
 * One-time migration: adds Fast Food, Alcohol, and Cigarettes & Tobacco
 * as system categories with auto-categorization rules.
 *
 * Run: npx ts-node --project tsconfig.seed.json --compiler-options '{"module":"CommonJS"}' scripts/add-new-categories.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const NEW_CATEGORIES = [
  {
    name: 'Fast Food',
    color: '#ef4444',
    icon: '🍟',
    isIncome: false,
    sortOrder: 2,  // show right after Food & Dining
    rules: [
      { matchType: 'contains', matchValue: 'mcdonald',      priority: 12 },
      { matchType: 'contains', matchValue: 'mcdonalds',     priority: 12 },
      { matchType: 'contains', matchValue: 'burger king',   priority: 12 },
      { matchType: 'contains', matchValue: 'wendys',        priority: 12 },
      { matchType: 'contains', matchValue: 'wendy\'s',      priority: 12 },
      { matchType: 'contains', matchValue: 'taco bell',     priority: 12 },
      { matchType: 'contains', matchValue: 'tacobell',      priority: 12 },
      { matchType: 'contains', matchValue: 'kfc',           priority: 12 },
      { matchType: 'contains', matchValue: 'popeyes',       priority: 12 },
      { matchType: 'contains', matchValue: 'popeye',        priority: 12 },
      { matchType: 'contains', matchValue: 'chick-fil-a',   priority: 12 },
      { matchType: 'contains', matchValue: 'chickfila',     priority: 12 },
      { matchType: 'contains', matchValue: 'chick fil a',   priority: 12 },
      { matchType: 'contains', matchValue: 'five guys',     priority: 12 },
      { matchType: 'contains', matchValue: 'shake shack',   priority: 12 },
      { matchType: 'contains', matchValue: 'in-n-out',      priority: 12 },
      { matchType: 'contains', matchValue: 'jack in the box', priority: 12 },
      { matchType: 'contains', matchValue: 'hardees',       priority: 12 },
      { matchType: 'contains', matchValue: 'hardee',        priority: 12 },
      { matchType: 'contains', matchValue: 'carls jr',      priority: 12 },
      { matchType: 'contains', matchValue: 'carl\'s jr',    priority: 12 },
      { matchType: 'contains', matchValue: 'del taco',      priority: 12 },
      { matchType: 'contains', matchValue: 'whataburger',   priority: 12 },
      { matchType: 'contains', matchValue: 'dairy queen',   priority: 12 },
      { matchType: 'contains', matchValue: 'papa john',     priority: 12 },
      { matchType: 'contains', matchValue: 'papa murphy',   priority: 12 },
      { matchType: 'contains', matchValue: 'little caesar', priority: 12 },
      { matchType: 'contains', matchValue: 'jimmy john',    priority: 12 },
      { matchType: 'contains', matchValue: 'jersey mike',   priority: 12 },
      { matchType: 'contains', matchValue: 'arby',          priority: 12 },
      { matchType: 'contains', matchValue: 'culver',        priority: 12 },
      { matchType: 'contains', matchValue: 'checkers',      priority: 12 },
      { matchType: 'contains', matchValue: 'rallys',        priority: 12 },
      { matchType: 'contains', matchValue: 'wingstop',      priority: 12 },
      { matchType: 'contains', matchValue: 'bojangles',     priority: 12 },
      { matchType: 'contains', matchValue: 'raising cane',  priority: 12 },
      { matchType: 'contains', matchValue: 'zaxby',         priority: 12 },
      { matchType: 'contains', matchValue: 'sonic drive',   priority: 12 },
      { matchType: 'contains', matchValue: 'sonic #',       priority: 12 },
      { matchType: 'contains', matchValue: 'cookout',       priority: 12 },
      { matchType: 'contains', matchValue: 'cook out',      priority: 12 },
      { matchType: 'contains', matchValue: 'steak n shake', priority: 12 },
      { matchType: 'contains', matchValue: 'domino',        priority: 12 },
      { matchType: 'contains', matchValue: 'pizza hut',     priority: 12 },
      { matchType: 'contains', matchValue: 'pizzahut',      priority: 12 },
      { matchType: 'contains', matchValue: 'subway',        priority: 12 },
      { matchType: 'contains', matchValue: 'moe\'s',        priority: 12 },
      { matchType: 'contains', matchValue: 'moes southwest', priority: 12 },
      { matchType: 'contains', matchValue: 'qdoba',         priority: 12 },
      { matchType: 'contains', matchValue: 'panda express', priority: 12 },
      { matchType: 'contains', matchValue: 'panera',        priority: 12 },
    ] as { matchType: 'exact' | 'contains' | 'regex'; matchValue: string; priority: number }[],
  },
  {
    name: 'Alcohol',
    color: '#8b5cf6',
    icon: '🍺',
    isIncome: false,
    sortOrder: 20,
    rules: [
      { matchType: 'contains', matchValue: 'total wine',        priority: 12 },
      { matchType: 'contains', matchValue: 'totalwine',         priority: 12 },
      { matchType: 'contains', matchValue: 'bevmo',             priority: 12 },
      { matchType: 'contains', matchValue: 'binny',             priority: 12 },
      { matchType: 'contains', matchValue: 'liquor store',      priority: 12 },
      { matchType: 'contains', matchValue: 'liquor mart',       priority: 12 },
      { matchType: 'contains', matchValue: 'wine & spirits',    priority: 12 },
      { matchType: 'contains', matchValue: 'wine and spirits',  priority: 12 },
      { matchType: 'contains', matchValue: 'abc fine wine',     priority: 12 },
      { matchType: 'contains', matchValue: 'abc liquor',        priority: 12 },
      { matchType: 'contains', matchValue: 'package store',     priority: 12 },
      { matchType: 'contains', matchValue: 'state store',       priority: 12 },
      { matchType: 'contains', matchValue: 'spec\'s',           priority: 12 },
      { matchType: 'contains', matchValue: 'specs wine',        priority: 12 },
      { matchType: 'contains', matchValue: 'total beverage',    priority: 12 },
      { matchType: 'contains', matchValue: 'beer wine spirits', priority: 12 },
      { matchType: 'contains', matchValue: 'brewery',           priority: 11 },
      { matchType: 'contains', matchValue: 'brewpub',           priority: 11 },
      { matchType: 'contains', matchValue: 'winery',            priority: 11 },
      { matchType: 'contains', matchValue: 'distillery',        priority: 11 },
      { matchType: 'contains', matchValue: 'wine bar',          priority: 11 },
      { matchType: 'contains', matchValue: 'craft beer',        priority: 11 },
      { matchType: 'contains', matchValue: 'beer garden',       priority: 11 },
      { matchType: 'contains', matchValue: 'drizly',            priority: 12 },
      { matchType: 'contains', matchValue: 'minibar delivery',  priority: 12 },
    ] as { matchType: 'exact' | 'contains' | 'regex'; matchValue: string; priority: number }[],
  },
  {
    name: 'Cigarettes & Tobacco',
    color: '#78716c',
    icon: '🚬',
    isIncome: false,
    sortOrder: 21,
    rules: [
      { matchType: 'contains', matchValue: 'tobacco',          priority: 12 },
      { matchType: 'contains', matchValue: 'cigarette',        priority: 12 },
      { matchType: 'contains', matchValue: 'cigar',            priority: 12 },
      { matchType: 'contains', matchValue: 'smoke shop',       priority: 12 },
      { matchType: 'contains', matchValue: 'smokeshop',        priority: 12 },
      { matchType: 'contains', matchValue: 'vape',             priority: 12 },
      { matchType: 'contains', matchValue: 'vaping',           priority: 12 },
      { matchType: 'contains', matchValue: 'juul',             priority: 12 },
      { matchType: 'contains', matchValue: 'e-cigarette',      priority: 12 },
      { matchType: 'contains', matchValue: 'nicotine',         priority: 12 },
      { matchType: 'contains', matchValue: 'vapeshop',         priority: 12 },
      { matchType: 'contains', matchValue: 'vape shop',        priority: 12 },
      { matchType: 'contains', matchValue: 'smokes for less',  priority: 12 },
      { matchType: 'contains', matchValue: 'tobacco barn',     priority: 12 },
      { matchType: 'contains', matchValue: 'cigars international', priority: 12 },
      { matchType: 'contains', matchValue: 'marlboro',         priority: 12 },
      { matchType: 'contains', matchValue: 'newport smokes',   priority: 12 },
    ] as { matchType: 'exact' | 'contains' | 'regex'; matchValue: string; priority: number }[],
  },
]

async function main() {
  console.log('Adding new system categories...\n')

  for (const catDef of NEW_CATEGORIES) {
    const { rules, ...catData } = catDef

    // Upsert category (create if not exists, skip if already there)
    const existing = await prisma.category.findFirst({
      where: { name: catData.name, isSystem: true, userId: null },
    })

    let cat
    if (existing) {
      console.log(`⏭  "${catData.name}" already exists — skipping`)
      cat = existing
    } else {
      cat = await prisma.category.create({
        data: { ...catData, isSystem: true, userId: null, isTransfer: false },
      })
      console.log(`✅  Created category: "${cat.name}" (${cat.icon})`)
    }

    // Add rules that don't already exist
    let rulesAdded = 0
    for (const rule of rules) {
      const existingRule = await prisma.categoryRule.findFirst({
        where: { categoryId: cat.id, matchValue: rule.matchValue, isSystem: true },
      })
      if (!existingRule) {
        await prisma.categoryRule.create({
          data: { ...rule, categoryId: cat.id, isSystem: true, userId: null },
        })
        rulesAdded++
      }
    }
    if (rulesAdded > 0) console.log(`   + ${rulesAdded} rules added`)
  }

  console.log('\nDone! Restart the dev server for changes to take effect.')
  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
