#!/usr/bin/env node
// validate.js — 用 AJV 校验 events/ 下所有 JSON 文件是否符合 schema
//
//   node scripts/validate.js
//   node scripts/validate.js --restore-invalid   # 无效文件回滚到 HEAD / 删除未跟踪文件
//   node scripts/validate.js --allow-errors      # 已回滚的错误不阻止后续流程

import { appendFileSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { basename, join, relative, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const EVENTS_DIR = join(ROOT, 'events')
const SCHEMA_FILE = join(ROOT, 'schemas', 'event-source.schema.json')

const ajv = new Ajv({ allErrors: true })
addFormats(ajv)

const schema = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'))
const validate = ajv.compile(schema)
const TIME_KINDS = new Set(['date', 'datetime', 'date_range', 'datetime_range'])
const CYCLE_KINDS = new Set(['year', 'season'])
const SEASON_BASES = new Set(['start-year', 'end-year', 'calendar-year', 'custom'])

function datePart(value) {
  if (!value || typeof value !== 'string') return value
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : value
}

function isValidCalendarDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day
}

function inferTimeKind(event) {
  if (event.time_kind) return event.time_kind
  const endDate = datePart(event.end_date)
  const startDate = datePart(event.date)
  const hasRange = Boolean(endDate && endDate !== startDate)
  if (event.time && hasRange) return 'datetime_range'
  if (event.time) return 'datetime'
  if (hasRange || event.type === 'range') return 'date_range'
  return 'date'
}

function isKnownTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

function validateTimeSemantics(data) {
  const issues = []
  for (const event of data.events ?? []) {
    const kind = inferTimeKind(event)
    if (!TIME_KINDS.has(kind)) {
      issues.push(`${event.id} 的 time_kind 无效：${kind}`)
    }
    if ((kind === 'datetime' || kind === 'datetime_range') && !event.time) {
      issues.push(`${event.id} 是具体时间事件，但缺少 time`)
    }
    if ((kind === 'date_range' || kind === 'datetime_range') && !event.end_date) {
      issues.push(`${event.id} 是范围事件，但缺少 end_date`)
    }
    if (event.end_time && !event.time) {
      issues.push(`${event.id} 设置了 end_time，但缺少 time`)
    }
    if (event.date && !isValidCalendarDate(datePart(event.date))) {
      issues.push(`${event.id} 的 date 不是有效日历日期：${event.date}`)
    }
    if (event.end_date && !isValidCalendarDate(datePart(event.end_date))) {
      issues.push(`${event.id} 的 end_date 不是有效日历日期：${event.end_date}`)
    }
    if (event.timezone && !isKnownTimeZone(event.timezone)) {
      issues.push(`${event.id} 的 timezone 不是有效 IANA 时区：${event.timezone}`)
    }
  }
  return issues
}

function validateCycleSemantics(data) {
  const issues = []

  if (data.cycle_kind && !CYCLE_KINDS.has(data.cycle_kind)) {
    issues.push(`cycle_kind 无效：${data.cycle_kind}`)
  }

  if (data.season_basis && !SEASON_BASES.has(data.season_basis)) {
    issues.push(`season_basis 无效：${data.season_basis}`)
  }

  if (data.cycle_kind === 'season' && !data.season_basis) {
    issues.push('season 类型事件源必须声明 season_basis')
  }

  if (data.cycle_kind !== 'season' && data.season_basis) {
    issues.push('只有 season 类型事件源可以声明 season_basis')
  }

  for (const event of data.events ?? []) {
    if (event.season_key && !/^[a-z0-9][a-z0-9._-]*$/i.test(event.season_key)) {
      issues.push(`${event.id} 的 season_key 只能包含字母、数字、点、下划线和连字符`)
    }

    if (
      event.season_start_year !== undefined
      && event.season_end_year !== undefined
      && event.season_start_year > event.season_end_year
    ) {
      issues.push(`${event.id} 的 season_start_year 不应晚于 season_end_year`)
    }
  }

  return issues
}

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

const flags = new Set(process.argv.slice(2))
const allowErrors = flags.has('--allow-errors')
const restoreInvalid = flags.has('--restore-invalid')

function writeGithubOutput(key, value) {
  const dest = process.env.GITHUB_OUTPUT
  if (!dest) return
  appendFileSync(dest, `${key}=${value}\n`)
}

function gitTracked(relPath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', relPath], {
      cwd: ROOT,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function restoreInvalidFile(relPath, absPath) {
  if (gitTracked(relPath)) {
    const content = execFileSync('git', ['show', `HEAD:${relPath}`], { cwd: ROOT })
    writeFileSync(absPath, content)
    return 'restored'
  }
  unlinkSync(absPath)
  return 'removed'
}

function inspectFile(file) {
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  const issues = []
  let data

  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    issues.push(`JSON 解析失败 — ${e.message}`)
    return { rel, absPath: file, issues }
  }

  const valid = validate(data)
  if (!valid) {
    for (const err of validate.errors ?? []) {
      issues.push(`${err.instancePath || '/'} ${err.message}`)
    }
    return { rel, absPath: file, issues }
  }

  const expectedId = basename(file, '.json')
  if (data.id !== expectedId) {
    issues.push(`source id (${data.id}) 必须与文件名 (${expectedId}) 一致`)
    return { rel, absPath: file, issues }
  }

  if (/-(?:19|20)\d{2}$/.test(data.id)) {
    issues.push('source id 不应包含年份后缀；年份应放在 events[].id 和 events[].year 中')
    return { rel, absPath: file, issues }
  }

  const ids = (data.events ?? []).map(e => e.id)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dupes.length > 0) {
    issues.push(`重复的事件 ID: ${dupes.join(', ')}`)
  }

  issues.push(...validateTimeSemantics(data), ...validateCycleSemantics(data))
  return { rel, absPath: file, issues }
}

const files = collectJsonFiles(EVENTS_DIR)
const invalid = []
let passed = 0

for (const file of files) {
  const result = inspectFile(file)
  if (result.issues.length === 0) {
    console.log(`✓ ${result.rel}`)
    passed++
    continue
  }

  console.error(`✗ ${result.rel}:`)
  for (const issue of result.issues) {
    console.error(`  • ${issue}`)
  }
  invalid.push(result)
}

const unrestorable = []
if (restoreInvalid && invalid.length > 0) {
  for (const item of invalid) {
    try {
      const action = restoreInvalidFile(item.rel, item.absPath)
      const label = action === 'restored' ? '已从 HEAD 恢复' : '已删除未跟踪文件'
      console.error(`  ↩ ${item.rel}: ${label}`)
    } catch (err) {
      unrestorable.push(item.rel)
      console.error(`  ! ${item.rel}: 无法回滚 — ${err.message}`)
    }
  }
}

writeGithubOutput('invalid_count', String(invalid.length))
writeGithubOutput('invalid_sources', invalid.map(item => basename(item.absPath, '.json')).join(','))

if (invalid.length === 0) {
  console.log(`\n✓ 所有 ${files.length} 个文件校验通过`)
} else {
  console.error(`\n${invalid.length} 个来源校验失败 · ${passed} 个通过`)
  if (restoreInvalid) {
    console.error(`已回滚 ${invalid.length - unrestorable.length} 个无效来源，有效数据可继续发布`)
  }
}

if (unrestorable.length > 0) process.exit(1)
if (invalid.length > 0 && !allowErrors) process.exit(1)
