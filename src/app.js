import { $, $all, el, mount, chipInput, formatPct } from './ui.js';
import {
  openDB, listProjects, addProject, listDecks, addDeck, listTags, addTag,
  addMatch, listMatchesByProject, exportAll, exportProject, exportDecksOnly,
  importJSON
} from './db.js';
import { kpis, tagStats, filterByTags, rateSeries, matchupMatrix } from './stats.js';
import { drawLineChart } from './charts.js';

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
  $('#project-period').textContent = proj?.period ? `期間: ${proj.period.start||''} ~ ${proj.period.end||''}` : '';
  renderMatchFormDecks();
  renderRecentMatches();
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
  $('#playedAt').value = new Date().toISOString().slice(0,16);
  matchTagsCtl = chipInput($('#match-tags'), { allowNew: false, suggestions: state.tags.map(t=>t.name) });
  const form = $('#match-form');
  $('#reset-form').addEventListener('click', ()=> form.reset());
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if (!state.activeProjectId) { alert('プロジェクトを選択してください'); return; }
    const playedAt = new Date($('#playedAt').value).toISOString();
    const result = $('#result').value;
    const turnOrder = $('#turnOrder').value;
    const method = 'coin';
    const value = $('#coinResult').value || null;
    const rate = $('#rate').value ? Number($('#rate').value) : null;
    const myDeckId = $('#myDeckId').value || null;
    const myDeck = state.decks.find(d=>d.id===myDeckId);
    const myDeckName = myDeck ? myDeck.name : '';
    const opDeckName = $('#opDeckNameSel').value || '';
    const note = $('#note').value || null;

    // Validation per spec
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
    $('#playedAt').value = new Date().toISOString().slice(0,16);
    await renderRecentMatches();
    await renderDashboard();
  });
}

function renderMatchFormDecks(){
  const sel = $('#myDeckId');
  sel.innerHTML = '<option value="">（未選択）</option>';
  for (const d of state.decks){
    sel.appendChild(el('option', { value:d.id }, d.name));
  }
  if (!sel.value && state.decks.length===1) sel.value = state.decks[0].id;
  const opSel = $('#opDeckNameSel');
  if (opSel){
    opSel.innerHTML = '<option value="">（未選択）</option>';
    for (const d of state.decks){
      opSel.appendChild(el('option', { value:d.name }, d.name));
    }
    if (!opSel.value && state.decks.length===1) opSel.value = state.decks[0].name;
  }
}

async function renderRecentMatches(){
  if (!state.activeProjectId) { mount($('#recent-matches'), el('div',{},'プロジェクト未選択')); return; }
  const list = await listMatchesByProject(state.activeProjectId);
  const items = list.slice(-10).reverse().map(m => el('li',{},
    el('div',{}, `${m.playedAt?.slice(0,16)||''} / ${m.turnOrder==='first'?'先行':'後攻'} / ${m.result==='win'?'Win':'Loss'}`),
    el('div',{}, `${m.myDeckName} vs ${m.opDeckName}`),
    el('div',{}, ...(m.tags||[]).map(t=> el('span',{class:'pill'}, el('span',{class:'dot',style:`background:${pickTagColor(t.tagName)}`}),'#'+t.tagName)))
  ));
  mount($('#recent-matches'), el('div',{class:'panel'}, el('ul',{class:'list'}, ...items)));
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
    card('勝率', formatPct(k.winRate)),
    card('先行率', formatPct(k.firstRate)),
    card('後攻率', formatPct(k.secondRate)),
    card('先行時勝率', formatPct(k.firstWinRate)),
    card('後攻時勝率', formatPct(k.secondWinRate)),
  ));

  // Rate line chart
  const series = rateSeries(filtered);
  drawLineChart($('#rate-canvas'), series);

  // Matchup matrix
  const mx = matchupMatrix(filtered);
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
  mount($('#matchup-table'), tbl);

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
  // red -> yellow -> green
  const r = t < 0.5 ? 255 : Math.round(255*(1 - (t-0.5)*2));
  const g = t < 0.5 ? Math.round(255*(t*2)) : 255;
  const b = 80;
  return `rgb(${r},${g},${b})`;
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
    const start = $('#project-start').value || null;
    const end = $('#project-end').value || null;
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
      el('span',{}, p.name, p.period? ` / ${p.period.start||''} ~ ${p.period.end||''}` : ''),
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
