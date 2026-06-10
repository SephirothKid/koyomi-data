// 从现有 worldcup.json 的事件名称解析队伍，注入 teams 对象
// 运行：node data/scripts/inject-worldcup-teams.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WC_PATH = resolve(__dirname, '../events/sports/worldcup.json')

// 中文名 → 队伍 meta（与 fetcher 保持一致）
const TEAM_BY_CN = {
  '阿尔及利亚':      { id: 'alg', code: 'ALG' },
  '阿根廷':          { id: 'arg', code: 'ARG' },
  '澳大利亚':        { id: 'aus', code: 'AUS' },
  '奥地利':          { id: 'aut', code: 'AUT' },
  '比利时':          { id: 'bel', code: 'BEL' },
  '波黑':            { id: 'bih', code: 'BIH' },
  '巴西':            { id: 'bra', code: 'BRA' },
  '加拿大':          { id: 'can', code: 'CAN' },
  '佛得角':          { id: 'cpv', code: 'CPV' },
  '哥伦比亚':        { id: 'col', code: 'COL' },
  '克罗地亚':        { id: 'cro', code: 'CRO' },
  '库拉索':          { id: 'cuw', code: 'CUW' },
  '捷克':            { id: 'cze', code: 'CZE' },
  '刚果民主共和国':  { id: 'cod', code: 'COD' },
  '厄瓜多尔':        { id: 'ecu', code: 'ECU' },
  '埃及':            { id: 'egy', code: 'EGY' },
  '英格兰':          { id: 'eng', code: 'ENG' },
  '法国':            { id: 'fra', code: 'FRA' },
  '德国':            { id: 'ger', code: 'GER' },
  '加纳':            { id: 'gha', code: 'GHA' },
  '海地':            { id: 'hai', code: 'HAI' },
  '伊朗':            { id: 'irn', code: 'IRN' },
  '伊拉克':          { id: 'irq', code: 'IRQ' },
  '科特迪瓦':        { id: 'civ', code: 'CIV' },
  '日本':            { id: 'jpn', code: 'JPN' },
  '约旦':            { id: 'jor', code: 'JOR' },
  '墨西哥':          { id: 'mex', code: 'MEX' },
  '摩洛哥':          { id: 'mar', code: 'MAR' },
  '荷兰':            { id: 'ned', code: 'NED' },
  '新西兰':          { id: 'nzl', code: 'NZL' },
  '挪威':            { id: 'nor', code: 'NOR' },
  '巴拿马':          { id: 'pan', code: 'PAN' },
  '巴拉圭':          { id: 'par', code: 'PAR' },
  '葡萄牙':          { id: 'por', code: 'POR' },
  '卡塔尔':          { id: 'qat', code: 'QAT' },
  '沙特阿拉伯':      { id: 'ksa', code: 'KSA' },
  '苏格兰':          { id: 'sco', code: 'SCO' },
  '塞内加尔':        { id: 'sen', code: 'SEN' },
  '南非':            { id: 'rsa', code: 'RSA' },
  '韩国':            { id: 'kor', code: 'KOR' },
  '西班牙':          { id: 'esp', code: 'ESP' },
  '瑞典':            { id: 'swe', code: 'SWE' },
  '瑞士':            { id: 'sui', code: 'SUI' },
  '突尼斯':          { id: 'tun', code: 'TUN' },
  '土耳其':          { id: 'tur', code: 'TUR' },
  '美国':            { id: 'usa', code: 'USA' },
  '乌拉圭':          { id: 'uru', code: 'URU' },
  '乌兹别克斯坦':    { id: 'uzb', code: 'UZB' },
}

function parseTeam(raw) {
  raw = raw.trim()
  // 淘汰赛占位符："W73" / "L85" / "W99"
  if (/^[WL]\d+$/.test(raw)) {
    return { id: raw.toLowerCase(), code: raw, name: raw }
  }
  const meta = TEAM_BY_CN[raw]
  if (meta) return { id: meta.id, code: meta.code, name: raw }
  // 未知：生成兜底
  return { id: raw.toLowerCase().replace(/\s+/g, '-'), code: raw.slice(0, 3).toUpperCase(), name: raw }
}

// 从事件名提取两支队伍的中文名
// 格式："小组赛第 1 轮 A组 · 墨西哥 vs 南非"
//       "三十二强赛 · W73 vs W75"
function extractTeamNames(eventName) {
  const part = eventName.split('·').at(-1)?.trim() ?? ''
  const idx = part.indexOf(' vs ')
  if (idx < 0) return null
  return [part.slice(0, idx).trim(), part.slice(idx + 4).trim()]
}

const data = JSON.parse(readFileSync(WC_PATH, 'utf8'))

let injected = 0
let skipped = 0

data.events = data.events.map(event => {
  // 已有 teams 则跳过
  if (event.teams) { skipped++; return event }

  const pair = extractTeamNames(event.name)
  if (!pair) { skipped++; return event }

  const [t1raw, t2raw] = pair
  const { details, ...rest } = event
  // 移除 details.队伍，其他字段保留
  const { 队伍: _removed, ...restDetails } = details ?? {}

  injected++
  return {
    ...rest,
    teams: {
      team1: parseTeam(t1raw),
      team2: parseTeam(t2raw),
    },
    ...(Object.keys(restDetails).length > 0 ? { details: restDetails } : {}),
  }
})

writeFileSync(WC_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log(`✓ 注入完成：${injected} 个事件已添加 teams，${skipped} 个跳过`)
