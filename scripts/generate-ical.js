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
  'worldcup-2026': 'football',
  // basketball
  nba: 'basketball',
  // tennis
  'australian-open': 'tennis',
  'roland-garros': 'tennis',
  wimbledon: 'tennis',
  'us-open': 'tennis',
  // motorsport
  'f1-2026': 'motorsport',
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

mkdirSync(ICAL_DIR, { recursive: true })

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

function stampForEvent(event) {
  const date = event.last_verified ?? event.date
  return new Date(`${date}T00:00:00+08:00`)
}

function tzOffset(tz) {
  const offsets = {
    'Asia/Shanghai': '+08:00',
    'Asia/Hong_Kong': '+08:00',
    'Asia/Singapore': '+08:00',
    'Asia/Tokyo': '+09:00',
    'Asia/Seoul': '+09:00',
    'Asia/Ho_Chi_Minh': '+07:00',
    'Asia/Jakarta': '+07:00',
    'Asia/Taipei': '+08:00',
    'America/New_York': '-05:00',
    'America/Toronto': '-05:00',
    'America/Sao_Paulo': '-03:00',
    'America/Los_Angeles': '-08:00',
    'Europe/London': '+00:00',
    'Europe/Berlin': '+01:00',
    'Europe/Paris': '+01:00',
    'Australia/Sydney': '+10:00',
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
  const cal = ical({
    name: options.name ?? sourceName(source, isEn),
    description: options.description ?? sourceDescription(source, isEn) ?? '',
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
    const rawEventName = options.summaryForEvent?.(event) ?? eventName(event, isEn)
    const shortEventName = rawEventName.replace(/^\d{4}(?:年|\s*)(?![\d-])/u, '')
    const summary = `${options.calendarName ?? sourceName(source, isEn)} · ${shortEventName}`

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
      const gamesLabel = isEn ? 'Games this week:' : '本周游戏：'
      descParts.push(
        gamesLabel + '\n' + event.games.map((g, i) => {
          const title = g.title_en ?? g.title
          const priceLabel = isEn ? 'Original price' : '原价'
          return `${i + 1}. ${title}${g.original_price ? ` (${priceLabel} ${g.original_price})` : ''}`
        }).join('\n')
      )
    }

    // 详情键值对
    if (event.details) {
      const detailsEn = event.details_en ?? event.details
      descParts.push(
        Object.entries(detailsEn).map(([k, v]) => `${k}: ${v}`).join('\n')
      )
    }

    cal.createEvent({
      id: `${options.productId ?? source.id}-${event.id}@koyomi.cast`,
      start,
      end,
      stamp: stampForEvent(event),
      allDay: !hasTime,
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
let totalEvents = 0
let totalTeamCalendars = 0

for (const file of files) {
  const source = JSON.parse(readFileSync(file, 'utf8'))
  const calendarEvents = eventsForCalendar(source)

  // 生成中文 iCal
  const calZh = createCalendar(source, calendarEvents)
  totalEvents += calendarEvents.length
  writeCalendar(source, `${source.id}.ics`, calZh)

  // 生成英文 iCal（如果源有英文名称）
  if (source.name_en) {
    const calEn = createCalendar(source, calendarEvents, { lang: 'en' })
    writeCalendar(source, `${source.id}-en.ics`, calEn)
  }

  const teams = collectTeams(calendarEvents)
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

console.log(`\n✓ Generated ${files.length} source calendars, ${totalTeamCalendars} team calendars, ${totalEvents} events total`)
