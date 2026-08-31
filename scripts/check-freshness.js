#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const EVENTS_DIR = join(ROOT, 'events')
const HEALTH_FILE = join(ROOT, 'source-health.json')
const STALE_DAYS_DEFAULT = 30
const STALE_DAYS_COMPLETED = 180
const STALE_DAYS_FUTURE = 90

function collectJsonFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectJsonFiles(fullPath))
    } else if (entry.endsWith('.json')) {
      files.push(fullPath)
    }
  }
  return files
}

function daysBetween(a, b) {
  const msPerDay = 1000 * 60 * 60 * 24
  // 使用本地时区午夜时间，避免跨时区导致的日期偏差
  const localA = new Date(a.getFullYear(), a.getMonth(), a.getDate())
  const localB = new Date(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.floor((localB - localA) / msPerDay)
}

function getStaleThreshold(event, today) {
  if (event.status === 'completed') return STALE_DAYS_COMPLETED
  if (event.date) {
    const eventDate = new Date(event.date)
    const daysUntil = daysBetween(today, eventDate)
    if (daysUntil > 30) return STALE_DAYS_FUTURE
  }
  return STALE_DAYS_DEFAULT
}

const today = new Date()
const staleEvents = []
const lifecycleErrors = []
const emptyCalendars = []
const healthWarnings = []
const healthErrors = []
const todayStr = today.toISOString().slice(0, 10)
const calendarCutoffDate = new Date(today)
calendarCutoffDate.setDate(calendarCutoffDate.getDate() - 30)
const calendarCutoff = calendarCutoffDate.toISOString().slice(0, 10)

let health = { sources: {} }
try {
  health = JSON.parse(readFileSync(HEALTH_FILE, 'utf8'))
} catch {
  // 兼容尚未由抓取 runner 建立健康清单的旧数据仓库。
}

function eventEndDate(event) {
  return event.end_date || event.date || ''
}

for (const file of collectJsonFiles(EVENTS_DIR)) {
  const rel = file.replace(ROOT + '/', '')
  const source = JSON.parse(readFileSync(file, 'utf8'))
  if (source.hidden === true) continue
  const sourceHealth = health.sources?.[source.id]
  if (!sourceHealth?.checked_at) {
    healthErrors.push({ sourceId: source.id, sourceName: source.name, reason: '缺少成功抓取记录' })
  } else {
    const checkedDate = new Date(sourceHealth.checked_at)
    const daysSinceChecked = Math.floor((today - checkedDate) / (1000 * 60 * 60 * 24))
    if (daysSinceChecked > STALE_DAYS_DEFAULT) {
      healthErrors.push({ sourceId: source.id, sourceName: source.name, reason: `checked_at ${sourceHealth.checked_at}（${daysSinceChecked} 天前）` })
    }
  }
  if (sourceHealth?.outcome === 'failed' || sourceHealth?.outcome === 'skipped') {
    healthErrors.push({ sourceId: source.id, sourceName: source.name, reason: `最近抓取结果为 ${sourceHealth.outcome}` })
  }

  const calendarEvents = (source.events ?? []).filter(event => eventEndDate(event) >= calendarCutoff)
  if (source.health_policy?.require_calendar && calendarEvents.length === 0) {
    emptyCalendars.push({ file: rel, sourceId: source.id, sourceName: source.name })
  }

  for (const event of source.events ?? []) {
    const endDate = eventEndDate(event)
    if (endDate > todayStr && event.status === 'completed') {
      lifecycleErrors.push({ file: rel, eventId: event.id, eventName: event.name, reason: '未来事件被标记为 completed', status: event.status, endDate })
    }
    if (endDate < todayStr && ['planned', 'confirmed', 'active'].includes(event.status)) {
      lifecycleErrors.push({ file: rel, eventId: event.id, eventName: event.name, reason: '已结束事件仍处于未完成状态', status: event.status, endDate })
    }
    // 已结束的历史事件不再要求近期重复核验；否则历史库会持续制造噪声。
    if (endDate < todayStr) continue
    const freshnessDate = sourceHealth?.checked_at ?? event.last_verified
    if (!freshnessDate) continue
    const verifiedDate = new Date(freshnessDate)
    const daysSince = Math.floor((today - verifiedDate) / (1000 * 60 * 60 * 24))
    const threshold = getStaleThreshold(event, today)
    if (daysSince > threshold) {
      staleEvents.push({
        file: rel,
        sourceId: source.id,
        sourceName: source.name,
        eventId: event.id,
        eventName: event.name,
        lastVerified: freshnessDate,
        daysSince,
        threshold,
        status: event.status ?? 'unknown',
      })
    }
  }
}

if (staleEvents.length > 0) {
  console.warn(`⚠ 发现 ${staleEvents.length} 个当前/未来事件超过阈值未更新：`)
  for (const e of staleEvents) {
    console.warn(`  • ${e.file} / ${e.eventId} — 上次校验：${e.lastVerified}（${e.daysSince} 天前，阈值 ${e.threshold} 天）`)
  }
}

if (lifecycleErrors.length > 0) {
  console.error(`✗ 发现 ${lifecycleErrors.length} 个事件生命周期错误：`)
  for (const e of lifecycleErrors) console.error(`  • ${e.file} / ${e.eventId} — ${e.reason}（结束：${e.endDate}，状态：${e.status}）`)
}

if (emptyCalendars.length > 0) {
  console.error(`✗ 发现 ${emptyCalendars.length} 个要求有内容的空日历：`)
  for (const e of emptyCalendars) console.error(`  • ${e.file} / ${e.sourceId} — ${e.sourceName}`)
}

if (healthWarnings.length > 0) {
  console.warn(`⚠ ${healthWarnings.length} 个事件源的 checked_at 超过 ${STALE_DAYS_DEFAULT} 天：`)
  for (const e of healthWarnings) console.warn(`  • ${e.sourceId} — ${e.checkedAt}（${e.daysSinceChecked} 天前）`)
}

if (healthErrors.length > 0) {
  console.error(`✗ 发现 ${healthErrors.length} 个事件源健康记录缺失或失败：`)
  for (const e of healthErrors) console.error(`  • ${e.sourceId} — ${e.reason}`)
}

if (staleEvents.length === 0 && lifecycleErrors.length === 0 && emptyCalendars.length === 0 && healthErrors.length === 0) {
  console.log(`✓ 当前/未来事件的新鲜度、生命周期和必需日历均通过`)
}

// 创建 GitHub Issue（仅在 Actions 环境中且有 TOKEN）
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY

if (GITHUB_TOKEN && GITHUB_REPOSITORY && (staleEvents.length > 0 || lifecycleErrors.length > 0 || emptyCalendars.length > 0)) {
  // 1. 检查是否已有未关闭的同类 Issue
  const issuesRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues?labels=data-freshness&state=open&per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  )

  if (issuesRes.ok) {
    const issues = await issuesRes.json()
    if (issues.length > 0) {
      console.log(`✓ 已存在未关闭的数据新鲜度 Issue (#${issues[0].number})，跳过创建`)
    } else {
      await createFreshnessIssue(GITHUB_TOKEN, GITHUB_REPOSITORY, staleEvents, lifecycleErrors, emptyCalendars, today)
    }
  } else {
    console.error(`✗ 查询现有 Issue 失败: ${issuesRes.status} ${issuesRes.statusText}`)
  }

  // 2. 创建新 Issue（已存在同类 Issue 时由上面的分支跳过）
  async function createFreshnessIssue(token, repository, stale, lifecycle, empty, reportDate) {
  const body = [
    `## 数据新鲜度检查报告`,
    ``,
    `发现 **${stale.length}** 个当前/未来事件超过对应阈值未更新，另有 **${lifecycle.length}** 个生命周期错误、**${empty.length}** 个必需空日历。`,
    ``,
    `| 事件源 | 事件 ID | 状态 | 上次校验 | 已过天数 | 阈值 |`,
    `|--------|---------|------|---------|---------|------|`,
    ...stale.map(e =>
      `| ${e.sourceName} | \`${e.eventId}\` | ${e.status} | ${e.lastVerified} | ${e.daysSince} 天 | ${e.threshold} 天 |`
    ),
    ``,
    `_由 GitHub Actions 自动创建 · ${reportDate.toISOString().slice(0, 10)}_`,
  ].join('\n')

  const res = await fetch(`https://api.github.com/repos/${repository}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      title: `[数据新鲜度] ${stale.length} 个事件超过阈值未更新`,
      body,
      labels: ['data-freshness'],
    }),
  })

  if (res.ok) {
    const issue = await res.json()
    console.log(`✓ 已创建 GitHub Issue: ${issue.html_url}`)
  } else {
    console.error(`✗ 创建 Issue 失败: ${res.status} ${res.statusText}`)
  }
  }
}

process.exitCode = (staleEvents.length > 0 || lifecycleErrors.length > 0 || emptyCalendars.length > 0 || healthErrors.length > 0) ? 1 : 0
