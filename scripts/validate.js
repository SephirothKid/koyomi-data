#!/usr/bin/env node
// validate.js — 用 AJV 校验 events/ 下所有 JSON 文件是否符合 schema

import { readFileSync, readdirSync, statSync } from 'fs'
import { basename, join, resolve, dirname } from 'path'
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

function validateTimeSemantics(data, rel) {
  let count = 0
  for (const event of data.events ?? []) {
    const kind = inferTimeKind(event)
    if (!TIME_KINDS.has(kind)) {
      console.error(`✗ ${rel}: ${event.id} 的 time_kind 无效：${kind}`)
      count++
    }
    if ((kind === 'datetime' || kind === 'datetime_range') && !event.time) {
      console.error(`✗ ${rel}: ${event.id} 是具体时间事件，但缺少 time`)
      count++
    }
    if ((kind === 'date_range' || kind === 'datetime_range') && !event.end_date) {
      console.error(`✗ ${rel}: ${event.id} 是范围事件，但缺少 end_date`)
      count++
    }
    if (event.end_time && !event.time) {
      console.error(`✗ ${rel}: ${event.id} 设置了 end_time，但缺少 time`)
      count++
    }
    if (event.date && !isValidCalendarDate(datePart(event.date))) {
      console.error(`✗ ${rel}: ${event.id} 的 date 不是有效日历日期：${event.date}`)
      count++
    }
    if (event.end_date && !isValidCalendarDate(datePart(event.end_date))) {
      console.error(`✗ ${rel}: ${event.id} 的 end_date 不是有效日历日期：${event.end_date}`)
      count++
    }
    if (event.timezone && !isKnownTimeZone(event.timezone)) {
      console.error(`✗ ${rel}: ${event.id} 的 timezone 不是有效 IANA 时区：${event.timezone}`)
      count++
    }
  }
  return count
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

const files = collectJsonFiles(EVENTS_DIR)
let errors = 0

for (const file of files) {
  const rel = file.replace(ROOT + '/', '')
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`✗ ${rel}: JSON 解析失败 — ${e.message}`)
    errors++
    continue
  }

  const valid = validate(data)
  if (!valid) {
    console.error(`✗ ${rel}:`)
    for (const err of validate.errors) {
      console.error(`  • ${err.instancePath || '/'} ${err.message}`)
    }
    errors++
  } else {
    const expectedId = basename(file, '.json')
    if (data.id !== expectedId) {
      console.error(`✗ ${rel}: source id (${data.id}) 必须与文件名 (${expectedId}) 一致`)
      errors++
      continue
    }

    if (/-(?:19|20)\d{2}$/.test(data.id)) {
      console.error(`✗ ${rel}: source id 不应包含年份后缀；年份应放在 events[].id 和 events[].year 中`)
      errors++
      continue
    }

    // 额外检查：event id 不得重复
    const ids = data.events.map(e => e.id)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    if (dupes.length > 0) {
      console.error(`✗ ${rel}: 重复的事件 ID: ${dupes.join(', ')}`)
      errors++
    } else {
      const semanticErrors = validateTimeSemantics(data, rel)
      if (semanticErrors > 0) {
        errors += semanticErrors
      } else {
        console.log(`✓ ${rel}`)
      }
    }
  }
}

if (errors > 0) {
  console.error(`\n共 ${errors} 个文件校验失败`)
  process.exit(1)
} else {
  console.log(`\n✓ 所有 ${files.length} 个文件校验通过`)
}
