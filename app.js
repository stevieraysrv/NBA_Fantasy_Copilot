import { DEMO_TEAMS, DEMO_CANDIDATES } from './demo-data.js';
import { FIELDS, CATEGORIES, clone, validatePlayer, validateState, totals, compare, ranking, categoryScore, trade, move, csv } from './core.js';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STORAGE_KEY = 'fantasyCopilotV4';
const defaultSettings = { mode: 'season', ourGames: 3, theirGames: 3, puntTO: true };
function readSettings(input) {
  if (!input || !['season', 'week'].includes(input.mode) || !['ourGames', 'theirGames'].every(k => Number.isInteger(input[k]) && input[k] >= 0 && input[k] <= 7) || typeof input.puntTO !== 'boolean') return { ...defaultSettings };
  return { mode: input.mode, ourGames: input.ourGames, theirGames: input.theirGames, puntTO: input.puntTO };
}
const fresh = () => ({ version: 4, teams: clone(DEMO_TEAMS), candidates: clone(DEMO_CANDIDATES), provenance: 'demo', modified: false });
let state = fresh();
let selected, opponent;
let settings = { ...defaultSettings };

function storageMessage(message) { $('storageStatus').hidden = false; $('storageStatus').textContent = message; }
function status(message) { $('appStatus').textContent = message; }
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const input = JSON.parse(saved);
    state = { ...validateState(input), provenance: input.provenance === 'demo' ? 'demo' : 'imported', modified: Boolean(input.modified) };
    selected = typeof input.selected === 'string' ? input.selected : undefined;
    opponent = typeof input.opponent === 'string' ? input.opponent : undefined;
    settings = readSettings(input.settings);
  } else if (localStorage.getItem('fantasyTeamsV1')) {
    const migrated = validateState({ version: 3, teams: JSON.parse(localStorage.getItem('fantasyTeamsV1')), candidates: JSON.parse(localStorage.getItem('waiverCandidatesV3') || '[]') });
    state = { ...migrated, provenance: 'imported', modified: false };
    storageMessage('Učitani su valjani podaci iz prethodne verzije. Izvezi JSON za sigurnosnu kopiju.');
  }
} catch (error) {
  state = fresh();
  storageMessage('Spremljeno stanje nije dostupno ili nije valjano. Prikazan je demo; postojeći zapisi nisu obrisani. ' + error.message);
}

const names = () => Object.keys(state.teams);
const format = (value, category) => value === null ? '—' : category.includes('%') ? value.toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%' : Math.round(value).toLocaleString('hr-HR');
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, selected, opponent, settings })); }
  catch { storageMessage('Browser nije dopustio lokalno spremanje. Izmjene rade u ovoj sesiji; izvezi JSON prije zatvaranja.'); }
}
function setOptions(id, values, preferred) {
  const element = $(id), previous = preferred ?? element.value;
  element.innerHTML = values.map(({ value, label }) => `<option value="${escape(value)}">${escape(label)}</option>`).join('');
  if (values.some(v => String(v.value) === String(previous))) element.value = previous;
}
const teamOptions = values => values.map(name => ({ value: name, label: name }));
const playerOptions = roster => roster.map((p, i) => ({ value: i, label: p.name }));
function commit(teams, message) {
  state.teams = teams;
  state.modified = true;
  persist(); render(); status(message);
}

function render() {
  const allNames = names();
  if (!Object.hasOwn(state.teams, selected)) selected = allNames[0];
  if (!Object.hasOwn(state.teams, opponent) || opponent === selected) opponent = allNames.find(n => n !== selected);
  setOptions('team', teamOptions(allNames), selected);
  setOptions('opp', teamOptions(allNames.filter(n => n !== selected)), opponent);
  $('dataBadge').textContent = state.provenance === 'demo' ? 'SINTETIČKI DEMO' + (state.modified ? ' · LOKALNE IZMJENE' : ' PODACI') : 'LOKALNO UVEZENI PODACI';
  $('leagueSummary').textContent = `${allNames.length} ekipa · ${Object.values(state.teams).reduce((sum, r) => sum + r.length, 0)} igrača · 9 kategorija`;
  $('rosterCount').textContent = `${state.teams[selected].length} igrača`;
  const ourTotals = totals(state.teams[selected]);
  const ranks = Object.fromEntries(CATEGORIES.map(k => [k, ranking(state.teams, k)]));
  const rankOf = (name, k) => ranks[k].find(row => row.name === name).rank;
  $('kpis').innerHTML = ['BLK', 'STL', 'AST', 'FT%'].map(k => `<article class="card kpi"><div class="kpi-name">${k} <span class="small">/ ${({ BLK: 'BLOKADE', STL: 'UKRADENE', AST: 'ASISTENCIJE', 'FT%': 'SLOBODNA BACANJA' })[k]}</span></div><div class="stat">${format(ourTotals[k], k)}</div><div class="mini-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="kpi-meta"><span class="small">SEZONSKA PROJEKCIJA</span><span class="rank-tag">${rankOf(selected, k) === null ? 'Bez pokušaja' : '#' + rankOf(selected, k) + ' / ' + allNames.length}</span></div></article>`).join('');
  $('ranktable').innerHTML = `<caption class="sr-only">Rangovi svih ekipa po devet kategorija, sezonske projekcije</caption><thead><tr><th scope="col">MOMČAD</th>${CATEGORIES.map(k => `<th scope="col">${k}</th>`).join('')}<th scope="col" title="Zbroj rangova, niže je bolje">Σ RANG</th></tr></thead><tbody>${allNames.map(name => {
    const values = CATEGORIES.map(k => rankOf(name, k));
    return `<tr class="${name === selected ? 'me' : ''}"><th scope="row">${escape(name)}</th>${values.map(r => `<td class="${r !== null && r <= 3 ? 'win' : ''}">${r === null ? '—' : r + '.'}</td>`).join('')}<td>${values.includes(null) ? '—' : values.reduce((a, b) => a + b, 0)}</td></tr>`;
  }).join('')}</tbody>`;
  // Keep row headers visually consistent with the selected row.
  const theirTotals = totals(state.teams[opponent]);
  let wins = 0, losses = 0, ties = 0, skipped = 0;
  const matchupRows = CATEGORIES.map(k => {
    const result = compare(ourTotals[k], theirTotals[k], k);
    if (result === null) skipped++; else if (result === 1) wins++; else if (result === -1) losses++; else ties++;
    return `<tr><th scope="row">${k}</th><td class="${result === 1 ? 'win' : result === -1 ? 'lose' : ''}">${format(ourTotals[k], k)}</td><td>${format(theirTotals[k], k)}</td><td aria-label="${result === null ? 'Nema pokušaja' : result === 1 ? 'Prednost naše ekipe' : result === -1 ? 'Prednost protivnika' : 'Izjednačeno'}">${result === null ? '—' : result === 1 ? '↗' : result === -1 ? '↘' : '='}</td></tr>`;
  }).join('');
  $('matchup').innerHTML = `<div class="match-score"><strong><span class="win">${wins}</span> <span class="small">:</span> ${losses}</strong><small>${ties} izjednačenih${skipped ? ' · ' + skipped + ' bez pokušaja' : ''}</small></div><p class="match-teams">${escape(selected)} <span aria-hidden="true">/</span> ${escape(opponent)}</p><div class="tablewrap"><table><caption class="sr-only">Sezonska usporedba odabranih ekipa</caption><thead><tr><th scope="col">CAT</th><th scope="col">NAŠA</th><th scope="col">SUPARNIK</th><th scope="col">ISHOD</th></tr></thead><tbody>${matchupRows}</tbody></table></div>`;
  const metric = $('metric').value || 'BLK', rows = ranks[metric];
  const max = Math.max(1, ...rows.map(r => r.value ?? 0));
  $('bars').innerHTML = rows.map(row => `<div class="barrow ${row.name === selected ? 'me' : ''}"><span>${escape(row.name)}</span><div class="track" aria-hidden="true"><div class="fill" data-width="${row.value === null ? 0 : Math.max(1, 100 * row.value / max)}"></div></div><b>${format(row.value, metric)}</b></div>`).join('') + (metric === 'TO' ? '<p class="small">Poredano od najmanje izgubljenih lopti. Duljina trake prikazuje vrijednost; manja je bolja.</p>' : '');
  $('bars').querySelectorAll('[data-width]').forEach(bar => { bar.style.width = bar.dataset.width + '%'; });
  $('players').innerHTML = state.teams[selected].length ? `<table><caption class="sr-only">Projekcije igrača ekipe ${escape(selected)}</caption><thead><tr><th scope="col">IGRAČ</th>${FIELDS.map(f => `<th scope="col">${f}</th>`).join('')}</tr></thead><tbody>${state.teams[selected].map((p, pi) => `<tr><th scope="row">${escape(p.name)}</th>${p.v.map((v, vi) => `<td><input class="playerinput" aria-label="${escape(p.name)} ${FIELDS[vi]}" type="number" min="0" max="100000" step="any" value="${v}" data-p="${pi}" data-v="${vi}"></td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="empty">Ova ekipa trenutačno nema igrača.</p>';
  $('players').querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
    const pi = Number(input.dataset.p), vi = Number(input.dataset.v), player = clone(state.teams[selected][pi]);
    player.v[vi] = input.value.trim() === '' ? NaN : Number(input.value);
    if ([0, 2, 4].includes(vi)) player.v[5] = 2 * player.v[0] + player.v[4] + player.v[2];
    try {
      const checked = validatePlayer(player);
      const teams = clone(state.teams); teams[selected][pi] = checked;
      commit(teams, `Spremljene projekcije: ${checked.name}. Simulacije su osvježene.`);
    } catch (error) { input.value = state.teams[selected][pi].v[vi]; status(error.message); }
  }));
  renderAdvisor();
}

function updateTradeIn() { setOptions('tradeIn', playerOptions(state.teams[$('tradeTeam').value] || [])); }
function updateMovePlayer() { setOptions('movePlayer', playerOptions(state.teams[$('moveFrom').value] || [])); }
function renderAdvisor() {
  $('tradeResult').textContent = 'Odaberi igrače za usporedbu prije i poslije zamjene.';
  $('mode').value = settings.mode;
  $('ourGames').value = settings.ourGames; $('theirGames').value = settings.theirGames;
  $('ourGames').disabled = $('theirGames').disabled = settings.mode !== 'week';
  $('puntTO').checked = settings.puntTO;
  const maxScore = (names().length - 1) * (settings.puntTO ? 8 : 9);
  $('scoreBasis').textContent = `${settings.puntTO ? 8 : 9} CAT × ${names().length - 1} suparnika`;
  const base = categoryScore(state.teams[selected], state.teams, selected, settings);
  const results = [];
  for (const candidate of state.candidates) for (const [i, outgoing] of state.teams[selected].entries()) {
    const roster = state.teams[selected].map((p, j) => j === i ? candidate : p);
    results.push({ candidate: candidate.name, outgoing: outgoing.name, gain: categoryScore(roster, state.teams, selected, settings) - base });
  }
  results.sort((a, b) => b.gain - a.gain);
  $('waiverResults').innerHTML = results.length ? `<table><caption class="sr-only">Najboljih 15 waiver kombinacija za ${escape(selected)}</caption><thead><tr><th scope="col">ADD</th><th scope="col">DROP</th><th scope="col">Δ CAT</th></tr></thead><tbody>${results.slice(0, 15).map(r => `<tr><td>${escape(r.candidate)}</td><td>${escape(r.outgoing)}</td><td class="${r.gain > 0 ? 'win' : r.gain < 0 ? 'lose' : ''}">${r.gain > 0 ? '+' : ''}${r.gain.toFixed(1)}</td></tr>`).join('')}</tbody></table><p class="small">Polazište: ${base.toFixed(1)} / ${maxScore} · ${escape(selected)}</p>` : '<p class="empty">Dodaj waiver kandidata i provjeri ima li analizirana ekipa igrače.</p>';
  $('candidateList').innerHTML = state.candidates.map((p, i) => `<span class="pill">${escape(p.name)}<button data-delete="${i}" aria-label="Ukloni kandidata ${escape(p.name)}">×</button></span>`).join('');
  $('candidateList').querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => {
    state.candidates.splice(Number(button.dataset.delete), 1); state.modified = true; persist(); render();
  }));
  setOptions('tradeOut', playerOptions(state.teams[selected]));
  setOptions('tradeTeam', teamOptions(names().filter(name => name !== selected)));
  setOptions('moveFrom', teamOptions(names())); setOptions('moveTo', teamOptions(names()));
  if ($('moveFrom').value === $('moveTo').value) $('moveTo').value = names().find(n => n !== $('moveFrom').value);
  updateTradeIn(); updateMovePlayer();
  const unavailable = !state.teams[selected].length;
  $('tradeCalc').disabled = $('tradeApply').disabled = unavailable || !(state.teams[$('tradeTeam').value]?.length);
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
setOptions('metric', CATEGORIES.map(k => ({ value: k, label: k })), 'BLK');
$('team').addEventListener('change', () => { selected = $('team').value; render(); persist(); });
$('opp').addEventListener('change', () => { opponent = $('opp').value; render(); persist(); });
$('metric').addEventListener('change', render);
$('tradeTeam').addEventListener('change', () => {
  updateTradeIn(); $('tradeResult').textContent = 'Odaberi igrače za usporedbu.';
  $('tradeCalc').disabled = $('tradeApply').disabled = !state.teams[selected].length || !state.teams[$('tradeTeam').value].length;
});
['tradeOut', 'tradeIn'].forEach(id => $(id).addEventListener('change', () => { $('tradeResult').textContent = 'Odabir je promijenjen. Ponovno izračunaj usporedbu.'; }));
$('moveFrom').addEventListener('change', updateMovePlayer);
['mode', 'ourGames', 'theirGames', 'puntTO'].forEach(id => $(id).addEventListener('change', () => {
  const ourGames = Number($('ourGames').value), theirGames = Number($('theirGames').value);
  if (['ourGames', 'theirGames'].some(key => !$(key).value.trim()) || ![ourGames, theirGames].every(n => Number.isInteger(n) && n >= 0 && n <= 7)) {
    status('Unesi cijeli broj utakmica od 0 do 7.'); renderAdvisor(); return;
  }
  settings = { mode: $('mode').value, ourGames, theirGames, puntTO: $('puntTO').checked };
  persist(); renderAdvisor(); status('Postavke simulacija su osvježene. Pregled lige iznad i dalje prikazuje sezonu.');
}));
$('candidateForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    if (state.candidates.length >= 100) throw new Error('Podržano je najviše 100 kandidata.');
    const candidate = validatePlayer({ name: $('candidateName').value, v: $('candidateStats').value.trim().split(/[;,\s]+/).map(Number) });
    validateState({ ...state, candidates: [...state.candidates, candidate] });
    state.candidates.push(candidate); state.modified = true; persist(); render();
    $('candidateForm').reset(); $('advisorStatus').textContent = 'Dodan kandidat: ' + candidate.name;
  } catch (error) { $('advisorStatus').textContent = error.message; }
});
function scenario() {
  const other = $('tradeTeam').value;
  const next = trade(state.teams, selected, other, Number($('tradeOut').value), Number($('tradeIn').value));
  const delta = categoryScore(next[selected], next, selected, settings) - categoryScore(state.teams[selected], state.teams, selected, settings);
  const otherSettings = { ...settings, gamesByTeam: Object.fromEntries(names().map(name => [name, name === selected ? settings.ourGames : settings.theirGames])) };
  const otherDelta = categoryScore(next[other], next, other, otherSettings) - categoryScore(state.teams[other], state.teams, other, otherSettings);
  return { next, delta, otherDelta, other, outgoing: state.teams[selected][Number($('tradeOut').value)].name, incoming: state.teams[other][Number($('tradeIn').value)].name };
}
$('tradeCalc').addEventListener('click', () => {
  try {
    const result = scenario(), signed = n => (n > 0 ? '+' : '') + n.toFixed(1);
    $('tradeResult').textContent = `${result.outgoing} ⇄ ${result.incoming} · ${selected}: ${signed(result.delta)} CAT · ${result.other}: ${signed(result.otherDelta)} CAT. Promjena zbroja usporedbi u odnosu na početno stanje. Ovo nije prognoza pobjede.`;
  } catch (error) { $('tradeResult').textContent = error.message; }
});
$('tradeApply').addEventListener('click', () => {
  try {
    const result = scenario();
    if (confirm(`Primijeniti ${result.outgoing} ⇄ ${result.incoming} samo u lokalnoj simulaciji?`)) commit(result.next, 'Trade je primijenjen lokalno. Yahoo liga nije promijenjena.');
  } catch (error) { $('tradeResult').textContent = error.message; }
});
$('moveApply').addEventListener('click', () => {
  try {
    const from = $('moveFrom').value, to = $('moveTo').value, index = Number($('movePlayer').value);
    const next = move(state.teams, from, to, index), name = state.teams[from][index].name;
    if (confirm(`Premjestiti ${name} iz ${from} u ${to}, samo lokalno?`)) {
      commit(next, 'Roster je promijenjen samo lokalno.'); $('managerStatus').textContent = 'Premješten: ' + name;
    }
  } catch (error) { $('managerStatus').textContent = error.message; }
});
$('export').addEventListener('click', () => { download('fantasy-nba-projections.csv', csv(state.teams), 'text/csv;charset=utf-8'); status('CSV izvoz je pokrenut.'); });
$('exportState').addEventListener('click', () => { download('fantasy-dashboard-state.json', JSON.stringify({ ...state, selected, opponent, settings }, null, 2), 'application/json'); status('JSON izvoz je pokrenut. Čuvaj datoteku privatno ako sadrži podatke tvoje lige.'); });
$('importState').addEventListener('change', async event => {
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error('Datoteka je prevelika. Dopušteno je najviše 2 MB.');
    const input = JSON.parse(await file.text());
    const imported = validateState(input);
    if (!confirm('Zamijeniti lokalno stanje uvezenim podacima? Za kopiju trenutačnog stanja prvo odaberi Spremi JSON.')) return;
    state = { ...imported, provenance: 'imported', modified: false };
    selected = typeof input.selected === 'string' ? input.selected : undefined;
    opponent = typeof input.opponent === 'string' ? input.opponent : undefined;
    settings = readSettings(input.settings);
    render(); persist(); status('Stanje je provjereno i uvezeno.');
  } catch (error) { status('Uvoz nije uspio. ' + error.message); }
  finally { event.target.value = ''; }
});
$('reset').addEventListener('click', () => {
  if (!confirm('Zamijeniti sve lokalne rostere i waiver kandidate početnim demo podacima? Za sigurnosnu kopiju prvo izvezi JSON.')) return;
  state = fresh(); selected = undefined; opponent = undefined; settings = { ...defaultSettings };
  render(); persist(); status('Vraćeni su početni sintetički demo podaci i postavke.');
});
$('deleteData').addEventListener('click', () => {
  if (!confirm('Obrisati spremljene podatke ove aplikacije, uključujući prethodnu verziju? Nećeš ih moći vratiti bez JSON kopije.')) return;
  try {
    [STORAGE_KEY, 'fantasyTeamsV1', 'waiverCandidatesV3'].forEach(key => localStorage.removeItem(key));
    state = fresh(); selected = undefined; opponent = undefined; settings = { ...defaultSettings };
    $('storageStatus').hidden = true; render(); status('Lokalni zapisi aplikacije su obrisani. Prikazan je početni demo.');
  } catch { storageMessage('Browser nije dopustio brisanje. Obriši podatke web-stranice u postavkama browsera.'); }
});
render();
