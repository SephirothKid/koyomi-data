# koyomi-data

> 「岁岁如约 / Koyomi - Cast」的公开事件数据仓库

订阅你关心的事件，自动同步到日历。本仓库存放所有事件源的 JSON 数据，并自动生成 iCal 订阅文件。

## 使用方法

将以下链接粘贴进 Apple Calendar / Google Calendar / Outlook：

```
webcal://koyomi.pages.dev/ical/cpa.ics
webcal://koyomi.pages.dev/ical/steam-sales.ics
```

## 贡献数据

欢迎提交 PR 补充或修正事件数据，详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 目录结构

```
events/          事件数据（按分类）
  exam/          考试类
  gaming/        游戏类
  sports/        体育类
  shopping/      购物节
ical/            自动生成的 .ics 文件（勿手动编辑）
schemas/         JSON Schema 校验规范
scripts/         数据校验 / iCal 生成 / 新鲜度检查脚本
.github/         GitHub Actions 自动化
```
