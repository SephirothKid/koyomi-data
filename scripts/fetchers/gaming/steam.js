// Steam 没有公开的促销预告 API，未来促销日期只能人工维护。
// 这个 adapter 做两件事：
// 1. 按日期自动推断 status（past → completed，active → confirmed）
// 2. 调用 Steam Featured API 验证当前是否真的有大促在进行，防止日期预估偏差
//
// 新增促销日期仍需手动写入 steam-sales.json，本 adapter 只负责状态同步。

import { fetchWithTimeout, today } from '../_base.js'

export default {
  id: 'steam-sales',
  category: 'gaming',

  // fetch() 已返回完整的目标状态，直接覆盖即可
  merge(_existing, incoming) {
    return incoming
  },

  async fetch(existingSource) {
    const events = existingSource?.events ?? []
    const todayStr = today()
    const activeSale = await fetchActiveSale()

    return events.map(e => ({
      ...e,
      status: resolveStatus(e, todayStr, activeSale),
      last_verified: todayStr,
      verified_by: 'auto',
    }))
  },
}

// 通过 Steam Featured API 判断当前是否有大促活动
// 大促期间 specials 区通常有 300+ 折扣商品
async function fetchActiveSale() {
  try {
    const res = await fetchWithTimeout(
      'https://store.steampowered.com/api/featuredcategories/?cc=CN&l=schinese',
      {},
      10_000,
    )
    const data = await res.json()
    const count = data.specials?.items?.length ?? 0
    return { isActive: count > 300, count }
  } catch {
    return { isActive: false, count: 0 }
  }
}

function resolveStatus(event, todayStr, activeSale) {
  const start = event.date
  const end = event.end_date ?? event.endDate ?? event.date

  if (end < todayStr) return 'completed'

  // 活动窗口内且 Steam API 确认有大促 → confirmed
  if (start <= todayStr && end >= todayStr && activeSale.isActive) return 'confirmed'

  // 活动窗口内但 API 未确认（可能是小促或 API 抖动）→ 保持原状态
  if (start <= todayStr) return event.status

  // 未来事件，保持不变
  return event.status
}
