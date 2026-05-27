// 调度器：自动发现 fetchers/ 下所有 adapter，依次执行
// 用法：
//   node scripts/fetchers/_runner.js              # 全部运行
//   node scripts/fetchers/_runner.js --only f1-2026  # 只跑指定 adapter
//   node scripts/fetchers/_runner.js --dry-run    # 不写文件，只看 diff

import { readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { readSource, writeSource, mergeEvents, diffSummary } from './_base.js'

const DIR = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const onlyId = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const dryRun = args.includes('--dry-run')

function discoverAdapters(dir) {
  const paths = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) paths.push(...discoverAdapters(full))
    else if (entry.endsWith('.js') && !entry.startsWith('_')) paths.push(full)
  }
  return paths
}

const adapterPaths = discoverAdapters(DIR)
const tally = { updated: 0, unchanged: 0, failed: 0 }

for (const path of adapterPaths) {
  const { default: adapter } = await import(pathToFileURL(path).href)
  if (!adapter?.id) continue
  if (onlyId && adapter.id !== onlyId) continue

  const existing = readSource(adapter.category, adapter.id)
  process.stdout.write(`[${adapter.id}] `)

  try {
    const newEvents = await adapter.fetch(existing)
    const diff = diffSummary(existing?.events, newEvents)

    if (diff.added.length === 0 && diff.updated.length === 0) {
      console.log(`no changes (${diff.total} events)`)
      tally.unchanged++
      continue
    }

    console.log(`+${diff.added.length} new  ~${diff.updated.length} updated`)

    if (!dryRun) {
      const merged = adapter.merge
        ? adapter.merge(existing, newEvents)
        : mergeEvents(existing?.events, newEvents)
      writeSource(adapter.category, adapter.id, { ...existing, events: merged })
    }
    tally.updated++
  } catch (err) {
    console.error(`FAILED: ${err.message}`)
    tally.failed++
  }
}

console.log(`\n${tally.updated} updated · ${tally.unchanged} unchanged · ${tally.failed} failed`)
if (dryRun) console.log('(dry-run: no files written)')
if (tally.failed > 0) process.exit(1)
