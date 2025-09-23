import { $, $all, el, mount, chipInput, formatPct, jstNowInputValue, jstIsoToInputValue, jstInputToIso, fmtJst } from './ui.js';
import {
  openDB, listProjects, addProject, listDecks, addDeck, listTags, addTag,
  addMatch, listMatchesByProject, exportAll, exportProject, exportDecksOnly,
  importJSON, getMatch, updateMatch, setMatchDeleted, listAllMatchesByProject
} from './db.js';
import { kpis, tagStats, filterByTags, rateSeries, matchupMatrix } from './stats.js';
import { ensureLineChart } from './charts.js';

// App state
const state = {
  activeProjectId: null,
  tags: [],
  decks: [],
  projects: [],
};

// Entry
window.addEventListener('load', async () => {
  await openDB();
  registerSW();
  bindNav();
  await refreshMasters();
  initProjectBar();
  initMatchForm();
  initDeckUI();
  initTagUI();
  initProjectUI();
  initSettingsUI();
  initHistoryUI();
  restoreActiveProject();
  await renderDashboard();
});

function bindNav(){
  $all('nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('nav button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.getAttribute('data-view');
      $all('.view').forEach(v=>v.classList.remove('visible'));
      $(`#view-${view}`).classList.add('visible');
      if (view==='match') {
        // 対戦入力を開くたびに現在時刻(JST)を初期セット
        const dt = $('#playedAt'); if (dt) dt.value = jstNowInputValue();
      }
    });
  });
}

async function refreshMasters(){
  state.tags = await listTags();
  state.decks = await listDecks();
  state.projects = await listProjects();
}

function saveActiveProject(id){
  state.activeProjectId = id || null;
  try { localStorage.setItem('activeProjectId', state.activeProjectId||''); } catch(_){}
}

function restoreActiveProject(){
  const ls = localStorage.getItem('activeProjectId');
  const id = ls && state.projects.some(p=>p.id===ls) ? ls : (state.projects[0]?.id || null);
  setActiveProject(id);
}

function setActiveProject(id){
  saveActiveProject(id);
  const sel = $('#active-project');
  sel.value = id || '';
  const proj = state.projects.find(p=>p.id===id);
  $('#project-period').textContent = proj?.period ? `期間(JST): ${proj.period.start? fmtJst(proj.period.start):''} ~ ${proj.period.end? fmtJst(proj.period.end):''}` : '';
  renderMatchFormDecks();
  renderRecentMatches();
  renderHistory();
  renderDashboard();
}

function initProjectBar(){
  const sel = $('#active-project');
  sel.innerHTML = '';
  for (const p of state.projects){
    sel.appendChild(el('option', { value:p.id }, p.name));
  }
  sel.addEventListener('change', ()=> setActiveProject(sel.value||null));
  $('#create-project').addEventListener('click', async ()=>{
    const name = prompt('プロジェクト名');
    if (!name) return;
    const id = await addProject({ name, description:'', period:null });
    await refreshMasters();
    initProjectBar();
    setActiveProject(id);
  });
}

// Match form
let matchTagsCtl, filterTagsCtl;
function initMatchForm(){
  $('#playedAt').value = jstNowInputValue();
  matchTagsCtl = chipInput($('#match-tags'), { allowNew: false, suggestions: state.tags.map(t=>t.name) });
  // segmented buttons
  bindSeg('result-group');
  bindSeg('turn-group');
  bindSeg('coin-group');
  const form = $('#match-form');
  $('#reset-form').addEventListener('click', ()=> form.reset());
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if (!state.activeProjectId) { alert('プロジェクトを選択してください'); return; }
    const playedAt = jstInputToIso($('#playedAt').value);
    const result = segValue('result-group');
    const turnOrder = segValue('turn-group');
    const method = 'coin';
    const value = segValue('coin-group');
    const rate = $('#rate').value ? Number($('#rate').value) : null;
    const myDeckSel = $('#myDeckId');
    const myDeckId = myDeckSel ? (myDeckSel.value || null) : null;
    const myDeck = state.decks.find(d=>d.id===myDeckId);
    const myDeckName = myDeck ? myDeck.name : '';
    const opSel = $('#opDeckNameSel');
    const opDeckName = opSel ? (opSel.value || '') : (($('#opDeckName')?.value||'').trim());
    const note = $('#note').value || null;

    // Validation per spec
    if (!result) { alert('結果を選択してください'); return; }
    if (!turnOrder) { alert('先行/後攻を選択してください'); return; }
    if (!value) { alert('コイントス結果を選択してください'); return; }
    if (!myDeckId) { alert('自分デッキを選択してください'); return; }
    if (!opDeckName || opDeckName.length>60) { alert('相手デッキを選択してください'); return; }
    if (rate!=null && rate<0) { alert('レートは0以上'); return; }

    const tagNames = matchTagsCtl.get();
    const tags = tagNames.map(n=>({ tagId: (state.tags.find(t=>t.name===n)?.id)||null, tagName:n }));
    await addMatch({
      projectId: state.activeProjectId,
      playedAt,
      result,
      turnOrder,
      initiative: { method, value: value||null },
      rate,
      myDeckId,
      myDeckName,
      opDeckName,
      tags,
      note
    });
    form.reset();
    $('#playedAt').value = jstNowInputValue();
    clearSeg('result-group');
    clearSeg('turn-group');
    clearSeg('coin-group');
    await renderRecentMatches();
    await renderDashboard();
  });
  // store last deck
  $('#myDeckId').addEventListener('change', ()=>{
    try { localStorage.setItem('lastMyDeckId', $('#myDeckId').value||''); } catch(_e){}
  });
}

function renderMatchFormDecks(){
  const sel = $('#myDeckId');
  sel.innerHTML = '<option value="">（未選択）</option>';
  for (const d of state.decks){
    sel.appendChild(el('option', { value:d.id }, d.name));
  }
  const last = localStorage.getItem('lastMyDeckId');
  if (last && state.decks.some(d=>d.id===last)) sel.value = last;
  else if (!sel.value && state.decks.length===1) sel.value = state.decks[0].id;
  const opSel = $('#opDeckNameSel');
  if (opSel){
    opSel.innerHTML = '<option value="">（未選択）</option>';
    for (const d of state.decks){
      opSel.appendChild(el('option', { value:d.name }, d.name));
    }
    if (!opSel.value && state.decks.length===1) opSel.value = state.decks[0].name;
  }
}

// segmented helpers
function bindSeg(id){
  const root = document.getElementById(id); if (!root) return;
  $all('button', root).forEach(btn => btn.addEventListener('click', ()=>{
    $all('button', root).forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
  }));
}
function segValue(id){ const a = document.querySelector(`#${id} button.active`); return a ? a.getAttribute('data-value') : null; }
function clearSeg(id){ $all(`#${id} button`).forEach(b=>b.classList.remove('active')); }

async function renderRecentMatches(){
  if (!state.activeProjectId) { mount($('#recent-matches'), el('div',{},'プロジェクト未選択')); return; }
  const list = await listMatchesByProject(state.activeProjectId);
  const recent = list.slice(-10).reverse();
  const tbl = el('table',{class:'table matches'});
  const thead = el('tr',{});
  ['日時(JST)','結果','先後','自分デッキ','相手デッキ','レート','タグ','操作'].forEach(h=> thead.appendChild(el('th',{},h)));
  tbl.appendChild(thead);
  recent.forEach(m => {
    const trEl = el('tr', { class: (m.result==='win'?'win':'loss') });
    const resLabel = m.result==='win' ? el('span',{class:'good'},'Win') : el('span',{class:'bad'},'Loss');
    trEl.appendChild(el('td',{}, fmtJst(m.playedAt)));
    trEl.appendChild(el('td',{class:'result'}, resLabel));
    trEl.appendChild(el('td',{}, m.turnOrder==='first'?'先行':'後攻'));
    trEl.appendChild(el('td',{}, m.myDeckName));
    trEl.appendChild(el('td',{}, m.opDeckName));
    trEl.appendChild(el('td',{}, m.rate!=null? String(m.rate): ''));
    trEl.appendChild(el('td',{}, ...(m.tags||[]).map(t=> el('span',{class:'pill'}, el('span',{class:'dot',style:`background:${pickTagColor(t.tagName)}`}),'#'+t.tagName))));
    trEl.appendChild(el('td',{},
      el('button',{onclick:()=> openEditMatch(m.id)},'編集'), ' ',
      el('button',{onclick:()=> toggleDeleteMatch(m)}, m.deleted? '復元' : '削除')
    ));
    tbl.appendChild(trEl);
  });
  mount($('#recent-matches'), el('div',{class:'panel'}, tbl));
}

// Dashboard
async function renderDashboard(){
  if (!state.activeProjectId) { mount($('#kpi'), el('div',{},'プロジェクト未選択')); return; }
  const matches = await listMatchesByProject(state.activeProjectId);
  // Tag filter control (AND/OR)
  if (!filterTagsCtl){ filterTagsCtl = chipInput($('#filter-tags'), { allowNew:false, suggestions: state.tags.map(t=>t.name) }); }
  filterTagsCtl.setSuggestions(state.tags.map(t=>t.name));
  const andMode = $('#filter-tags-mode').checked;
  const selectedTags = filterTagsCtl.get();
  const filtered = filterByTags(matches, selectedTags, andMode);

  const k = kpis(filtered);
  mount($('#kpi'), el('div',{class:'kpi'},
    card('対戦数', String(k.total)),
    card('勝ち数', String(filtered.filter(m=>m.result==='win').length)),
    card('負け数', String(filtered.filter(m=>m.result==='loss').length)),
    card('勝率', formatPct(k.winRate)),
    card('先行率', formatPct(k.firstRate)),
    card('後攻率', formatPct(k.secondRate)),
    card('先行時勝率', formatPct(k.firstWinRate)),
    card('後攻時勝率', formatPct(k.secondWinRate)),
  ));

  // Rate line chart
  // プロジェクト期間内のみグラフ表示
  let graphFiltered = filtered;
  const proj = state.projects.find(p=>p.id===state.activeProjectId);
  if (proj?.period && (proj.period.start || proj.period.end)){
    const s = proj.period.start ? Date.parse(proj.period.start) : -Infinity;
    const e = proj.period.end ? Date.parse(proj.period.end) : Infinity;
    graphFiltered = filtered.filter(m => {
      const t = Date.parse(m.playedAt||'');
      return (isFinite(t)?t:0) >= s && (isFinite(t)?t:0) <= e;
    });
  }

  const series = rateSeries(graphFiltered);
  let xDomain = null;
  if (proj?.period && proj.period.start && proj.period.end){
    const s = Date.parse(proj.period.start); const e = Date.parse(proj.period.end);
    if (isFinite(s) && isFinite(e) && e>s) xDomain = [s, e];
  }
  ensureLineChart($('#rate-canvas'), series, xDomain? { xDomain } : {});

  // Matchup matrix
  const mx = matchupMatrix(graphFiltered);
  const tbl = el('table', { class:'matrix' });
  // header
  const head = el('tr',{});
  head.appendChild(el('th',{}, '自\相'));
  mx.cols.forEach(c=> head.appendChild(el('th',{}, c)));
  tbl.appendChild(head);
  // rows
  mx.rows.forEach((r, ri)=>{
    const trEl = el('tr',{});
    trEl.appendChild(el('th',{}, r));
    mx.cols.forEach((c, ci)=>{
      const d = mx.data[ri][ci];
      const label = d.total ? `${(d.winRate??0).toFixed(1)}%\n(${d.wins}/${d.total})` : 'N/A';
      const bg = heatColor(d.winRate);
      trEl.appendChild(el('td', { style:`background:${bg}` }, label));
    });
    tbl.appendChild(trEl);
  });
  const legend = el('div', { class:'muted', style:'margin-top:6px;' }, '勝率レジェンド: ', gradientLegend());
  const cont = el('div',{}, tbl, legend);
  mount($('#matchup-table'), cont);

  // Tag stats table
  const rows = tagStats(filtered);
  const table = el('table', { class:'stats' });
  table.append(
    tr('th','タグ','件数','勝率','先行率','後攻率','先行勝率','後攻勝率'),
    ...rows.map(r => tr('td', '#'+r.name, r.count, formatPct(r.winRate), formatPct(r.firstRate), formatPct(r.secondRate), formatPct(r.firstWinRate), formatPct(r.secondWinRate)))
  );
  mount($('#tag-stats'), el('div',{class:'panel'}, table));

  // Re-render when filters change
  $('#filter-tags-mode').onchange = ()=> renderDashboard();
  // chip input triggers re-render on Enter via keydown; add slight delay
  $('#filter-tags').addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key==='Backspace') setTimeout(renderDashboard, 0); });
}

function card(title, value){
  return el('div',{class:'card'}, el('div',{class:'muted'}, title), el('div',{class:'value'}, value));
}
function tr(kind, ...cells){
  const row = el('tr');
  for (const c of cells){ row.appendChild(el(kind,{}, c)); }
  return row;
}

function heatColor(pct){
  if (pct==null) return '#1a2033';
  const t = Math.max(0, Math.min(100, pct)) / 100; // 0..1
  // HSL: 0 (red) -> 60 (yellow) -> 120 (green)
  const h = 120 * t; const s = 70; const l = 40;
  return hsl(h,s,l);
}
function hsl(h,s,l){ return `hsl(${h} ${s}% ${l}%)`; }
function gradientLegend(){
  const bar = el('div',{style:'height:10px;background:linear-gradient(90deg, hsl(0 70% 40%), hsl(60 70% 40%), hsl(120 70% 40%));border-radius:6px;margin:4px 0'});
  const row = el('div',{class:'row', style:'justify-content:space-between;font-size:12px'}, el('span',{},'0%'), el('span',{},'50%'), el('span',{},'100%'));
  return el('div',{}, bar, row);
}

// Deck UI
function initDeckUI(){
  $('#deck-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = $('#deck-name').value.trim(); if (!name) return;
    const color = $('#deck-color').value || null;
    const tags = ($('#deck-tags').value||'').split(',').map(s=>s.trim()).filter(Boolean);
    const note = $('#deck-note').value || null;
    const favorite = $('#deck-fav').checked;
    await addDeck({ name, color, tags, favorite, note });
    e.target.reset();
    await refreshMasters();
    renderDeckList();
    renderMatchFormDecks();
  });
  $('#export-decks').addEventListener('click', async ()=>{
    const data = await exportDecksOnly();
    downloadJSON(data, `md-decks-${new Date().toISOString().slice(0,10)}.json`);
  });
  $('#import-decks').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.decks) await importJSON({ decks: data.decks });
    await refreshMasters();
    renderDeckList();
    renderMatchFormDecks();
    e.target.value = '';
  });
  renderDeckList();
}

function renderDeckList(){
  const ul = $('#deck-list'); ul.innerHTML='';
  for (const d of state.decks){
    const li = el('li',{},
      el('span',{}, el('span',{class:'pill'}, el('span',{class:'dot',style:`background:${d.color||'#888'}`}), d.name),
        d.favorite? el('span',{class:'pill'}, '★お気に入り'):null,
        (d.tags||[]).map(t=>el('span',{class:'pill'}, '#'+t))
      ),
      el('span',{}, el('button',{onclick: async ()=>{ await deleteDeck(d.id); }}, '削除'))
    );
    ul.appendChild(li);
  }
}

async function deleteDeck(id){
  const ok = confirm('デッキを削除しますか？');
  if (!ok) return;
  const db = await openDB();
  const tx = db.transaction(['decks'], 'readwrite');
  tx.objectStore('decks').delete(id);
  await new Promise((res,rej)=>{ tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
  await refreshMasters();
  renderDeckList();
  renderMatchFormDecks();
}

// Tag UI
function initTagUI(){
  $('#tag-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = $('#tag-name').value.trim(); if (!name || name.length>40) { alert('タグ名は1~40文字'); return; }
    const color = $('#tag-color').value || null;
    const description = $('#tag-desc').value || null;
    if (!state.tags.some(t=>t.name===name)) await addTag({ name, color, description });
    else alert('同名タグが既に存在します（設定で許容可、今回は警告）');
    e.target.reset();
    await refreshMasters();
    renderTagList();
  });
  renderTagList();
}

function renderTagList(){
  const ul = $('#tag-list'); ul.innerHTML='';
  for (const t of state.tags){
    const li = el('li',{},
      el('span',{}, el('span',{class:'pill'}, el('span',{class:'dot',style:`background:${t.color||'#888'}`}), '#'+t.name), t.description? ' '+t.description:''),
      el('span',{}, el('button',{onclick:()=> renameTag(t)}, '改名'), el('button',{onclick:()=> deleteTag(t.id)}, '削除'))
    );
    ul.appendChild(li);
  }
}

async function renameTag(tag){
  const name = prompt('新しいタグ名', tag.name);
  if (!name) return;
  const db = await openDB();
  const tx = db.transaction(['tags'], 'readwrite');
  const store = tx.objectStore('tags');
  store.put({ ...tag, name, updatedAt: new Date().toISOString() });
  await new Promise((res,rej)=>{ tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
  await refreshMasters();
  renderTagList();
}

async function deleteTag(id){
  if (!confirm('タグを削除しますか？（紐づく対戦のtagIdはnull化）')) return;
  const db = await openDB();
  const tx = db.transaction(['tags','matches'], 'readwrite');
  tx.objectStore('tags').delete(id);
  // Nullify tagId in matches but keep tagName
  const mStore = tx.objectStore('matches');
  const reqAll = mStore.getAll();
  reqAll.onsuccess = ()=>{
    const all = reqAll.result||[];
    for (const m of all){
      if (Array.isArray(m.tags)){
        let changed = false;
        for (const t of m.tags){ if (t && t.tagId===id){ t.tagId = null; changed = true; } }
        if (changed){ m.updatedAt = new Date().toISOString(); m.tags_flat = (m.tags||[]).map(t=>t.tagName).filter(Boolean); mStore.put(m); }
      }
    }
  };
  await new Promise((res,rej)=>{ tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
  await refreshMasters();
  renderTagList();
}

// Projects UI
function initProjectUI(){
  $('#project-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = $('#project-name').value.trim(); if(!name) return;
    const start = $('#project-start').value ? jstInputToIso($('#project-start').value) : null;
    const end = $('#project-end').value ? jstInputToIso($('#project-end').value) : null;
    const description = $('#project-desc').value || '';
    const id = await addProject({ name, description, period: (start||end)? { start, end } : null });
    e.target.reset();
    await refreshMasters();
    initProjectBar();
    renderProjectList();
    setActiveProject(id);
  });
  renderProjectList();
}

function renderProjectList(){
  const ul = $('#project-list'); ul.innerHTML='';
  for (const p of state.projects){
    const li = el('li',{},
      el('span',{}, p.name, p.period? ` / ${p.period.start? fmtJst(p.period.start):''} ~ ${p.period.end? fmtJst(p.period.end):''}` : ''),
      el('span',{}, el('button',{onclick:()=> setActiveProject(p.id)}, '切替'), el('button',{onclick:()=> deleteProject(p.id)}, '削除'))
    );
    ul.appendChild(li);
  }
}

async function deleteProject(id){
  if (!confirm('プロジェクトを削除しますか？（対戦は残ります）')) return;
  const db = await openDB();
  const tx = db.transaction(['projects'], 'readwrite');
  tx.objectStore('projects').delete(id);
  await new Promise((res,rej)=>{ tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
  await refreshMasters();
  initProjectBar();
  renderProjectList();
  if (state.activeProjectId===id) setActiveProject(state.projects[0]?.id||null);
}

// Settings / Backup
function initSettingsUI(){
  $('#export-all').addEventListener('click', async ()=>{
    const data = await exportAll(state.activeProjectId);
    downloadJSON(data, `md-all-${new Date().toISOString().slice(0,10)}.json`);
  });
  $('#export-project').addEventListener('click', async ()=>{
    if (!state.activeProjectId) { alert('プロジェクト未選択'); return; }
    const data = await exportProject(state.activeProjectId);
    downloadJSON(data, `md-project-${state.activeProjectId}.json`);
  });
  $('#import-all').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if (!file) return;
    try{
      const text = await file.text();
      const data = JSON.parse(text);
      await importJSON(data);
      await refreshMasters();
      initProjectBar();
      renderDeckList();
      renderTagList();
      renderProjectList();
      renderDashboard();
    } catch(err){ alert('インポートに失敗しました: '+err?.message); }
    e.target.value = '';
  });
}

function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 1000);
}

function pickTagColor(name){
  const t = state.tags.find(t=>t.name===name);
  return t?.color || '#556';
}

// Service worker
function registerSW(){
  if ('serviceWorker' in navigator){
    try { navigator.serviceWorker.register('sw.js'); } catch(_e) {}
  }
}
// History view
function initHistoryUI(){
  $('#reload-history').addEventListener('click', renderHistory);
}

async function renderHistory(){
  if (!state.activeProjectId) { mount($('#history-list'), el('div',{},'プロジェクト未選択')); return; }
  const list = await listAllMatchesByProject(state.activeProjectId); // 昇順
  // 番号付与（昇順で1..N）
  const numberMap = new Map(); list.forEach((m,i)=> numberMap.set(m.id, i+1));
  const rows = list.slice().reverse(); // 表示は新しい順
  const tbl = el('table',{class:'table matches'});
  const thead = el('tr',{});
  ['#','日時(JST)','結果','先後','自分デッキ','相手デッキ','レート','タグ','状態','操作'].forEach(h=> thead.appendChild(el('th',{},h)));
  tbl.appendChild(thead);
  rows.forEach(m => {
    const trEl = el('tr', { class: `${m.result==='win'?'win':'loss'} ${m.deleted?'deleted':''}`.trim() });
    const resLabel = m.result==='win' ? el('span',{class:'good'},'Win') : el('span',{class:'bad'},'Loss');
    trEl.appendChild(el('td',{}, String(numberMap.get(m.id))));
    trEl.appendChild(el('td',{}, fmtJst(m.playedAt)));
    trEl.appendChild(el('td',{class:'result'}, resLabel));
    trEl.appendChild(el('td',{}, m.turnOrder==='first'?'先行':'後攻'));
    trEl.appendChild(el('td',{}, m.myDeckName));
    trEl.appendChild(el('td',{}, m.opDeckName));
    trEl.appendChild(el('td',{}, m.rate!=null? String(m.rate): ''));
    trEl.appendChild(el('td',{}, ...(m.tags||[]).map(t=> el('span',{class:'pill'}, el('span',{class:'dot',style:`background:${pickTagColor(t.tagName)}`}),'#'+t.tagName))));
    trEl.appendChild(el('td',{}, m.deleted? '削除':''));
    trEl.appendChild(el('td',{},
      el('button',{onclick:()=> openEditMatch(m.id)},'編集'), ' ',
      el('button',{onclick:()=> toggleDeleteMatch(m)}, m.deleted? '復元' : '削除')
    ));
    tbl.appendChild(trEl);
  });
  mount($('#history-list'), el('div',{class:'panel'}, tbl));
}

async function toggleDeleteMatch(m){
  await setMatchDeleted(m.id, !m.deleted);
  await renderRecentMatches();
  await renderHistory();
  await renderDashboard();
}

async function openEditMatch(matchId){
  const m = await getMatch(matchId);
  if (!m) { alert('レコードが見つかりません'); return; }
  const modal = $('#modal');
  modal.classList.remove('hidden');
  const dlg = el('div',{class:'dialog'},
    el('h3',{},'対戦を編集'),
    el('form',{id:'edit-form'},
      el('div',{class:'grid'},
        el('label',{},'日時(JST)', el('input',{type:'datetime-local', id:'e_playedAt', value: jstIsoToInputValue(m.playedAt)})),
        el('label',{},'結果', sel('e_result', ['win','loss'], m.result)),
        el('label',{},'先行/後攻', sel('e_turnOrder', ['first','second'], m.turnOrder)),
        el('label',{},'コイントス結果', sel('e_coin', ['heads','tails'], typeof m.initiative?.value==='string'? m.initiative.value : 'heads')),
        el('label',{},'自分デッキ', deckSelect('e_myDeck', state.decks, m.myDeckId)),
        el('label',{},'相手デッキ', opDeckSelect('e_opDeck', state.decks, m.opDeckName)),
        el('label',{},'レート', el('input',{type:'number', id:'e_rate', min:'0', step:'1', value: m.rate ?? ''})),
        el('label',{},'タグ', el('div',{id:'e_tags', class:'chip-input', 'data-allow-new':'false'})),
        el('label',{},'メモ', el('textarea',{id:'e_note', rows:'2'}, m.note||''))
      ),
      el('div',{class:'actions'},
        el('button',{type:'submit'},'保存'),
        el('button',{type:'button', onclick: closeModal},'キャンセル')
      )
    )
  );
  mount(modal, dlg);
  const tagsCtl = chipInput($('#e_tags'), { allowNew:false, suggestions: state.tags.map(t=>t.name) });
  tagsCtl.set((m.tags||[]).map(t=>t.tagName));
  $('#edit-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const playedAt = jstInputToIso($('#e_playedAt').value);
    const result = $('#e_result').value;
    const turnOrder = $('#e_turnOrder').value;
    const initiative = { method:'coin', value: $('#e_coin').value };
    const myDeckId = $('#e_myDeck').value || null;
    const myDeck = state.decks.find(d=>d.id===myDeckId);
    if (!myDeck) { alert('自分デッキを選択してください'); return; }
    const myDeckName = myDeck.name;
    const opDeckName = $('#e_opDeck').value || '';
    if (!opDeckName) { alert('相手デッキを選択してください'); return; }
    const rate = $('#e_rate').value ? Number($('#e_rate').value) : null;
    if (rate!=null && rate<0) { alert('レートは0以上'); return; }
    const tags = tagsCtl.get().map(n=>({ tagId: (state.tags.find(t=>t.name===n)?.id)||null, tagName:n }));
    const note = $('#e_note').value || null;
    await updateMatch(m.id, { playedAt, result, turnOrder, initiative, myDeckId, myDeckName, opDeckName, rate, tags, note });
    closeModal();
    await renderRecentMatches();
    await renderHistory();
    await renderDashboard();
  });
}

function sel(id, values, selected){
  const s = el('select',{id});
  for (const v of values){ s.appendChild(el('option',{value:v, selected: v===selected? 'selected': null}, v)); }
  return s;
}
function deckSelect(id, decks, selectedId){
  const s = el('select',{id, required:''});
  s.appendChild(el('option',{value:''}, '（未選択）'));
  for (const d of decks){ s.appendChild(el('option',{value:d.id, selected: d.id===selectedId? 'selected': null}, d.name)); }
  return s;
}
function opDeckSelect(id, decks, selectedName){
  const s = el('select',{id, required:''});
  s.appendChild(el('option',{value:''}, '（未選択）'));
  for (const d of decks){ s.appendChild(el('option',{value:d.name, selected: d.name===selectedName? 'selected': null}, d.name)); }
  return s;
}

function closeModal(){
  const modal = $('#modal');
  modal.classList.add('hidden');
  modal.innerHTML = '';
}
