# Koyomi Data · 岁岁如约

> 一个事件订阅日历平台的公开数据仓库。像订阅播客一样订阅你关心的事件，关键日期自动同步到日历。

[English Version](./README.en.md)

---

## 快速开始

将任意 iCal 链接粘贴到 Apple Calendar / Google Calendar / Outlook / 钉钉 / 飞书日历，即可自动同步事件提醒：

```
webcal://koyomi.pages.dev/ical/exam/cpa.ics
webcal://koyomi.pages.dev/ical/gaming/platform/steam-sales.ics
webcal://koyomi.pages.dev/ical/sports/football/epl.ics
```

> 每个事件源同时提供 **中文** 和 **英文** 两个版本的 `.ics` 文件（如 `cpa.ics` 和 `cpa-en.ics`）。

---

## 事件源概览

| 分类 | 数量 | 说明 |
|------|------|------|
| 🎓 **考试** `exam/` | 30+ | CPA、法考、建造师、教师资格证、四六级、公务员考试等 |
| 🎮 **游戏** `gaming/` | 7+ | Steam 促销、Epic 喜加一、原神/星铁版本更新、CS2 赛事等 |
| ⚽ **体育** `sports/` | 18+ | 五大联赛、欧冠、NBA、F1、网球大满贯、LPL/KPL 等 |
| 🛍️ **购物** `shopping/` | 4+ | 黑五、Prime Day 等 |
| 🎬 **娱乐** `entertainment/` | 2+ | Bilibili 年度活动、音乐节等 |
| 🌍 **节假日** `holidays/` | 15+ | 中国、美国、日本、英国、德国等 15 国公共假期 |
| 📦 **其他** `other/` | 1+ | 杂项事件源 |

**总计：76+ 事件源 · 512+ iCal 文件**

---

## 目录结构

```
koyomi-data/
├── events/                    # 事件源 JSON 数据（唯一正本）
│   ├── exam/                  # 考试类
│   ├── gaming/                # 游戏类
│   │   ├── esports/           # 电竞赛事
│   │   ├── gacha/             # 抽卡/版本更新
│   │   └── platform/          # 平台促销
│   ├── sports/                # 体育类
│   │   ├── basketball/        # 篮球
│   │   ├── esports/           # 电竞体育
│   │   ├── football/          # 足球
│   │   ├── motorsport/        # 赛车
│   │   └── tennis/            # 网球
│   ├── shopping/              # 购物节
│   ├── entertainment/         # 影视音乐娱乐
│   ├── holidays/              # 各国公共假期
│   └── other/                 # 其他
│
├── ical/                      # 自动生成的 iCal 文件（请勿手动编辑）
│   └── {category}/
│       └── {subcategory}/
│           ├── {source-id}.ics      # 中文版
│           └── {source-id}-en.ics   # 英文版
│
├── schemas/                   # JSON Schema 校验规范
│   └── event-source.schema.json
│
├── scripts/                   # 数据处理脚本
│   ├── validate.js            # JSON Schema 校验
│   ├── generate-ical.js       # iCal 文件生成
│   ├── check-freshness.js     # 数据新鲜度检查
│   └── fill-name-en.mjs       # 英文字段补全工具
│
└── .github/workflows/         # GitHub Actions 自动化
    ├── validate.yml           # PR 时校验 JSON
    ├── generate-ical.yml      # Push 时自动生成 .ics
    └── check-freshness.yml    # 每日检查数据新鲜度
```

---

## 自动化流水线

| Workflow | 触发条件 | 功能 |
|----------|----------|------|
| **Validate** | PR 修改 `events/**` 或 `schemas/**` | AJV 校验 JSON Schema + 检查重复 event ID |
| **Generate iCal** | Push 到 main，修改 `events/**` | 自动生成 `.ics` 文件并自动 commit |
| **Check Freshness** | 每日凌晨 02:00 UTC | 检查 `last_verified` 超 30 天的事件，创建提醒 Issue |

---

## 数据规范

### 核心设计原则

- **事件源不含年份**：如 `cpa` 而非 `cpa-2026`，年度数据作为 `events` 数组追加
- **订阅一次，永久有效**：用户订阅后，新年度数据自动生效，无需重新订阅
- **年份/赛季分离**：自然年事件用 `cycle_kind: "year"`；跨自然年联赛用 `cycle_kind: "season"` + `season_basis`
- **双语支持**：每个事件源和事件均支持 `name` / `name_en`、`description` / `description_en`、`tags` / `tags_en`
- **必须可验证**：每个事件必须包含 `last_verified` 和 `verified_by`（`official` 或 `community`）
- **时间语义明确**：全天日期不做时区换算，具体时间事件保留官方时区并可在前端转换为用户本地时间

### 关键字段速查

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，全小写+连字符，**不含年份** |
| `name` / `name_en` | string | 事件源名称（中/英） |
| `category` | string | `exam` / `gaming` / `sports` / `shopping` / `entertainment` / `holidays` / `other` |
| `subcategory` | string | 细分领域，如 `财会`、`esports`、`football` |
| `cycle_kind` | string | 可选。`year` 表示按自然年切换，`season` 表示按赛事赛季切换 |
| `season_basis` | string | `season` 源必填：`start-year` / `end-year` / `calendar-year` / `custom` |
| `events[].id` | string | 事件唯一 ID，格式：`{source}-{year}-{slug}` |
| `events[].date` | string | ISO 8601 日期，如 `2026-04-08` |
| `events[].end_date` | string | 仅 `range` 类型事件需要 |
| `events[].time` / `events[].end_time` | string | 具体时间或时间范围，格式 `HH:mm` |
| `events[].time_kind` | string | `date` / `datetime` / `date_range` / `datetime_range` |
| `events[].type` | string | `deadline` / `event` / `range` / `announcement` |
| `events[].year` | number | 周期年份。非赛季源通常等于开始日期年份；赛季源按 `season_basis` 定义 |
| `events[].season_key` | string | 可选。赛季筛选用稳定 key；缺省时由 `year` 推导 |
| `events[].season_label` | string | 可选。展示标签，如 `2025-26`、`2026 Spring` |
| `events[].timezone` | string | 中国大陆默认 `Asia/Shanghai` |
| `events[].status` | string | `planned` / `confirmed` / `active` / `completed` |
| `events[].last_verified` | string | 最后校验日期 `YYYY-MM-DD` |
| `events[].verified_by` | string | `official`（官方来源）或 `community`（社区维护） |

完整规范见 [`schemas/event-source.schema.json`](./schemas/event-source.schema.json)。

`date` / `date_range` 表示官方日期语境下的全天事件，例如节假日、考试日期、促销日期，不应因为用户时区不同而前后移动。`datetime` / `datetime_range` 表示具体时刻或时间段，例如比赛开球、发布会、报名截止，应保留官方 `timezone` 并允许客户端展示用户本地时间。

### 周期与订阅规则

- 事件源始终是长期主题 ID，禁止按年份拆成 `epl-2027`、`nba-2027` 等新源。
- 多年份/多赛季数据追加在同一个 JSON 文件中，前端详情页通过年份/赛季筛选切换。
- 默认展示周期按“进行中 → 下一条未来事件 → 最新已发布周期”选择。
- iCal URL 不随年份变化；生成的 `.ics` 默认只包含未来事件和最近 30 天内结束的事件，避免多年历史持续进入用户日历。
- 跨年赛季的 `season_basis` 示例：欧洲足球 `2025-26` 使用 `start-year`，NBA `2025-26` 使用 `end-year`，LPL/KPL 这类自然年赛季使用 `calendar-year`。

---

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/SephirothKid/koyomi-data.git
cd koyomi-data

# 安装依赖
npm ci

# 校验所有 JSON 数据
npm run validate

# 手动生成 iCal 文件
npm run generate

# 检查数据新鲜度
npm run check-freshness
```

---

## 贡献数据

欢迎提交 PR 补充或修正事件数据！

1. Fork 本仓库
2. 在对应分类目录下新增或修改 JSON 文件
3. 本地运行 `npm run validate` 确保通过校验
4. 提交 PR，**必须附官方数据来源链接**
5. 维护者审核通过后合并，Actions 自动更新 `.ics` 文件

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 相关项目

| 项目 | 说明 |
|------|------|
| [koyomi](https://github.com/SephirothKid/koyomi) | 主仓库 — Web 站点（Astro + React）、iOS App（SwiftUI）、微信小程序 |
| [koyomi-data](https://github.com/SephirothKid/koyomi-data) | 本仓库 — 公开事件数据与 iCal 生成 |

---

## 许可证

事件数据遵循开放数据原则，具体许可证见主仓库。欢迎自由使用、引用和贡献。

---

<p align="center">
  <sub>Made with ❤️ by <a href="https://my-koyomi.com">Koyomi - Cast · 岁岁如约</a></sub>
</p>
