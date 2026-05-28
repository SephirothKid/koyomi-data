#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import ical from 'ical-generator'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const EVENTS_DIR = join(ROOT, 'events')
const ICAL_DIR = join(ROOT, 'ical')

mkdirSync(ICAL_DIR, { recursive: true })

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

function parseEventDate(dateStr, timeStr, tzOffsetStr) {
  if (timeStr) {
    return new Date(`${dateStr}T${timeStr}:00${tzOffsetStr}`)
  }
  return new Date(`${dateStr}T00:00:00${tzOffsetStr}`)
}

function tzOffset(tz) {
  const offsets = {
    'Asia/Shanghai': '+08:00',
    'Asia/Tokyo': '+09:00',
    'America/New_York': '-05:00',
    'America/Los_Angeles': '-08:00',
    'Europe/London': '+00:00',
    'Europe/Berlin': '+01:00',
    'UTC': '+00:00',
  }
  return offsets[tz] ?? '+08:00'
}

const files = collectJsonFiles(EVENTS_DIR)
let totalEvents = 0

for (const file of files) {
  const source = JSON.parse(readFileSync(file, 'utf8'))

  const cal = ical({
    name: source.name,
    description: source.description ?? '',
    prodId: { company: 'Koyomi Cast', product: source.id },
    url: `https://koyomi.cast/sources/${source.id}`,
    timezone: source.timezone ?? 'Asia/Shanghai',
  })

  for (const event of source.events ?? []) {
    const tz = event.timezone ?? 'Asia/Shanghai'
    const offset = tzOffset(tz)
    const hasTime = !!event.time
    const endDateStr = event.end_date ?? event.endDate ?? event.date

    const start = parseEventDate(event.date, event.time, offset)
    let end

    if (hasTime) {
      end = parseEventDate(endDateStr, event.time, offset)
      // Ensure end is at least 1 hour after start for point-in-time events
      if (end <= start) {
        end = new Date(start.getTime() + 60 * 60 * 1000)
      }
    } else {
      // All-day: end is the day after the last day (iCal exclusive end)
      const endDay = new Date(`${endDateStr}T00:00:00${offset}`)
      endDay.setDate(endDay.getDate() + 1)
      end = endDay
    }

    // 去掉 event.name 中的年份前缀，避免重复（如「2026年报名开始」→「报名开始」）
    // 支持格式：2026年 / 2026 / 2027 等任意 4 位年份 + 可选「年」字 + 可选空格
    // 保护跨赛季格式如「2025-26」，要求年份后不能紧跟数字或连字符
    const shortEventName = event.name.replace(/^\d{4}(?:年|\s*)(?![\d-])/u, '')
    const summary = `${source.name} · ${shortEventName}`

    cal.createEvent({
      start,
      end,
      allDay: !hasTime,
      summary,
      description: [
        event.description ?? '',
        event.games?.length
          ? '本周游戏：\n' + event.games.map((g, i) => `${i + 1}. ${g.title}${g.original_price ? ` (原价 ${g.original_price})` : ''}`).join('\n')
          : '',
        event.details
          ? Object.entries(event.details).map(([k, v]) => `${k}: ${v}`).join('\n')
          : '',
      ].filter(Boolean).join('\n\n'),
      url: event.url ?? source.source_url ?? `https://koyomi.cast/sources/${source.id}`,
      status: event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
      categories: [{ name: source.name }],
    })
    totalEvents++
  }

  const outPath = join(ICAL_DIR, `${source.id}.ics`)
  writeFileSync(outPath, cal.toString(), 'utf8')
  console.log(`✓ ${source.id}.ics (${source.events?.length ?? 0} events)`)
}

console.log(`\n✓ Generated ${files.length} .ics files, ${totalEvents} events total`)
