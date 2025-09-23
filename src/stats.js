// Stats & aggregation per spec

export function filterByTags(matches, selectedTags, andMode) {
  if (!selectedTags || selectedTags.length === 0) return matches;
  const set = new Set(selectedTags);
  return matches.filter(m => {
    const tnames = (m.tags || []).map(t=>t.tagName).filter(Boolean);
    if (tnames.length === 0) return false;
    if (andMode) {
      return [...set].every(t => tnames.includes(t));
    } else {
      return tnames.some(t => set.has(t));
    }
  });
}

export function kpis(matches) {
  const n = matches.length;
  const wins = matches.filter(m=>m.result==='win').length;
  const first = matches.filter(m=>m.turnOrder==='first');
  const second = matches.filter(m=>m.turnOrder==='second');
  const firstN = first.length; const secondN = second.length;
  const firstWins = first.filter(m=>m.result==='win').length;
  const secondWins = second.filter(m=>m.result==='win').length;
  return {
    total: n,
    firstCount: firstN,
    secondCount: secondN,
    winRate: rate(wins, n),
    firstRate: rate(firstN, n),
    secondRate: rate(secondN, n),
    firstWinRate: rate(firstWins, firstN),
    secondWinRate: rate(secondWins, secondN)
  };
}

export function tagStats(matches) {
  const map = new Map();
  for (const m of matches) {
    for (const t of (m.tags||[])) {
      if (!t || !t.tagName) continue;
      const key = t.tagName;
      const cur = map.get(key) || { name: key, count: 0, wins: 0, first: 0, firstWins: 0, second: 0, secondWins: 0 };
      cur.count += 1;
      if (m.result==='win') cur.wins += 1;
      if (m.turnOrder==='first') { cur.first += 1; if (m.result==='win') cur.firstWins += 1; }
      if (m.turnOrder==='second') { cur.second += 1; if (m.result==='win') cur.secondWins += 1; }
      map.set(key, cur);
    }
  }
  const rows = [...map.values()].sort((a,b)=>b.count-a.count);
  return rows.map(r => ({
    name: r.name,
    count: r.count,
    winRate: rate(r.wins, r.count),
    firstRate: rate(r.first, r.count),
    secondRate: rate(r.second, r.count),
    firstWinRate: rate(r.firstWins, r.first),
    secondWinRate: rate(r.secondWins, r.second)
  }));
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const v of arr) {
    const k = keyFn(v);
    const cur = m.get(k) || [];
    cur.push(v); m.set(k, cur);
  }
  return m;
}

export function rate(num, den) {
  if (!den) return null;
  return Math.round((num/den)*1000)/10; // 0.1% 単位
}

// Rate series: [{x: timestamp(ms), y: rate(number)}]
export function rateSeries(matches){
  const series = [];
  for (const m of matches){
    if (m.rate==null) continue;
    const t = Date.parse(m.playedAt || '');
    if (!isFinite(t)) continue;
    series.push({ x: t, y: Number(m.rate) });
  }
  series.sort((a,b)=>a.x-b.x);
  return series;
}

// Matchup matrix: rows = myDeckName, cols = opDeckName
export function matchupMatrix(matches){
  const rowSet = new Set();
  const colSet = new Set();
  const cell = new Map(); // key: `${r}\u0001${c}` -> {wins,total}
  for (const m of matches){
    const r = m.myDeckName || '(未設定)';
    const c = m.opDeckName || '(未設定)';
    rowSet.add(r); colSet.add(c);
    const key = r + '\u0001' + c;
    const cur = cell.get(key) || { wins:0, total:0 };
    cur.total += 1; if (m.result==='win') cur.wins += 1;
    cell.set(key, cur);
  }
  const rows = Array.from(rowSet).sort();
  const cols = Array.from(colSet).sort();
  const data = rows.map(r => cols.map(c => {
    const {wins=0,total=0} = cell.get(r+'\u0001'+c) || {};
    return { wins, total, winRate: total? Math.round((wins/total)*1000)/10 : null };
  }));
  return { rows, cols, data };
}
