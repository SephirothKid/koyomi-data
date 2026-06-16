# 贡献指南

感谢你愿意为「岁岁如约 / Koyomi - Cast」贡献数据。

## 数据规范

每个事件源是一个 JSON 文件，放在对应的 `events/<category>/` 目录下。

### 文件命名

```
events/exam/cpa.json
events/gaming/steam-sales.json
events/sports/f1.json
```

### 字段说明

参考 `schemas/event-source.schema.json`，必填字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，全小写+连字符，不含年份 |
| `name` | string | 事件源名称 |
| `category` | string | 分类（exam/gaming/sports/shopping） |
| `cycle_kind` | string | 可选。`year` 或 `season` |
| `season_basis` | string | `season` 源必填：`start-year` / `end-year` / `calendar-year` / `custom` |
| `events[].id` | string | 事件唯一ID，格式：`{source}-{year}-{slug}` |
| `events[].date` | string | ISO 8601 日期，如 `2026-04-08` |
| `events[].end_date` | string | 范围事件结束日期 |
| `events[].time` | string | 具体时间事件的官方本地时间，如 `18:00` |
| `events[].end_time` | string | 具体时间范围的结束时间 |
| `events[].time_kind` | string | `date` / `datetime` / `date_range` / `datetime_range` |
| `events[].type` | string | `deadline` / `event` / `range` / `announcement` |
| `events[].year` | number | 周期年份；赛季源按 `season_basis` 定义 |
| `events[].season_key` | string | 可选，赛季筛选稳定 key |
| `events[].season_label` | string | 可选，面向用户的赛季标签 |
| `events[].timezone` | string | 时区，中国大陆默认 `Asia/Shanghai` |
| `events[].last_verified` | string | 最后校验日期，格式 `YYYY-MM-DD` |
| `events[].verified_by` | string | `official`（官方链接）或 `community` |

### 设计原则

- 事件源**不含年份**（如 `cpa` 而非 `cpa-2026`），年度数据作为 events 追加
- 用户订阅一次，新年度数据自动生效，无需重新订阅
- 多年份/多赛季源不要拆成年度源；页面通过年份/赛季筛选展示历史与当前周期
- 跨自然年赛事必须声明 `cycle_kind: "season"` 和 `season_basis`
- 全天日期事件使用 `date` / `date_range`，不按用户时区换算；有明确时刻的比赛、发布会、截止时间使用 `datetime` / `datetime_range`
- `timezone` 必须填写事件官方语境下的 IANA 时区，如 `Asia/Shanghai`、`Europe/London`、`America/New_York`

## 提交流程

1. Fork 本仓库
2. 按模板新增或修改 JSON 文件
3. 本地运行校验：`node scripts/validate.js`
4. 提交 PR，**必须附官方数据来源链接**
5. 维护者审核通过后合并，Actions 自动更新 .ics 文件

## 数据来源要求

- 必须提供官方网站或权威媒体链接
- 不接受来源不明的数据
