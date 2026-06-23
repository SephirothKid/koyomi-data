# Koyomi Data · 岁岁如约

> The open data repository for an event subscription calendar platform. Subscribe to events like podcasts — key dates sync automatically to your calendar.

[中文版](./README.md)

---

## Quick Start

Paste any iCal link into Apple Calendar / Google Calendar / Outlook / DingTalk / Lark Calendar to auto-sync event reminders:

```
webcal://koyomi.pages.dev/ical/exam/cpa.ics
webcal://koyomi.pages.dev/ical/gaming/platform/steam-sales.ics
webcal://koyomi.pages.dev/ical/sports/football/epl.ics
```

> Every event source provides both **Chinese** and **English** `.ics` files (e.g. `cpa.ics` and `cpa-en.ics`).

---

## Event Sources Overview

| Category | Count | Description |
|----------|-------|-------------|
| 🎓 **Exam** `exam/` | 32 | CPA, Bar Exam, Constructor License, Teacher Qualification, CET-4/6, Civil Service Exam, etc. |
| 🎮 **Gaming** `gaming/` | 11 | Steam Sales, Epic Free Games, Genshin/HSR/ZZZ Version Updates, CS2 Tournaments, etc. |
| ⚽ **Sports** `sports/` | 17 | Top 5 Football Leagues, UEFA Champions League, NBA, F1, Tennis Grand Slams, LPL/KPL, etc. |
| 🌍 **Holidays** `holidays/` | 15 | Public holidays for China, US, Japan, UK, Germany, and 10+ other countries |
| 📦 **Other** `other/` | 0 | Reserved category, currently empty |

**Total: 75 event sources · 616 iCal files**

---

## Directory Structure

```
koyomi-data/
├── events/                    # Event source JSON data (single source of truth)
│   ├── exam/                  # Exams
│   ├── gaming/                # Gaming
│   ├── holidays/              # Public holidays by country
│   ├── other/                 # Miscellaneous (reserved)
│   └── sports/                # Sports
│
├── ical/                      # Auto-generated iCal files (do not edit manually)
│   ├── exam/                  # Exams (directly under category)
│   ├── gaming/                # Gaming
│   │   ├── esports/           # Esports tournaments
│   │   ├── gacha/             # Gacha / version updates
│   │   └── platform/          # Platform sales & promotions
│   ├── holidays/              # Public holidays (directly under category)
│   └── sports/                # Sports
│       ├── basketball/        # Basketball (NBA per-team splits)
│       ├── esports/           # Esports as sports (LPL/KPL)
│       ├── football/          # Football / Soccer (top 5 leagues, UCL/EL/CON)
│       ├── motorsport/        # Motorsport (F1)
│       └── tennis/            # Tennis (Grand Slams)
│
├── schemas/                   # JSON Schema validation specs
│   └── event-source.schema.json
│
├── scripts/                   # Data processing scripts
│   ├── validate.js            # JSON Schema validation
│   ├── generate-ical.js       # iCal file generation
│   ├── check-freshness.js     # Data freshness check
│   ├── fill-name-en.mjs       # English field auto-fill tool
│   └── inject-worldcup-teams.mjs  # World Cup team injection tool
│
└── .github/workflows/         # GitHub Actions automation
    ├── validate.yml           # Validate JSON on PR
    ├── generate-ical.yml      # Auto-generate .ics on push
    └── check-freshness.yml    # Daily freshness check
```

---

## Automation Pipeline

| Workflow | Trigger | Function |
|----------|---------|----------|
| **Validate** | PR modifies `events/**` or `schemas/**` | AJV JSON Schema validation + duplicate event ID check |
| **Generate iCal** | Push to main, `events/**` changed | Auto-generate `.ics` files and auto-commit |
| **Check Freshness** | Daily at 02:00 UTC | Check events with `last_verified` > 30 days, create reminder issues |

---

## Data Specification

### Core Design Principles

- **Event sources are year-agnostic**: e.g. `cpa` not `cpa-2026`. Annual data is appended to the `events` array.
- **Subscribe once, valid forever**: After subscribing, new annual data takes effect automatically — no re-subscription needed.
- **Bilingual support**: Every event source and event supports `name` / `name_en`, `description` / `description_en`, `tags` / `tags_en`.
- **Must be verifiable**: Every event must include `last_verified` and `verified_by` (`official` or `community`).

### Key Fields Cheat Sheet

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier, lowercase + hyphens, **no year** |
| `name` / `name_en` | string | Event source name (Chinese / English) |
| `category` | string | `exam` / `gaming` / `sports` / `holidays` / `other` |
| `subcategory` | string | Sub-field, e.g. `finance-accounting`, `esports`, `football` |
| `events[].id` | string | Unique event ID format: `{source}-{year}-{slug}` |
| `events[].date` | string | ISO 8601 date, e.g. `2026-04-08` |
| `events[].end_date` | string | Required only for `range` type events |
| `events[].type` | string | `deadline` / `event` / `range` / `announcement` |
| `events[].timezone` | string | Default for mainland China: `Asia/Shanghai` |
| `events[].status` | string | `planned` / `confirmed` / `active` / `completed` |
| `events[].last_verified` | string | Last verification date `YYYY-MM-DD` |
| `events[].verified_by` | string | `official` (official source) or `community` (community maintained) |

Full specification: [`schemas/event-source.schema.json`](./schemas/event-source.schema.json).

---

## Local Development

```bash
# Install dependencies
npm ci

# Validate all JSON data
npm run validate

# Manually generate iCal files
npm run generate

# Check data freshness
npm run check-freshness
```

---

## Contributing

PRs for adding or correcting event data are welcome!

1. Fork this repository
2. Add or modify JSON files in the appropriate category directory
3. Run `npm run validate` locally to ensure validation passes
4. Submit a PR — **must include official data source links**
5. After maintainer review and merge, Actions will auto-update `.ics` files

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

---

<p align="center">
  <sub>Made with ❤️ by Koyomi - Cast · 岁岁如约</sub>
</p>
