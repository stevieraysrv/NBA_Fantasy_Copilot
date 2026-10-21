export const FIELDS = ['FGM', 'FGA', 'FTM', 'FTA', '3PTM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'];
export const CATEGORIES = ['FG%', 'FT%', '3PTM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'];
export const clone = value => structuredClone(value);

export function validatePlayer(player) {
  if (!player || typeof player.name !== 'string' || !player.name.trim() || player.name.length > 100)
    throw new Error('Ime igrača mora sadržavati 1–100 znakova.');
  if (!Array.isArray(player.v) || player.v.length !== 11 || !player.v.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000))
    throw new Error(`${player.name}: potrebno je 11 brojki od 0 do 100.000.`);
  if (player.v[0] > player.v[1] || player.v[2] > player.v[3] || player.v[4] > player.v[0])
    throw new Error(`${player.name}: vrijedi FGM ≤ FGA, FTM ≤ FTA i 3PTM ≤ FGM.`);
  const expected = 2 * player.v[0] + player.v[4] + player.v[2];
  if (Math.abs(expected - player.v[5]) > 2)
    throw new Error(`${player.name}: PTS mora biti 2 × FGM + 3PTM + FTM (dopušteno odstupanje 2 zbog zaokruživanja).`);
  return { name: player.name.trim(), v: [...player.v] };
}

export function validateState(input) {
  if (!input || ![3, 4].includes(input.version) || !input.teams || Array.isArray(input.teams) || typeof input.teams !== 'object' || !Array.isArray(input.candidates))
    throw new Error('Očekuje se JSON stanje verzije 3 ili 4 s teams i candidates.');
  const entries = Object.entries(input.teams);
  if (entries.length < 2 || entries.length > 30 || input.candidates.length > 100)
    throw new Error('Podržano je 2–30 ekipa i najviše 100 waiver kandidata.');
  const seen = new Set();
  function checked(player) {
    const clean = validatePlayer(player), key = clean.name.toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`Igrač je naveden više puta: ${clean.name}.`);
    seen.add(key);
    return clean;
  }
  const teams = Object.fromEntries(entries.map(([name, roster]) => {
    if (!name.trim() || name.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(name) || !Array.isArray(roster) || roster.length > 50)
      throw new Error('Nevaljan naziv ekipe ili roster (najviše 50 igrača).');
    return [name, roster.map(checked)];
  }));
  return { version: 4, teams, candidates: input.candidates.map(checked) };
}

export function totals(roster, games = null) {
  const factor = games === null ? 1 : games / 82;
  const sums = Array(11).fill(0);
  for (const player of roster) player.v.forEach((v, i) => sums[i] += v * factor);
  return { 'FG%': sums[1] ? 100 * sums[0] / sums[1] : null, 'FT%': sums[3] ? 100 * sums[2] / sums[3] : null,
    '3PTM': sums[4], PTS: sums[5], REB: sums[6], AST: sums[7], STL: sums[8], BLK: sums[9], TO: sums[10] };
}

// A percentage without attempts is undefined; neither side earns a modeled win.
export function compare(a, b, category) {
  if (a === null || b === null) return null;
  const difference = (a - b) * (category === 'TO' ? -1 : 1);
  return Math.abs(difference) < 1e-9 ? 0 : difference > 0 ? 1 : -1;
}

export function ranking(teams, category) {
  return Object.entries(teams).map(([name, roster]) => ({ name, value: totals(roster)[category] }))
    .sort((a, b) => a.value === null ? (b.value === null ? 0 : 1) : b.value === null ? -1 : (category === 'TO' ? a.value - b.value : b.value - a.value))
    .map((row, i, rows) => ({ ...row, rank: row.value === null ? null : 1 + rows.slice(0, i).filter(other => compare(other.value, row.value, category) === 1).length }));
}

export function categoryScore(roster, teams, selected, settings) {
  const categories = CATEGORIES.filter(k => !(settings.puntTO && k === 'TO'));
  const ours = totals(roster, settings.mode === 'week' ? settings.gamesByTeam?.[selected] ?? settings.ourGames : null);
  let score = 0;
  for (const [name, opponent] of Object.entries(teams)) {
    if (name === selected) continue;
    const theirs = totals(opponent, settings.mode === 'week' ? settings.gamesByTeam?.[name] ?? settings.theirGames : null);
    for (const key of categories) {
      const result = compare(ours[key], theirs[key], key);
      score += result === 1 ? 1 : result === 0 ? 0.5 : 0;
    }
  }
  return score;
}

export function trade(teams, from, to, outgoing, incoming) {
  if (from === to || !teams[from]?.[outgoing] || !teams[to]?.[incoming]) throw new Error('Odaberi različite ekipe i oba igrača.');
  const result = clone(teams);
  [result[from][outgoing], result[to][incoming]] = [result[to][incoming], result[from][outgoing]];
  return result;
}

export function move(teams, from, to, index) {
  if (from === to || !teams[from]?.[index] || !Object.hasOwn(teams, to)) throw new Error('Odaberi različite ekipe i igrača.');
  if (teams[to].length >= 50) throw new Error('Odredišna ekipa već ima 50 igrača.');
  const result = clone(teams);
  result[to].push(result[from].splice(index, 1)[0]);
  return result;
}

export function csv(teams) {
  const cell = value => {
    let text = String(value);
    // Prevent spreadsheet formula injection in user-controlled names.
    if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\ufeff' + [['Ekipa', 'Igrač', ...FIELDS], ...Object.entries(teams).flatMap(([name, roster]) => roster.map(p => [name, p.name, ...p.v]))]
    .map(row => row.map(cell).join(';')).join('\r\n');
}
