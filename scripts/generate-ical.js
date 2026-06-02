#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import ical from 'ical-generator'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const EVENTS_DIR = join(ROOT, 'events')
const ICAL_DIR = join(ROOT, 'ical')
const SEASONAL_FOOTBALL_SOURCE_IDS = new Set(['epl', 'bundesliga', 'laliga', 'seriea', 'ligue1', 'ucl', 'uel', 'uecl'])

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

function currentSeasonYear() {
  const now = new Date()
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear()
}

function recentCompletedCutoff(days = 30) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function eventsForCalendar(source) {
  const events = source.events ?? []
  if (!SEASONAL_FOOTBALL_SOURCE_IDS.has(source.id)) return events

  const season = currentSeasonYear()
  const cutoff = recentCompletedCutoff()
  return events.filter(event =>
    event.year >= season ||
    (event.status === 'completed' && event.date >= cutoff),
  )
}

function collectTeams(events) {
  const teams = new Map()
  for (const event of events) {
    for (const side of ['home', 'away']) {
      const team = event.teams?.[side]
      if (!team?.id || !team?.name) continue
      teams.set(team.id, {
        id: team.id,
        code: team.code ?? team.id.toUpperCase(),
        name: team.name,
      })
    }
  }
  return Array.from(teams.values()).sort((a, b) => a.id.localeCompare(b.id))
}

function eventIncludesTeam(event, teamId) {
  return event.teams?.home?.id === teamId || event.teams?.away?.id === teamId
}

function teamEventSummary(event, team) {
  const home = event.teams?.home
  const away = event.teams?.away
  if (!home || !away) return event.name

  const isHome = home.id === team.id
  const opponent = isHome ? away : home
  const marker = isHome ? 'vs' : '@'
  const phase = event.details?.['阶段'] ?? event.details?.['赛段'] ?? ''
  const prefix = phase ? `${phase} · ` : ''
  return `${prefix}${team.name} ${marker} ${opponent.name}`
}

function createCalendar(source, events, options = {}) {
  const cal = ical({
    name: options.name ?? source.name,
    description: options.description ?? source.description ?? '',
    prodId: { company: 'Koyomi Cast', product: options.productId ?? source.id },
    url: options.url ?? `https://koyomi.cast/sources/${source.id}`,
    timezone: source.timezone ?? 'Asia/Shanghai',
  })

  for (const event of events) {
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
    const rawEventName = options.summaryForEvent?.(event) ?? event.name
    const shortEventName = rawEventName.replace(/^\d{4}(?:年|\s*)(?![\d-])/u, '')
    const summary = `${options.calendarName ?? source.name} · ${shortEventName}`

    cal.createEvent({
      start,
      end,
      allDay: !hasTime,
      summary,
      description: [
        event.description ?? '',
        event.result && event.details?.['主场'] && event.details?.['客场']
          ? `比分: ${event.details['主场']} ${event.result.home_score} - ${event.result.away_score} ${event.details['客场']}`
          : '',
        event.games?.length
          ? '本周游戏：\n' + event.games.map((g, i) => `${i + 1}. ${g.title}${g.original_price ? ` (原价 ${g.original_price})` : ''}`).join('\n')
          : '',
        event.details
          ? Object.entries(event.details).map(([k, v]) => `${k}: ${v}`).join('\n')
          : '',
      ].filter(Boolean).join('\n\n'),
      url: event.url ?? source.source_url ?? `https://koyomi.cast/sources/${source.id}`,
      status: event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
      categories: [{ name: options.calendarName ?? source.name }],
    })
  }

  return cal
}

const files = collectJsonFiles(EVENTS_DIR)
let totalEvents = 0
let totalTeamCalendars = 0

for (const file of files) {
  const source = JSON.parse(readFileSync(file, 'utf8'))
  const calendarEvents = eventsForCalendar(source)
  const cal = createCalendar(source, calendarEvents)
  totalEvents += calendarEvents.length

  const outPath = join(ICAL_DIR, `${source.id}.ics`)
  writeFileSync(outPath, cal.toString(), 'utf8')

  const teams = collectTeams(calendarEvents)
  for (const team of teams) {
    const teamEvents = calendarEvents.filter(event => eventIncludesTeam(event, team.id))
    if (teamEvents.length === 0) continue

    const teamSourceId = `${source.id}-${team.id}`
    const teamName = `${team.name}赛程`
    const teamCal = createCalendar(source, teamEvents, {
      name: teamName,
      calendarName: teamName,
      description: `${team.name}在${source.name}中的比赛日程，自动同步更新。`,
      productId: teamSourceId,
      url: `https://koyomi.cast/sources/${source.id}`,
      summaryForEvent: event => teamEventSummary(event, team),
    })

    writeFileSync(join(ICAL_DIR, `${teamSourceId}.ics`), teamCal.toString(), 'utf8')
    totalTeamCalendars++
  }

  const teamLabel = teams.length > 0 ? `, ${teams.length} team calendars` : ''
  console.log(`✓ ${source.id}.ics (${calendarEvents.length}/${source.events?.length ?? 0} events${teamLabel})`)
}

console.log(`\n✓ Generated ${files.length} source calendars, ${totalTeamCalendars} team calendars, ${totalEvents} events total`)
