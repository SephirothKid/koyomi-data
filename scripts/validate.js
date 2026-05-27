#!/usr/bin/env node
// validate.js — 用 AJV 校验 events/ 下所有 JSON 文件是否符合 schema

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const EVENTS_DIR = join(ROOT, 'events')
const SCHEMA_FILE = join(ROOT, 'schemas', 'event-source.schema.json')

const ajv = new Ajv({ allErrors: true })
addFormats(ajv)

const schema = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'))
const validate = ajv.compile(schema)

function collectJsonFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectJsonFiles(fullPath))
    } else if (entry.endsWith('.json')) {
      files.push(fullPath)
    }
  }
  return files
}

const files = collectJsonFiles(EVENTS_DIR)
let errors = 0

for (const file of files) {
  const rel = file.replace(ROOT + '/', '')
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`✗ ${rel}: JSON 解析失败 — ${e.message}`)
    errors++
    continue
  }

  const valid = validate(data)
  if (!valid) {
    console.error(`✗ ${rel}:`)
    for (const err of validate.errors) {
      console.error(`  • ${err.instancePath || '/'} ${err.message}`)
    }
    errors++
  } else {
    // 额外检查：event id 不得重复
    const ids = data.events.map(e => e.id)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    if (dupes.length > 0) {
      console.error(`✗ ${rel}: 重复的事件 ID: ${dupes.join(', ')}`)
      errors++
    } else {
      console.log(`✓ ${rel}`)
    }
  }
}

if (errors > 0) {
  console.error(`\n共 ${errors} 个文件校验失败`)
  process.exit(1)
} else {
  console.log(`\n✓ 所有 ${files.length} 个文件校验通过`)
}
