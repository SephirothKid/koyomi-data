#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const EVENTS_DIR = join(ROOT, 'events')
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

for (const file of collectJsonFiles(EVENTS_DIR)) {
  const rel = file.replace(ROOT + '/', '')
  const source = JSON.parse(readFileSync(file, 'utf8'))

  for (const event of source.events ?? []) {
    if (!event.last_verified) continue
    const verifiedDate = new Date(event.last_verified)
    const daysSince = Math.floor((today - verifiedDate) / (1000 * 60 * 60 * 24))
    const threshold = getStaleThreshold(event, today)
    if (daysSince > threshold) {
      staleEvents.push({
        file: rel,
        sourceId: source.id,
        sourceName: source.name,
        eventId: event.id,
        eventName: event.name,
        lastVerified: event.last_verified,
        daysSince,
        threshold,
        status: event.status ?? 'unknown',
      })
    }
  }
}

if (staleEvents.length === 0) {
  console.log(`✓ 所有事件数据均在对应阈值内更新过`)
  process.exit(0)
}

console.warn(`⚠ 发现 ${staleEvents.length} 个事件数据超过阈值未更新：`)
for (const e of staleEvents) {
  console.warn(`  • ${e.file} / ${e.eventId} — 上次校验：${e.lastVerified}（${e.daysSince} 天前，阈值 ${e.threshold} 天）`)
}

// 创建 GitHub Issue（仅在 Actions 环境中且有 TOKEN）
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY

if (GITHUB_TOKEN && GITHUB_REPOSITORY) {
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
      process.exit(0)
    }
  } else {
    console.error(`✗ 查询现有 Issue 失败: ${issuesRes.status} ${issuesRes.statusText}`)
  }

  // 2. 创建新 Issue
  const body = [
    `## 数据新鲜度检查报告`,
    ``,
    `发现 **${staleEvents.length}** 个事件超过对应阈值未更新，请检查并补充最新数据。`,
    ``,
    `| 事件源 | 事件 ID | 状态 | 上次校验 | 已过天数 | 阈值 |`,
    `|--------|---------|------|---------|---------|------|`,
    ...staleEvents.map(e =>
      `| ${e.sourceName} | \`${e.eventId}\` | ${e.status} | ${e.lastVerified} | ${e.daysSince} 天 | ${e.threshold} 天 |`
    ),
    ``,
    `_由 GitHub Actions 自动创建 · ${today.toISOString().slice(0, 10)}_`,
  ].join('\n')

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      title: `[数据新鲜度] ${staleEvents.length} 个事件超过阈值未更新`,
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

process.exit(0)
