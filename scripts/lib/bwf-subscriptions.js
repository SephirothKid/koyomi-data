/** Pure projection shared by iCal generation and the Web build. No network access. */
export const BWF_PROJECTS = {
  MS: ['男单', "Men's singles"], WS: ['女单', "Women's singles"], MD: ['男双', "Men's doubles"], WD: ['女双', "Women's doubles"], XD: ['混双', 'Mixed doubles'],
  'Thomas Cup': ['汤姆斯杯', 'Thomas Cup'], 'Uber Cup': ['尤伯杯', 'Uber Cup'],
  'Sudirman Cup': ['苏迪曼杯', 'Sudirman Cup'],
}
export const bwfProjectKey = project => project === 'Sudirman Cup' ? 'sudirman-team' : project.toLowerCase().replaceAll(' ', '-')

export function buildBwfSubscriptions(source) {
  if (!['bwf-world-tour', 'bwf-majors'].includes(source.id)) return { scopes: [], events: [] }
  const series = new Map()
  for (const event of source.events) {
    const key = event.details?.bwf_series_id
    if (!key) throw new Error(`BWF: missing series for ${event.id}`)
    series.set(key, { key, name: event.details.bwf_series_name, name_en: event.details.bwf_series_name_en })
  }
  const projects = source.id === 'bwf-world-tour' ? ['MS', 'WS', 'MD', 'WD', 'XD'] : Object.keys(BWF_PROJECTS)
  const scopes = []
  const add = (series, project) => {
    const suffix = [series?.key, project && bwfProjectKey(project)].filter(Boolean).join('-')
    const name = [series?.name, project && BWF_PROJECTS[project][0]].filter(Boolean).join(' · ')
    const name_en = [series?.name_en, project && BWF_PROJECTS[project][1]].filter(Boolean).join(' · ')
    scopes.push({ id: `${source.id}-${suffix}`, series: series?.key, project, name, name_en })
  }
  projects.forEach(project => add(null, project))
  for (const value of series.values()) {
    add(value, null)
    const selected = value.key === 'thomas-uber-cup' ? ['Thomas Cup', 'Uber Cup'] : value.key === 'sudirman-cup' ? ['Sudirman Cup'] : projects.filter(project => !project.includes('Cup'))
    for (const project of selected) add(value, project)
  }
  const events = []
  for (const tournament of source.events) {
    const seriesKey = tournament.details.bwf_series_id
    const seriesId = `${source.id}-${seriesKey}`
    const matches = (source.sports_schedules?.[tournament.id]?.days ?? []).flatMap(day => day.matches)
    if (!matches.length) events.push({ ...tournament, scopeOnly: true, scopeSourceIds: [seriesId] })
    for (const match of matches) {
      if (!BWF_PROJECTS[match.discipline]) throw new Error(`BWF: unknown project ${match.discipline}`)
      const project = bwfProjectKey(match.discipline)
      const names = [match.side1.names.join(' / '), match.side2.names.join(' / ')].join(' vs ')
      const timing = { estimated: ['预计', 'Estimated'], not_before: ['不早于', 'Not before'], followed_by: ['随后进行', 'Followed by'] }[match.timing]
      const start = match.start
      const name = `${names} · ${BWF_PROJECTS[match.discipline][0]}`
      const name_en = `${names} · ${BWF_PROJECTS[match.discipline][1]}`
      events.push({
        id: `${tournament.id}-match-${match.id}`, name, name_en,
        date: start ? start.slice(0, 10) : match.date,
        ...(start ? { time: start.slice(11, 19), timezone: 'Etc/UTC', time_kind: 'datetime' } : { timezone: tournament.timezone ?? source.timezone, time_kind: 'date' }),
        type: 'event', year: tournament.year, status: match.status === 'completed' ? 'completed' : 'confirmed',
        description: [tournament.name, match.round, timing?.[0], match.court, match.games.map(game => game.join('–')).join(', ')].filter(Boolean).join(' · '),
        description_en: [tournament.name_en, match.round, timing?.[1], match.court, match.games.map(game => game.join('–')).join(', ')].filter(Boolean).join(' · '),
        url: tournament.details.bwf_results_url,
        last_verified: source.sports_schedules[tournament.id].checked_at ?? tournament.last_verified, verified_by: tournament.verified_by,
        scopeOnly: true, scopeSourceIds: [seriesId, `${source.id}-${project}`, `${seriesId}-${project}`],
      })
    }
  }
  return { scopes, events }
}
