#!/usr/bin/env node
/**
 * fill-name-en.mjs
 *
 * Batch-fills missing `name_en` (and `name_zh`) for calendar events.
 * Safe to re-run: skips events that already have name_en.
 *
 * Usage:
 *   node data/scripts/fill-name-en.mjs              # write in place
 *   node data/scripts/fill-name-en.mjs --dry-run    # preview only
 *   node data/scripts/fill-name-en.mjs --verbose    # show unhandled events
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EVENTS_DIR = join(__dirname, '../events')
const DRY_RUN = process.argv.includes('--dry-run')
const VERBOSE = process.argv.includes('--verbose') || DRY_RUN

// ─── Football team ID → English name ──────────────────────────────────────

const TEAMS_FOOTBALL = {
  // EPL
  ars: 'Arsenal',       avl: 'Aston Villa',   bha: 'Brighton',      bou: 'Bournemouth',
  bre: 'Brentford',     bur: 'Burnley',        che: 'Chelsea',       cry: 'Crystal Palace',
  eve: 'Everton',       ful: 'Fulham',         lee: 'Leeds Utd',     liv: 'Liverpool',
  man: 'Man United',    mnc: 'Man City',       new: 'Newcastle',     nfo: 'Nottm Forest',
  sun: 'Sunderland',    tot: 'Spurs',          whu: 'West Ham',      wol: 'Wolves',
  // Bundesliga
  mun: 'Bayern',        dor: 'Dortmund',       rbl: 'RB Leipzig',    b04: 'Leverkusen',
  sge: 'Frankfurt',     vfb: 'Stuttgart',      fcu: 'Union Berlin',  wob: 'Wolfsburg',
  scf: 'Freiburg',      tsg: 'Hoffenheim',     bmg: 'Gladbach',      m05: 'Mainz',
  svw: 'Bremen',        stp: 'St. Pauli',      hdh: 'Heidenheim',    fca: 'Augsburg',
  koe: 'Köln',          hsv: 'Hamburg',
  // La Liga
  rma: 'Real Madrid',   bar: 'Barcelona',      atm: 'Atlético',      ath: 'Athletic Club',
  rso: 'Real Sociedad', bet: 'Real Betis',     sev: 'Sevilla',       val: 'Valencia',
  vil: 'Villarreal',    cel: 'Celta Vigo',     osa: 'Osasuna',       get: 'Getafe',
  ala: 'Alavés',        ray: 'Rayo Vallecano', gir: 'Girona',        mll: 'Mallorca',
  lev: 'Levante',       ovi: 'Oviedo',         esp: 'Espanyol',      elc: 'Elche',
  // Serie A
  int: 'Inter',         juv: 'Juventus',       nap: 'Napoli',
  roma: 'Roma',         ata: 'Atalanta',       bol: 'Bologna',       fio: 'Fiorentina',
  laz: 'Lazio',         udi: 'Udinese',        gen: 'Genoa',         sas: 'Sassuolo',
  lec: 'Lecce',         cag: 'Cagliari',       ver: 'Verona',        cre: 'Cremonese',
  como: 'Como',         pis: 'Pisa',
  // Ligue 1
  psg: 'PSG',           olm: 'Marseille',      mon: 'Monaco',        lyon: 'Lyon',
  ren: 'Rennes',        lill: 'Lille',         nice: 'Nice',         nan: 'Nantes',
  str: 'Strasbourg',    rcl: 'Lens',           hac: 'Le Havre',      tou: 'Toulouse',
  ang: 'Angers',        aux: 'Auxerre',        lor: 'Lorient',       metz: 'Metz',
  // UCL / UEL / UECL extras
  slb: 'Benfica',       scp: 'Sporting CP',    fcp: 'Porto',         fcb: 'Basel',
  psv: 'PSV',           aja: 'Ajax',           gal: 'Galatasaray',   fen: 'Fenerbahçe',
  dzg: 'Dinamo Zagreb', rsb: 'Red Star',       bru: 'Club Brugge',   slp: 'Slavia Prague',
  kbh: 'Copenhagen',    bodo: 'Bodø/Glimt',    qar: 'Qarabağ',       usg: 'St-Gilloise',
  oly: 'Olympiacos',    pao: 'Panathinaikos',  paok: 'PAOK',         fey: 'Feyenoord',
  ran: 'Rangers',       scb: 'Braga',          slz: 'Red Bull Salzburg',
  stg: 'Sturm Graz',    utr: 'Utrecht',        yb: 'Young Boys',
  fer: 'Ferencváros',   genk: 'Genk',          lud: 'Ludogorets',    mal: 'Malmö',
  mid: 'Midtjylland',   plz: 'Viktoria Plzeň', mta: 'Maccabi Tel Aviv',
  fcsb: 'FCSB',         skbr: 'Brann',         kyiv: 'Dynamo Kyiv',  rije: 'Rijeka',
  ham: 'Hammarby',      jag: 'Jagiellonia',    dri: 'Drita',         kups: 'KuPS',
  fcl: 'Lausanne-Sport',noa: 'Noah',           vie: 'Rapid Vienna',  she: 'Shelbourne',
  shr: 'Shamrock Rovers',sig: 'Sigma Olomouc', lech: 'Lech Poznań',  legi: 'Legia Warsaw',
  sam: 'Samsunspor',    nkc: 'NK Celje',       omon: 'Omonia',       aek: 'AEK Athens',
  az: 'AZ',             gae: 'Gent',           abe: 'Aberdeen',      zrin: 'Zrinjski',
  spp: 'Sparta Prague', ucra: 'U. Craiova',    lri: 'Lincoln Red Imps',
}

// Ligue 1 has 'par' = Paris FC; Serie A has 'par' = Parma — resolve by file context
const TEAMS_LIGUE1_OVERRIDES = { par: 'Paris FC', bre: 'Brest' }
const TEAMS_SERIEA_OVERRIDES  = { par: 'Parma', tor: 'Torino', mil: 'AC Milan' }

function footballTeamName(id, code, filePath) {
  if (filePath.includes('ligue1') && TEAMS_LIGUE1_OVERRIDES[id]) return TEAMS_LIGUE1_OVERRIDES[id]
  if (filePath.includes('seriea') && TEAMS_SERIEA_OVERRIDES[id])  return TEAMS_SERIEA_OVERRIDES[id]
  return TEAMS_FOOTBALL[id] ?? code ?? id.toUpperCase()
}

// ─── League, phase, keyword tables ────────────────────────────────────────

const LEAGUE_ZH_TO_EN = {
  '英超': 'EPL', '德甲': 'Bundesliga', '西甲': 'La Liga',
  '意甲': 'Serie A', '法甲': 'Ligue 1',
  '欧冠': 'UCL', '欧联杯': 'UEL', '欧协联': 'UECL',
}

// Sub-phases that follow the league prefix: "欧冠 联赛阶段 · ..."
const LEAGUE_PHASES_ZH = {
  '联赛阶段': 'League Phase',
  '淘汰赛附加赛': 'Knockout Playoff',
  '16强': 'Round of 16', '8强': 'Quarter-finals',
  '4强': 'Semi-finals', '决赛': 'Final',
}

const F1_SESSIONS = {
  '冲刺排位赛': 'Sprint Qualifying', '冲刺赛': 'Sprint',
  '自由练习赛1': 'Practice 1', '自由练习赛2': 'Practice 2', '自由练习赛3': 'Practice 3',
  '排位赛': 'Qualifying', '正赛': 'Race',
}

const NBA_PHASES = {
  '季前赛': 'Preseason', '常规赛': 'Regular Season', '季后赛': 'Playoffs',
  '首轮': 'First Round', '次轮': 'Conference Semis',
  '东决': 'Eastern Conference Finals', '西决': 'Western Conference Finals',
  '总决赛': 'Finals',
}

const GAME_NAMES = {
  '原神': 'Genshin Impact',
  '崩坏：星穹铁道': 'Honkai: Star Rail',
  '崩坏3': 'Honkai Impact 3rd',
  '绝区零': 'Zenless Zone Zero',
  '鸣潮': 'Wuthering Waves',
}

const GAME_EVENT_TYPES = {
  '前瞻直播窗口': 'Preview Stream',
  '版本更新': 'Version Update',
  '下半卡池窗口': 'Second Half Banner',
  '上半卡池窗口': 'First Half Banner',
}

const EXAM_NAMES = {
  '高级会计': 'Senior Accountant',
  '中级会计': 'Intermediate Accountant',
  '初级会计': 'Junior Accountant',
  '成人高考': 'Adult College Entrance Exam',
  '银行业职业资格': 'Banking Professional',
  'CATTI': 'CATTI',
  '二级造价工程师': 'Cost Engineer (Level 2)',
  '一级造价工程师': 'Cost Engineer (Level 1)',
  '一级消防工程师': 'Fire Protection Engineer',
  '一级建造师': 'Constructor (Level 1)',
  '二级建造师': 'Constructor (Level 2)',
  '监理工程师': 'Supervision Engineer',
  '注册安全工程师': 'Registered Safety Engineer',
  '基金从业': 'Fund Qualification',
  '期货从业': 'Futures Professional',
  '卫生资格': 'Health Professional',
  '执业药师': 'Licensed Pharmacist',
  '全国计算机等级考试': 'NCRE',
  'NCRE': 'NCRE',
  '护士执业资格': 'Nurse Qualification',
  '专利代理师': 'Patent Agent',
  '全国英语等级考试': 'PETS',
  '医师资格': 'Physician Qualification',
  '证券水平评价': 'Securities Professional',
  '自学考试': 'Self-taught Exam',
  '社会工作者': 'Social Worker',
  '税务师': 'Tax Agent',
  '高考': 'Gaokao',
  '四六级': 'CET (Level 4 & 6)',
  '国考': 'National Civil Service Exam',
  '省考': 'Provincial Civil Service Exam',
  '考研': 'Postgraduate Entrance Exam',
  '软考': 'Software Professional Exam',
  '教师资格': 'Teacher Qualification',
  '教资': 'Teacher Qualification',
  '司法考试': 'Bar Exam',
  '法律职业资格': 'Legal Professional Qualification',
  '多省联考': 'Provincial Civil Service Exam',
}

const EXAM_PHASES = {
  // 复合阶段（放前面，保证最长匹配优先）
  '医学综合二试': 'Medical Exam (Retake)', '医学综合考试': 'Medical Comprehensive Exam',
  '实践技能考试': 'Practical Skills Exam',
  '全国统考': 'National Exam', '预约式考试': 'Appointment Exam',
  '专场考试': 'Special Session',
  '第一考试周': 'Exam Week 1', '第二考试周': 'Exam Week 2', '第三考试周': 'Exam Week 3',
  '准考证打印': 'Admit Card', '打印准考证': 'Admit Card', '准考证下载': 'Admit Card Download',
  '准考证打印窗口': 'Admit Card Window',
  '现场确认': 'On-site Confirmation',
  '成绩查询': 'Score Query', '成绩公布': 'Score Release', '查分': 'Score Check',
  '缴费': 'Payment', '网上缴费': 'Online Payment', '缴费确认截止': 'Payment Deadline',
  '志愿填报': 'Application Submission',
  // 国考/省考特有
  '公告发布': 'Announcement', '报名开始': 'Registration Start', '报名截止': 'Registration Deadline',
  '资格审查截止': 'Qualification Review Deadline', '公共科目笔试': 'Written Exam',
  '笔试成绩查询': 'Score Query', '笔试成绩公布窗口': 'Score Release Window',
  '集中发布窗口': 'Announcement Window', '报名集中窗口': 'Registration Window',
  '多省联考笔试窗口': 'Multi-Province Exam Window', '面试窗口': 'Interview Window',
  '笔试窗口': 'Written Exam Window',
  // 考研特有
  '预报名开始': 'Pre-Registration Start', '预报名截止': 'Pre-Registration End',
  '正式报名开始': 'Registration Start', '正式报名截止': 'Registration End',
  '网上确认': 'Online Verification', '初试成绩公布': 'Score Release',
  '国家线公布': 'National Score Line Released', '初试': 'Written Exam',
  // 通用（短词放后面）
  '笔试报名': 'Registration', '笔试成绩': 'Score Release',
  '面试报名': 'Interview Registration',
  '笔试': 'Written Exam', '面试': 'Interview',
  '报名': 'Registration', '考试': 'Exam',
}

const STEAM_FESTIVALS = {
  '推理节': 'Mystery Fest', '桌游节': 'Board Game Fest', '打字节': 'Type-along Fest',
  '竞技 PvP 节': 'Competitive PvP Fest', '马术节': 'Equestrian Fest',
  '生存节': 'Survival Fest', '复古节': 'Retro Fest', '钓鱼节': 'Fishing Fest',
  '动作节': 'Action Fest', '角色扮演节': 'RPG Fest', '策略节': 'Strategy Fest',
  '模拟节': 'Simulation Fest', '恐怖节': 'Horror Fest', '独立游戏节': 'Indie Fest',
  '视觉小说节': 'Visual Novel Fest', '格斗游戏节': 'Fighting Fest',
  '赛车节': 'Racing Fest', '足球节': 'Football Fest', '冒险节': 'Adventure Fest',
  '农场节': 'Farming Fest', '建造节': 'Building Fest', '解谜节': 'Puzzle Fest',
  '冬季特卖': 'Winter Sale', '夏季特卖': 'Summer Sale',
  '春季特卖': 'Spring Sale', '秋季特卖': 'Autumn Sale', '年末特卖': 'Year-End Sale',
  // Additional festivals
  '新品节（2月版）': 'Next Fest (February)', '新品节（6月版）': 'Next Fest (June)',
  '新品节（10月版）': 'Next Fest (October)',
  '塔防节': 'Tower Defense Fest', '家居建造节': 'Home Design Fest',
  '找茬寻物节': 'Hidden Object Fest', '中世纪奇幻节': 'Medieval Fantasy Fest',
  '卡组构筑节': 'Deck-builder Fest', '海洋节': 'Ocean Fest',
  '弹幕射击节': 'Bullet Hell Fest', '社交推理节': 'Social Deduction Fest',
  '火车铁路节': 'Train Fest', '赛博朋克节': 'Cyberpunk Fest',
  '弹球节': 'Pinball Fest', '生存建造节': 'Survival Craft Fest',
  '编程节': 'Coding Fest', '小队 RPG 节': 'Party RPG Fest',
  '厨艺节': 'Cooking Fest', '自动战斗 RPG 节': 'Auto-battler RPG Fest',
  '夏季大促': 'Summer Sale', '秋季大促': 'Autumn Sale', '冬季大促': 'Winter Sale',
  '万圣节特卖': 'Halloween Sale',
}

const TW_HOLIDAYS = {
  '开国纪念日（元旦）': "Founding Day (New Year's Day)",
  '开国纪念日': 'Founding Day',
  '中华民国开国纪念日': 'Founding Day of the R.O.C.',
  '农历除夕': "Lunar New Year's Eve",
  '春节': 'Lunar New Year',
  '和平纪念日': 'Peace Memorial Day',
  '儿童节暨清明节': "Children's Day & Tomb Sweeping Day",
  '清明节': 'Tomb Sweeping Day',
  '儿童节': "Children's Day",
  '劳动节': 'Labor Day',
  '端午节': 'Dragon Boat Festival',
  '中秋节': 'Mid-Autumn Festival',
  '国庆日': 'National Day',
  '补班': 'Makeup Workday',
}

const LPL_PHASES = {
  '第一赛段开赛窗口': 'Split 1 Start',     '第一赛段淘汰赛窗口': 'Split 1 Playoffs',
  '第二赛段开赛窗口': 'Split 2 Start',     '第二赛段决赛窗口': 'Split 2 Finals',
  '夏季赛开赛窗口': 'Summer Split Start',  '夏季赛决赛窗口': 'Summer Finals',
  '世界赛参赛资格窗口': 'Worlds Qualification',
}

const APPLE_EVENTS = {
  'Apple 春季发布窗口': 'Apple Spring Event', 'Apple 春季发布会': 'Apple Spring Event',
  'Apple 秋季发布窗口': 'Apple Fall Event',   'Apple 秋季发布会': 'Apple Fall Event',
  'WWDC Keynote': 'WWDC Keynote',
  '新 iPhone 预购窗口': 'iPhone Pre-order Window',
  '新 iPhone 发售窗口': 'iPhone Launch',
  'iPad 发布窗口': 'iPad Release', 'MacBook 发布窗口': 'MacBook Release',
}

const BLACK_FRIDAY_EVENTS = {
  '黑五早鸟促销': 'Black Friday Early Sale',
  '感恩节促销': 'Thanksgiving Sale',
  '黑色星期五': 'Black Friday',
  'Cyber Monday': 'Cyber Monday',  // already English
}

const PRIME_DAY_EVENTS = {
  'Prime Day 公告窗口': 'Prime Day Announcement',
  'Prime Day 活动窗口': 'Prime Day Event',
  'Prime Day 最后一天提醒': 'Prime Day Final Day',
}

// ─── Pattern handlers ──────────────────────────────────────────────────────

function handleFootballMatch(event, filePath) {
  const teams = event.teams
  if (!teams?.home?.id || !teams?.away?.id) return null

  const homeName = footballTeamName(teams.home.id, teams.home.code, filePath)
  const awayName = footballTeamName(teams.away.id, teams.away.code, filePath)
  const name = event.name ?? ''

  for (const [zh, en] of Object.entries(LEAGUE_ZH_TO_EN)) {
    if (!name.startsWith(zh)) continue
    const rest = name.slice(zh.length).replace(/^[\s·]+/, '')

    // Check for sub-phase prefix like "联赛阶段 · Arsenal @ ..."
    for (const [phZh, phEn] of Object.entries(LEAGUE_PHASES_ZH)) {
      if (rest.startsWith(phZh)) {
        return `${en} ${phEn} · ${awayName} @ ${homeName}`
      }
    }
    return `${en} · ${awayName} @ ${homeName}`
  }
  return null
}

function handleF1(event) {
  const name = event.name ?? ''
  // Longest match first to avoid partial matches (e.g. "冲刺赛" vs "冲刺排位赛")
  for (const [zh, en] of Object.entries(F1_SESSIONS)) {
    if (name.endsWith(zh)) {
      const gpName = name.slice(0, name.length - zh.length).trim()
      return `${gpName} ${en}`
    }
  }
  return null
}

function handleNBA(event) {
  const name = event.name ?? ''

  // "2025-26 常规赛 · HOU vs OKC" or "2025-26 季前赛"
  const seasonM = name.match(/^(\d{4}-\d{2})\s+(.+?)(?:\s*[··]\s*(.+))?$/)
  if (seasonM) {
    const [, season, phaseZh, teams] = seasonM
    const phaseEn = NBA_PHASES[phaseZh.trim()] ?? phaseZh.trim()
    return teams ? `${season} ${phaseEn} · ${teams.trim()}` : `${season} ${phaseEn}`
  }

  // "NBA Cup（联赛杯） · ATL vs IND"
  if (name.startsWith('NBA Cup')) {
    const teamsM = name.match(/[··]\s*(.+)$/)
    return teamsM ? `NBA Cup · ${teamsM[1].trim()}` : 'NBA Cup'
  }

  // "Play-In 附加赛 · ATL vs MIA"
  if (name.startsWith('Play-In')) {
    const teamsM = name.match(/[··]\s*(.+)$/)
    return teamsM ? `Play-In Tournament · ${teamsM[1].trim()}` : 'Play-In Tournament'
  }

  // "全明星周末：全明星正赛"
  if (name.startsWith('全明星周末')) {
    const ALL_STAR = {
      '全明星正赛': 'All-Star Game', '全明星技巧挑战': 'All-Star Skills Challenge',
      '新秀挑战赛决赛': 'Rising Stars Game', '新秀挑战赛半决赛': 'Rising Stars Semifinal',
      '三分球大赛': '3-Point Contest', '扣篮大赛': 'Slam Dunk Contest',
    }
    const subM = name.match(/[：:]\s*(.+)$/)
    if (subM) {
      const subEn = ALL_STAR[subM[1].trim()] ?? subM[1].trim()
      return `All-Star Weekend: ${subEn}`
    }
    return 'All-Star Weekend'
  }

  // Playoff series: "东部首轮 第 N 场 · HOU vs OKC" / "NBA 总决赛 第 N 场 · ..."
  const PLAYOFF_ROUNDS = {
    'NBA 总决赛': 'NBA Finals', '东部决赛': 'Eastern Conference Finals',
    '西部决赛': 'Western Conference Finals', '东部半决赛': 'Eastern Conference Semifinals',
    '西部半决赛': 'Western Conference Semifinals', '东部首轮': 'Eastern First Round',
    '西部首轮': 'Western First Round',
  }
  for (const [zh, en] of Object.entries(PLAYOFF_ROUNDS)) {
    if (!name.startsWith(zh)) continue
    const gameM = name.match(/第\s*(\d+)\s*场/)
    const teamsM = name.match(/[··]\s*(.+)$/)
    const gameNum = gameM ? ` Game ${gameM[1]}` : ''
    const teams = teamsM ? ` · ${normalizeNBAEnglishSuffix(teamsM[1])}` : ''
    return `${en}${gameNum}${teams}`
  }

  return null
}

function normalizeNBAEnglishSuffix(text) {
  const ifNecessary = text.includes('（如有必要）')
  const cleaned = text.replace(/（如有必要）/g, '').trim()
  return `${cleaned}${ifNecessary ? ' (if necessary)' : ''}`
}

function handleGaming(event) {
  const name = event.name ?? ''
  for (const [gameZh, gameEn] of Object.entries(GAME_NAMES)) {
    if (!name.startsWith(gameZh)) continue
    const rest = name.slice(gameZh.length).trim()
    for (const [typeZh, typeEn] of Object.entries(GAME_EVENT_TYPES)) {
      if (rest.endsWith(typeZh)) {
        const version = rest.slice(0, rest.length - typeZh.length).trim()
        return `${gameEn} ${version} ${typeEn}`.trim()
      }
    }
  }
  return null
}

function handleExam(event) {
  const name = event.name ?? ''
  // Strip year prefix: "2026年", "2026年度", "2026上半年", "2026下半年", "2026年3月", "2026"（直接跟考试名）
  const stripped = name.replace(/^\d{4}(?:年度|年\d+月|年|上半年|下半年)?/, '').trim()
  const yearM = name.match(/^(\d{4})/)
  const year = yearM ? yearM[1] : ''
  const halfM = name.match(/^(\d{4})(上半年|下半年)/)
  const halfEn = halfM ? (halfM[2] === '上半年' ? ' H1' : ' H2') : ''
  const monthM = name.match(/^(\d{4})年(\d+)月/)
  const monthEn = monthM ? ` ${new Date(2000, Number(monthM[2]) - 1).toLocaleString('en', { month: 'short' })}` : ''

  for (const [zhName, enName] of Object.entries(EXAM_NAMES)) {
    if (!stripped.includes(zhName)) continue
    const rest = stripped.replace(zhName, '').trim()

    // Find the longest matching phase keyword
    let bestPhase = '', bestPhaseEn = ''
    for (const [phZh, phEn] of Object.entries(EXAM_PHASES)) {
      if (rest.endsWith(phZh) && phZh.length > bestPhase.length) {
        bestPhase = phZh
        bestPhaseEn = phEn
      }
    }

    const prefix = year ? `${year}${halfEn}${monthEn} ` : ''
    if (bestPhase) return `${prefix}${enName} ${bestPhaseEn}`.trim()
    return `${prefix}${enName}`.trim()
  }
  return null
}

function handleSteamSales(event) {
  const name = event.name ?? ''
  const m = name.match(/^(\d{4})\s+(.+)$/)
  if (!m) return null
  const [, year, festZh] = m
  const festEn = STEAM_FESTIVALS[festZh.trim()]
  return festEn ? `${year} Steam ${festEn}` : null
}

function handleTaiwanHolidays(event) {
  const name = event.name ?? ''
  if (TW_HOLIDAYS[name]) return TW_HOLIDAYS[name]
  for (const [zh, en] of Object.entries(TW_HOLIDAYS)) {
    if (name.includes(zh)) return en
  }
  return null
}

function handleLPL(event) {
  const name = event.name ?? ''
  const m = name.match(/^(\d{4})\s+LPL\s+(.+)$/)
  if (!m) return null
  const [, year, rest] = m
  const phaseEn = LPL_PHASES[rest] ?? rest
  return `${year} LPL ${phaseEn}`
}

function handleRolandGarros(event) {
  const name = event.name ?? ''
  const m = name.match(/^(\d{4})\s+法国网球公开赛(.+)$/)
  if (!m) return null
  const [, year, stage] = m
  const STAGES = {
    '资格赛': 'Qualifying', '正赛': 'Main Draw',
    '女单决赛': "Women's Final", '男单决赛': "Men's Final",
    '半决赛': 'Semi-finals', '四分之一决赛': 'Quarter-finals',
  }
  const stageEn = STAGES[stage] ?? stage
  return `${year} French Open ${stageEn}`
}

function handleShopping(event, sourceId) {
  const name = event.name ?? ''
  const m = name.match(/^(\d{4})\s+(.+)$/)
  if (!m) return null
  const [, year, rest] = m

  if (sourceId === 'apple-events') {
    const en = APPLE_EVENTS[rest]
    return en ? `${year} ${en}` : null
  }
  if (sourceId === 'black-friday') {
    const en = BLACK_FRIDAY_EVENTS[rest]
    return en ? `${year} ${en}` : null
  }
  if (sourceId === 'prime-day') {
    const en = PRIME_DAY_EVENTS[rest]
    return en ? `${year} ${en}` : null
  }
  return null
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

function generateNameEn(event, sourceId, filePath) {
  // Football match (has teams field with IDs)
  if (event.teams?.home?.id) {
    const r = handleFootballMatch(event, filePath)
    if (r) return r
  }

  // File-specific handlers
  if (filePath.includes('/sports/f1')) return handleF1(event)
  if (filePath.includes('/sports/nba')) return handleNBA(event)
  if (filePath.includes('/gaming/lpl')) return handleLPL(event)
  if (filePath.includes('/sports/roland-garros')) return handleRolandGarros(event)

  if (filePath.includes('/gaming/genshin') ||
      filePath.includes('/gaming/honkai') ||
      filePath.includes('/gaming/zzz') ||
      filePath.includes('/gaming/wuthering')) {
    return handleGaming(event)
  }

  if (filePath.includes('/gaming/steam-sales')) return handleSteamSales(event)

  if (filePath.includes('/holidays/tw-public-holidays')) return handleTaiwanHolidays(event)

  if (sourceId === 'apple-events' || sourceId === 'black-friday' || sourceId === 'prime-day') {
    return handleShopping(event, sourceId)
  }

  if (filePath.includes('/exam/')) return handleExam(event)

  return null
}

// ─── File walking ──────────────────────────────────────────────────────────

function walkDir(dir, cb) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    statSync(full).isDirectory() ? walkDir(full, cb) : entry.endsWith('.json') && cb(full)
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

let filled = 0, skipped = 0, unhandled = 0
const unhandledList = []

walkDir(EVENTS_DIR, (filePath) => {
  let data
  try { data = JSON.parse(readFileSync(filePath, 'utf8')) } catch { return }

  const events = data.events
  if (!Array.isArray(events) || events.length === 0) return

  const sourceId = data.id ?? ''
  const relPath = filePath.replace(EVENTS_DIR + '/', '')
  let modified = false

  for (const event of events) {
    if (event.name_en) { skipped++; continue }
    if (!event.name) continue

    const nameEn = generateNameEn(event, sourceId, filePath)
    if (nameEn) {
      event.name_en = nameEn
      if (!event.name_zh) event.name_zh = event.name
      filled++
      modified = true
    } else {
      unhandled++
      unhandledList.push(`  ${relPath}: ${event.name}`)
    }
  }

  if (modified && !DRY_RUN) {
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
  }
})

console.log(`\nfill-name-en results:`)
console.log(`  ✓ filled   : ${filled}`)
console.log(`  — skipped  : ${skipped} (already had name_en)`)
console.log(`  ✗ unhandled: ${unhandled}`)
if (DRY_RUN) console.log('\n  (dry run — no files written)')

if (VERBOSE && unhandledList.length > 0) {
  console.log(`\nUnhandled events (${unhandledList.length}):`)
  for (const line of unhandledList.slice(0, 30)) console.log(line)
  if (unhandledList.length > 30) console.log(`  ... and ${unhandledList.length - 30} more`)
}
