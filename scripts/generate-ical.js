#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import ical from 'ical-generator'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const EVENTS_DIR = join(ROOT, 'events')
const ICAL_DIR = join(ROOT, 'ical')
const SEASONAL_FOOTBALL_SOURCE_IDS = new Set(['epl', 'bundesliga', 'laliga', 'seriea', 'ligue1', 'ucl', 'uel', 'uecl'])
const TEAM_CALENDAR_SOURCE_IDS = new Set(['nba', 'epl', 'bundesliga', 'laliga', 'seriea', 'ligue1', 'ucl', 'uel', 'uecl'])
const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const LEGACY_ICAL_ALIASES = {
  f1: [{ id: 'f1-2026' }],
  worldcup: [{ id: 'worldcup-2026', eventIdForUid: legacyWorldcupEventId }],
}

// source.id → subcategory 映射（用于 ical 目录细分）
const SUBCATEGORY_MAP = {
  // football
  epl: 'football',
  laliga: 'football',
  bundesliga: 'football',
  seriea: 'football',
  ligue1: 'football',
  ucl: 'football',
  uel: 'football',
  uecl: 'football',
  worldcup: 'football',
  // basketball
  nba: 'basketball',
  // tennis
  'australian-open': 'tennis',
  'roland-garros': 'tennis',
  wimbledon: 'tennis',
  'us-open': 'tennis',
  // motorsport
  f1: 'motorsport',
  // esports (gaming)
  'cs2-tournaments': 'esports',
  // gacha (gaming)
  'genshin-impact': 'gacha',
  'honkai-star-rail': 'gacha',
  // platform (gaming)
  'epic-free': 'platform',
  'steam-sales': 'platform',
  'console-showcases': 'platform',
  // esports (sports)
  lpl: 'esports',
  kpl: 'esports',
}

function getSubcategory(source) {
  return SUBCATEGORY_MAP[source.id] ?? null
}

// 语言模式：通过环境变量 LANG 控制，支持 'zh' (默认) 和 'en'
const LANG = process.env.LANG === 'en' ? 'en' : 'zh'
const IS_EN = LANG === 'en'
const ONLY_SOURCE_ID = process.env.SOURCE_ID?.trim()

mkdirSync(ICAL_DIR, { recursive: true })

function cleanGeneratedIcalFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      cleanGeneratedIcalFiles(fullPath)
    } else if (entry.endsWith('.ics')) {
      unlinkSync(fullPath)
    }
  }
}

function sourceIcalDir(source) {
  const category = source.category ?? 'other'
  const subcategory = getSubcategory(source)
  const dir = subcategory
    ? join(ICAL_DIR, category, subcategory)
    : join(ICAL_DIR, category)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeCalendar(source, filename, calendar) {
  const content = calendar.toString()
  // 写入分类子目录
  writeFileSync(join(sourceIcalDir(source), filename), content, 'utf8')
}

function writeSourceCalendars(source, events) {
  const calZh = createCalendar(source, events)
  writeCalendar(source, `${source.id}.ics`, calZh)

  if (source.name_en) {
    const calEn = createCalendar(source, events, { lang: 'en' })
    writeCalendar(source, `${source.id}-en.ics`, calEn)
  }

  for (const alias of LEGACY_ICAL_ALIASES[source.id] ?? []) {
    const aliasZh = createCalendar(source, events, {
      productId: alias.id,
      url: `https://koyomi.cast/sources/${source.id}`,
      eventIdForUid: alias.eventIdForUid,
    })
    writeCalendar(source, `${alias.id}.ics`, aliasZh)

    if (source.name_en) {
      const aliasEn = createCalendar(source, events, {
        productId: alias.id,
        url: `https://koyomi.cast/sources/${source.id}`,
        eventIdForUid: alias.eventIdForUid,
        lang: 'en',
      })
      writeCalendar(source, `${alias.id}-en.ics`, aliasEn)
    }
  }
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

function parseDateParts(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, month, day }
}

function parseTimeParts(timeStr = '00:00') {
  const [hour, minute, second = 0] = timeStr.split(':').map(Number)
  return { hour, minute, second }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatIsoDate(date) {
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join('-')
}

function formatIsoTime(date) {
  return [
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
  ].join(':')
}

function addDays(dateStr, days) {
  const { year, month, day } = parseDateParts(dateStr)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return formatIsoDate(date)
}

function inferTimeKind(event) {
  if (event.time_kind ?? event.timeKind) return event.time_kind ?? event.timeKind
  const endDate = event.end_date ?? event.endDate
  const hasRange = Boolean(endDate && endDate !== event.date)
  if (event.time && hasRange) return 'datetime_range'
  if (event.time) return 'datetime'
  if (hasRange || event.type === 'range') return 'date_range'
  return 'date'
}

function isTimedEvent(event) {
  const kind = inferTimeKind(event)
  return kind === 'datetime' || kind === 'datetime_range'
}

function eventTimezone(event) {
  return event.timezone ?? DEFAULT_TIMEZONE
}

// Minimal Luxon-compatible wall-clock object for ical-generator.
// Native Date would be formatted in the Node process timezone and drift.
class WallClockDateTime {
  constructor(dateStr, timeStr = '00:00') {
    const { year, month, day } = parseDateParts(dateStr)
    const { hour, minute, second } = parseTimeParts(timeStr)
    this.year = year
    this.month = month
    this.day = day
    this.hour = hour
    this.minute = minute
    this.second = second
    this.isValid = true
    this.zone = { type: 'koyomi-wall-clock' }
  }

  setZone() {
    return this
  }

  toFormat(format) {
    if (format === 'yyyyLLdd') {
      return `${this.year}${pad2(this.month)}${pad2(this.day)}`
    }
    if (format === 'HHmmss') {
      return `${pad2(this.hour)}${pad2(this.minute)}${pad2(this.second)}`
    }
    throw new Error(`Unsupported date format: ${format}`)
  }

  toJSDate() {
    return new Date(Date.UTC(
      this.year,
      this.month - 1,
      this.day,
      this.hour,
      this.minute,
      this.second,
    ))
  }

  toJSON() {
    return `${this.year}-${pad2(this.month)}-${pad2(this.day)}T${pad2(this.hour)}:${pad2(this.minute)}:${pad2(this.second)}`
  }

  addMinutes(minutes) {
    const date = this.toJSDate()
    date.setUTCMinutes(date.getUTCMinutes() + minutes)
    return new WallClockDateTime(formatIsoDate(date), formatIsoTime(date))
  }
}

function wallClockDateTime(dateStr, timeStr = '00:00') {
  return new WallClockDateTime(dateStr, timeStr)
}

function stampForEvent(event) {
  const date = event.last_verified ?? event.date
  return wallClockDateTime(date)
}

function legacyWorldcupEventId(event) {
  return event.id
    .replace(/^worldcup-2026-(\d{2}-\d{2}-)/, 'wc2026-2026-$1')
    .replace(/^worldcup-2026-/, 'wc2026-')
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
        nameEn: team.name_en ?? team.name,
      })
    }
  }
  return Array.from(teams.values()).sort((a, b) => a.id.localeCompare(b.id))
}

function eventIncludesTeam(event, teamId) {
  return event.teams?.home?.id === teamId || event.teams?.away?.id === teamId
}

function teamEventSummary(event, team, isEn = false) {
  const home = event.teams?.home
  const away = event.teams?.away
  if (!home || !away) return eventName(event, isEn)

  const isHome = home.id === team.id
  const opponent = isHome ? away : home
  const opponentName = isEn ? (opponent.name_en ?? opponent.name) : opponent.name
  const teamName = isEn ? (team.nameEn ?? team.name) : team.name
  const marker = isHome ? 'vs' : '@'
  const phaseKey = isEn ? 'Phase' : '阶段'
  const phase = event.details?.[phaseKey] ?? event.details?.['赛段'] ?? ''
  const prefix = phase ? `${phase} · ` : ''
  return `${prefix}${teamName} ${marker} ${opponentName}`
}

// 获取事件名称（根据语言）
function eventName(event, isEn = false) {
  if (isEn && event.name_en) return event.name_en
  return event.name
}

// 获取事件描述（根据语言）
function eventDescription(event, isEn = false) {
  if (isEn && event.description_en) return event.description_en
  return event.description ?? ''
}

function gameTitle(game, isEn = false) {
  if (isEn) return game.title_en ?? game.title
  return game.title_zh ?? game.title
}

function rawgReleaseSummary(event, isEn = false) {
  const games = event.games ?? []
  if (games.length === 0) return eventName(event, isEn)

  const firstTitle = gameTitle(games[0], isEn)

  if (games.length === 1) {
    return isEn ? `${firstTitle} release` : `${firstTitle} 发售`
  }

  const more = games.length - 1

  return isEn
    ? `${firstTitle} + ${more} more ${more === 1 ? 'release' : 'releases'}`
    : `${firstTitle} 等 ${games.length} 款发售`
}

// 获取源名称（根据语言）
function sourceName(source, isEn = false) {
  if (isEn && source.name_en) return source.name_en
  return source.name
}

// 获取源描述（根据语言）
function sourceDescription(source, isEn = false) {
  if (isEn && source.description_en) return source.description_en
  return source.description ?? ''
}

function createCalendar(source, events, options = {}) {
  const isEn = options.lang === 'en'
  const calendarTimezone = source.timezone ?? events.find(event => event.timezone)?.timezone ?? DEFAULT_TIMEZONE
  const cal = ical({
    name: options.name ?? sourceName(source, isEn),
    description: options.description ?? sourceDescription(source, isEn) ?? '',
    prodId: { company: 'Koyomi Cast', product: options.productId ?? source.id },
    url: options.url ?? `https://koyomi.cast/sources/${source.id}`,
    timezone: calendarTimezone,
  })

  for (const event of events) {
    const tz = eventTimezone(event)
    const hasTime = isTimedEvent(event)
    const endDateStr = event.end_date ?? event.endDate ?? event.date
    const endTimeStr = event.end_time ?? event.endTime ?? event.time

    const start = wallClockDateTime(event.date, event.time)
    let end

    if (hasTime) {
      end = inferTimeKind(event) === 'datetime_range'
        ? wallClockDateTime(endDateStr, endTimeStr)
        : start.addMinutes(60)
      // Ensure end is at least 1 hour after start for point-in-time events
      if (end.toJSDate() <= start.toJSDate()) {
        end = start.addMinutes(60)
      }
    } else {
      // All-day: end is the day after the last day (iCal exclusive end)
      end = wallClockDateTime(addDays(endDateStr, 1))
    }

    // 去掉 event.name 中的年份前缀，避免重复（如「2026年报名开始」→「报名开始」）
    // 支持格式：2026年 / 2026 / 2027 等任意 4 位年份 + 可选「年」字 + 可选空格
    // 保护跨赛季格式如「2025-26」，要求年份后不能紧跟数字或连字符
    const rawEventName = options.summaryForEvent?.(event)
      ?? (source.id === 'rawg-releases' ? rawgReleaseSummary(event, isEn) : eventName(event, isEn))
    const shortEventName = rawEventName.replace(/^\d{4}(?:年|\s*)(?![\d-])/u, '')
    const summary = source.id === 'rawg-releases'
      ? shortEventName
      : `${options.calendarName ?? sourceName(source, isEn)} · ${shortEventName}`

    // 构建描述内容
    const descParts = [eventDescription(event, isEn)]

    // 比分信息
    if (event.result && event.details?.['主场'] && event.details?.['客场']) {
      const homeLabel = isEn ? 'Home' : '主场'
      const awayLabel = isEn ? 'Away' : '客场'
      const scoreLabel = isEn ? 'Score' : '比分'
      descParts.push(
        `${scoreLabel}: ${event.details['主场']} ${event.result.home_score} - ${event.result.away_score} ${event.details['客场']}`
      )
    }

    // 游戏列表
    if (event.games?.length) {
      const gamesLabel = source.id === 'rawg-releases'
        ? (isEn ? 'Releases this day:' : '当天发售：')
        : (isEn ? 'Games this week:' : '本周游戏：')
      descParts.push(
        gamesLabel + '\n' + event.games.map((g, i) => {
          const title = gameTitle(g, isEn)
          const priceLabel = isEn ? 'Original price' : '原价'
          const meta = []
          if (g.platforms?.length) meta.push(g.platforms.join(' / '))
          if (g.original_price) meta.push(`${priceLabel} ${g.original_price}`)
          if (g.metacritic != null) meta.push(`Metacritic ${g.metacritic}`)
          if (g.rawg_rating != null) meta.push(`RAWG ${g.rawg_rating}`)
          return `${i + 1}. ${title}${meta.length ? ` (${meta.join(' · ')})` : ''}`
        }).join('\n')
      )
    }

    // 详情键值对
    if (event.details) {
      const detailsForLocale = isEn ? (event.details_en ?? event.details) : event.details
      descParts.push(
        Object.entries(detailsForLocale).map(([k, v]) => `${k}: ${v}`).join('\n')
      )
    }

    cal.createEvent({
      id: `${options.productId ?? source.id}-${options.eventIdForUid?.(event) ?? event.id}@koyomi.cast`,
      start,
      end,
      stamp: stampForEvent(event),
      allDay: !hasTime,
      timezone: hasTime && tz !== 'UTC' ? tz : null,
      summary,
      description: descParts.filter(Boolean).join('\n\n'),
      url: event.url ?? source.source_url ?? `https://koyomi.cast/sources/${source.id}`,
      status: event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
      categories: [{ name: options.calendarName ?? sourceName(source, isEn) }],
    })
  }

  return cal
}

const files = collectJsonFiles(EVENTS_DIR)
let processedSources = 0
let totalEvents = 0
let totalTeamCalendars = 0

if (!ONLY_SOURCE_ID) {
  cleanGeneratedIcalFiles(ICAL_DIR)
}

for (const file of files) {
  const source = JSON.parse(readFileSync(file, 'utf8'))
  if (ONLY_SOURCE_ID && source.id !== ONLY_SOURCE_ID) continue

  processedSources++
  const calendarEvents = eventsForCalendar(source)

  totalEvents += calendarEvents.length
  writeSourceCalendars(source, calendarEvents)

  const teams = TEAM_CALENDAR_SOURCE_IDS.has(source.id) ? collectTeams(calendarEvents) : []
  for (const team of teams) {
    const teamEvents = calendarEvents.filter(event => eventIncludesTeam(event, team.id))
    if (teamEvents.length === 0) continue

    const teamSourceId = `${source.id}-${team.id}`
    const teamNameZh = `${team.name}赛程`
    const teamNameEn = `${team.nameEn} Schedule`

    // 中文球队日历
    const teamCalZh = createCalendar(source, teamEvents, {
      name: teamNameZh,
      calendarName: teamNameZh,
      description: `${team.name}在${source.name}中的比赛日程，自动同步更新。`,
      productId: teamSourceId,
      url: `https://koyomi.cast/sources/${source.id}`,
      summaryForEvent: event => teamEventSummary(event, team, false),
    })
    writeCalendar(source, `${teamSourceId}.ics`, teamCalZh)

    // 英文球队日历
    if (source.name_en) {
      const teamCalEn = createCalendar(source, teamEvents, {
        name: teamNameEn,
        calendarName: teamNameEn,
        description: `${team.nameEn} schedule in ${source.name_en}, auto-synced.`,
        productId: teamSourceId,
        url: `https://koyomi.cast/sources/${source.id}`,
        summaryForEvent: event => teamEventSummary(event, team, true),
        lang: 'en',
      })
      writeCalendar(source, `${teamSourceId}-en.ics`, teamCalEn)
    }

    totalTeamCalendars++
  }

  const teamLabel = teams.length > 0 ? `, ${teams.length} team calendars` : ''
  const enLabel = source.name_en ? ' (+en)' : ''
  console.log(`✓ ${source.id}.ics${enLabel} (${calendarEvents.length}/${source.events?.length ?? 0} events${teamLabel})`)
}

console.log(`\n✓ Generated ${processedSources} source calendars, ${totalTeamCalendars} team calendars, ${totalEvents} events total`)
