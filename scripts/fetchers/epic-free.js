#!/usr/bin/env node
/**
 * Epic Games Store 免费游戏抓取脚本
 * 调用 Epic 公开 API 获取当前和即将免费的的游戏列表
 *
 * 注意：Epic API 在免费促销期间将 originalPrice 归零，无法获取真实原价。
 * 价格字段仅在游戏非免费期间查询成功时才有值，否则留空。
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const EVENTS_DIR = join(ROOT, 'events/gaming')

const EPIC_API = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN'

/**
 * 调用 Epic API 获取免费游戏列表
 */
async function fetchFreeGames() {
  const res = await fetch(EPIC_API)
  if (!res.ok) throw new Error(`Epic API error: ${res.status}`)
  const data = await res.json()

  const elements = data.data?.Catalog?.searchStore?.elements || []

  const current = []
  const upcoming = []

  for (const game of elements) {
    const promos = game.promotions?.promotionalOffers || []
    const upcomingPromos = game.promotions?.upcomingPromotionalOffers || []

    const isCurrentlyFree = promos.some(p =>
      p.promotionalOffers?.some(o => o.discountSetting?.discountPercentage === 0)
    )
    const isUpcomingFree = upcomingPromos.some(p =>
      p.promotionalOffers?.some(o => o.discountSetting?.discountPercentage === 0)
    )

    if (!isCurrentlyFree && !isUpcomingFree) continue

    const promoList = isCurrentlyFree ? promos : upcomingPromos
    const offer = promoList[0]?.promotionalOffers?.[0]
    if (!offer) continue

    const cover = game.keyImages?.find(k => k.type === 'OfferImageTall')?.url
      || game.keyImages?.find(k => k.type === 'Thumbnail')?.url
      || ''

    // 尝试从 price 中获取格式化价格（免费期间通常为 "0"）
    const fmtPrice = game.price?.totalPrice?.fmtPrice?.originalPrice
    const originalPrice = (fmtPrice && fmtPrice !== '0' && !fmtPrice.match(/^¥?0\.?0*$/))
      ? fmtPrice
      : undefined

    const item = {
      title: game.title,
      description: game.description || '',
      cover_url: cover,
      store_url: (() => {
        const slug = game.productSlug || game.urlSlug
        if (slug && typeof slug === 'string' && slug.length > 0) {
          return `https://store.epicgames.com/zh-CN/p/${slug}`
        }
        // fallback: 用 namespace 搜索
        return `https://store.epicgames.com/zh-CN/browse?q=${encodeURIComponent(game.title)}`
      })(),
      original_price: originalPrice,
      startDate: offer.startDate,
      endDate: offer.endDate,
    }

    if (isCurrentlyFree) current.push(item)
    else upcoming.push(item)
  }

  return { current, upcoming }
}

/**
 * 读取现有的 epic-free.json，复用已缓存的价格
 */
function loadExistingData() {
  try {
    const path = join(EVENTS_DIR, 'epic-free.json')
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const priceMap = new Map()
    for (const evt of data.events || []) {
      for (const game of evt.games || []) {
        if (game.original_price) {
          priceMap.set(game.title, game.original_price)
        }
      }
    }
    return { data, priceMap }
  } catch {
    return { data: null, priceMap: new Map() }
  }
}

/**
 * 生成事件 ID：epic-free-{year}-w{week}
 */
function makeEventId(dateStr) {
  const d = new Date(dateStr)
  const year = d.getFullYear()
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7)
  return `epic-free-${year}-w${week}`
}

/**
 * 将 UTC 时间转为北京时间日期字符串
 */
function toBeijingDate(utcStr) {
  const d = new Date(utcStr)
  const beijing = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  return beijing.toISOString().slice(0, 10)
}

async function main() {
  console.log('🎮 Fetching Epic free games...')

  const { current, upcoming } = await fetchFreeGames()
  console.log(`  Current free: ${current.length} games`)
  console.log(`  Upcoming free: ${upcoming.length} games`)

  const { data: existing, priceMap } = loadExistingData()

  // 合并当前和 upcoming，按周分组
  const allGames = [...current, ...upcoming]
  const weekMap = new Map()

  for (const game of allGames) {
    const weekStart = toBeijingDate(game.startDate)
    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, [])
    }
    weekMap.get(weekStart).push(game)
  }

  // 复用缓存价格
  for (const games of weekMap.values()) {
    for (const game of games) {
      if (!game.original_price && priceMap.has(game.title)) {
        game.original_price = priceMap.get(game.title)
      }
    }
  }

  // 构建 events 数组
  const events = []
  const today = new Date().toISOString().slice(0, 10)

  for (const [weekStart, games] of weekMap) {
    const eventId = makeEventId(weekStart)
    const isPast = weekStart < today
    const isCurrent = games.some(g => current.includes(g))

    // 清理游戏对象
    const cleanGames = games.map(g => ({
      title: g.title,
      description: g.description,
      cover_url: g.cover_url,
      original_price: g.original_price || undefined,
      store_url: g.store_url,
    }))

    // 生成事件名称：直接就是游戏名列表，generate-ical 会统一加「来源名 · 」前缀
    const gameNames = cleanGames.map(g => g.title).join('、')
    const isMystery = cleanGames.some(g => g.title.includes('Mystery Game'))
    const name = isMystery
      ? `本周免费游戏即将揭晓`
      : gameNames

    events.push({
      id: eventId,
      name,
      date: weekStart,
      time: '23:00',
      timezone: 'Asia/Shanghai',
      type: 'event',
      year: parseInt(weekStart.slice(0, 4)),
      description: isMystery
        ? '本周 Epic 免费游戏即将揭晓'
        : `本周免费游戏：${gameNames}`,
      url: 'https://store.epicgames.com/zh-CN/free-games',
      status: isPast ? 'completed' : (isCurrent ? 'active' : 'confirmed'),
      last_verified: today,
      verified_by: 'auto',
      details: {
        '领取方式': 'Epic Games Store 客户端/网页',
        '领取条件': '免费注册账号即可',
        '注意事项': '每周四 23:00 更新，领取后永久拥有',
        '本周游戏': gameNames,
      },
      games: cleanGames,
    })
  }

  // 按日期排序
  events.sort((a, b) => a.date.localeCompare(b.date))

  // 保留未来 + 最近 4 周已结束的事件
  const fourWeeksAgo = new Date()
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)
  const filteredEvents = events.filter(e => {
    if (e.status !== 'completed') return true
    return e.date >= fourWeeksAgo.toISOString().slice(0, 10)
  })

  const source = {
    id: 'epic-free',
    name: 'Epic 免费游戏',
    name_en: 'Epic Free Games',
    category: 'gaming',
    subcategory: '免费游戏',
    description: 'Epic Games Store 每周免费游戏更新提醒，每周四 23:00（北京时间）自动轮换。',
    icon: '/logos/epic.png',
    tags: ['Epic', '免费游戏', 'PC游戏'],
    maintainer: 'community',
    source_url: 'https://store.epicgames.com/zh-CN/free-games',
    subscriber_count: existing?.subscriber_count ?? 30160,
    rating: existing?.rating ?? 4.4,
    rating_count: existing?.rating_count ?? 460,
    last_updated: today,
    events: filteredEvents,
  }

  const outPath = join(EVENTS_DIR, 'epic-free.json')
  writeFileSync(outPath, JSON.stringify(source, null, 2) + '\n', 'utf8')

  console.log(`\n✓ Written ${filteredEvents.length} events to ${outPath}`)
  for (const evt of filteredEvents) {
    const gameList = evt.games?.map(g => `${g.title}${g.original_price ? ` (${g.original_price})` : ''}`).join(', ') || 'N/A'
    console.log(`  ${evt.date}: ${gameList}`)
  }
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
