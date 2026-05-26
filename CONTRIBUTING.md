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
| `events[].id` | string | 事件唯一ID，格式：`{source}-{year}-{slug}` |
| `events[].date` | string | ISO 8601 日期，如 `2026-04-08` |
| `events[].type` | string | `deadline` / `event` / `range` / `announcement` |
| `events[].timezone` | string | 时区，中国大陆默认 `Asia/Shanghai` |
| `events[].last_verified` | string | 最后校验日期，格式 `YYYY-MM-DD` |
| `events[].verified_by` | string | `official`（官方链接）或 `community` |

### 设计原则

- 事件源**不含年份**（如 `cpa` 而非 `cpa-2026`），年度数据作为 events 追加
- 用户订阅一次，新年度数据自动生效，无需重新订阅

## 提交流程

1. Fork 本仓库
2. 按模板新增或修改 JSON 文件
3. 本地运行校验：`node scripts/validate.js`
4. 提交 PR，**必须附官方数据来源链接**
5. 维护者审核通过后合并，Actions 自动更新 .ics 文件

## 数据来源要求

- 必须提供官方网站或权威媒体链接
- 不接受来源不明的数据
