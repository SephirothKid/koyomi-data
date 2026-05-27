import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const EVENTS_DIR = join(ROOT, 'events')

export function readSource(category, id) {
  const path = join(EVENTS_DIR, category, `${id}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeSource(category, id, data) {
  mkdirSync(join(EVENTS_DIR, category), { recursive: true })
  writeFileSync(
    join(EVENTS_DIR, category, `${id}.json`),
    JSON.stringify({ ...data, last_updated: today() }, null, 2) + '\n',
    'utf8',
  )
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

// Merge by event ID — incoming events overwrite matching existing ones; unmatched are kept
export function mergeEvents(existingEvents = [], incoming) {
  const map = new Map(existingEvents.map(e => [e.id, e]))
  for (const e of incoming) map.set(e.id, { ...map.get(e.id), ...e })
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// Replace all events for a given year, leave other years untouched
export function replaceYearEvents(existingEvents = [], incoming, year) {
  const kept = existingEvents.filter(e => e.year !== year)
  return [...kept, ...incoming].sort((a, b) => a.date.localeCompare(b.date))
}

// Compare only fields that matter — ignores last_verified / verified_by churn
export function diffSummary(before = [], after) {
  const beforeMap = new Map(before.map(e => [e.id, e]))
  return {
    added: after.filter(e => !beforeMap.has(e.id)),
    updated: after.filter(e => {
      const old = beforeMap.get(e.id)
      return old && (
        old.date !== e.date ||
        old.time !== e.time ||
        old.status !== e.status ||
        old.name !== e.name
      )
    }),
    total: after.length,
  }
}

export async function fetchWithTimeout(url, options = {}, ms = 15_000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}

// Exponential backoff retry
export async function retry(fn, attempts = 3, baseDelay = 1_000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === attempts - 1) throw err
      await new Promise(r => setTimeout(r, baseDelay * 2 ** i))
    }
  }
}
