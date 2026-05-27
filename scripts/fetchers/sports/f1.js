// 数据源：Jolpica API（Ergast 社区镜像）
// https://api.jolpi.ca/ergast/f1/{year}.json
// 包含全年赛程、排位赛、冲刺赛时间（UTC），自动换算为北京时间（+08:00）

import { fetchWithTimeout, retry, replaceYearEvents, today } from '../_base.js'

const YEAR = new Date().getFullYear()
const API = `https://api.jolpi.ca/ergast/f1/${YEAR}.json?limit=100`

export default {
  id: `f1-${YEAR}`,
  category: 'sports',

  // 整年赛程替换策略：用 API 返回的数据覆盖当年所有事件，历史年份保留
  merge(existing, incoming) {
    return replaceYearEvents(existing?.events ?? [], incoming, YEAR)
  },

  async fetch() {
    return retry(fetchRaces)
  },
}

async function fetchRaces() {
  const res = await fetchWithTimeout(API)
  const { MRData } = await res.json()
  const races = MRData.RaceTable?.Races ?? []
  if (races.length === 0) throw new Error('API 返回空赛程')

  const events = []

  for (const race of races) {
    const rn = String(race.round).padStart(2, '0')
    const shortName = race.raceName.replace(/ Grand Prix$/i, '').trim()
    const circuit = race.Circuit.circuitName
    const location = `${race.Circuit.Location.locality}, ${race.Circuit.Location.country}`
    const extra = { circuit, location, round: `第 ${race.round} 站，共 ${races.length} 站` }

    if (race.Qualifying) {
      const { date, time } = utcToCST(race.Qualifying.date, race.Qualifying.time ?? '12:00:00Z')
      events.push(mkEvent(`f1-${YEAR}-r${rn}-quali`, `${shortName} GP 排位赛`, date, time, race, extra))
    }

    if (race.Sprint) {
      const { date, time } = utcToCST(race.Sprint.date, race.Sprint.time ?? '11:00:00Z')
      events.push(mkEvent(`f1-${YEAR}-r${rn}-sprint`, `${shortName} GP 冲刺赛`, date, time, race, extra))
    }

    const { date, time } = utcToCST(race.date, race.time ?? '14:00:00Z')
    events.push(mkEvent(`f1-${YEAR}-r${rn}-race`, `${shortName} GP 正赛`, date, time, race, extra))
  }

  return events
}

function mkEvent(id, name, date, time, race, details) {
  return {
    id,
    name,
    date,
    time,
    timezone: 'Asia/Shanghai',
    type: 'event',
    year: YEAR,
    description: `${race.raceName}（北京时间）`,
    url: `https://www.formula1.com/en/racing/${YEAR}`,
    status: date < today() ? 'completed' : 'confirmed',
    last_verified: today(),
    verified_by: 'auto',
    details,
  }
}

function utcToCST(dateStr, timeStr) {
  const cst = new Date(new Date(`${dateStr}T${timeStr}`).getTime() + 8 * 3_600_000)
  return {
    date: cst.toISOString().slice(0, 10),
    time: cst.toISOString().slice(11, 16),
  }
}
