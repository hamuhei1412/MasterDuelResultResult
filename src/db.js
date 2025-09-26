// IndexedDB wrapper for md-tracker (schema v2)
// DB: md-tracker; stores: meta, projects, decks, tags, matches

const DB_NAME = 'md-tracker';
const DB_VERSION = 2; // v2 adds: tags store and matches.tags + tags_flat index

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const oldV = e.oldVersion || 0;
      // v1 -> initial (projects, decks, matches, meta)
      if (oldV < 1) {
        const meta = db.createObjectStore('meta', { keyPath: 'id' });
        meta.put({ id: 'app', schemaVersion: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('by_updatedAt', 'updatedAt');

        const decks = db.createObjectStore('decks', { keyPath: 'id' });
        decks.createIndex('by_name', 'name', { unique: false });

        const matches = db.createObjectStore('matches', { keyPath: 'id' });
        matches.createIndex('by_project', 'projectId');
        matches.createIndex('by_playedAt', 'playedAt');
        matches.createIndex('by_myDeckName', 'myDeckName');
        matches.createIndex('by_opDeckName', 'opDeckName');
        matches.createIndex('by_result', 'result');
        matches.createIndex('by_turnOrder', 'turnOrder');
      }
      // v2 -> add tags + matches.tags + tags_flat index
      if (oldV < 2) {
        if (!db.objectStoreNames.contains('tags')) {
          const tags = db.createObjectStore('tags', { keyPath: 'id' });
          tags.createIndex('by_name', 'name', { unique: false });
        }
        const tx = req.transaction;
        let matches;
        if (db.objectStoreNames.contains('matches')) {
          matches = tx.objectStore('matches');
          // Add multiEntry index if not exists
          try { matches.createIndex('by_tagName', 'tags_flat', { multiEntry: true }); } catch(_e) {/* index may exist */}
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function txStores(db, mode, ...stores) {
  return db.transaction(stores, mode);
}

export async function getAll(storeName) {
  const db = await openDB();
  const tx = txStores(db, 'readonly', storeName);
  const store = tx.objectStore(storeName);
  return promisify(store.getAll());
}

export async function put(storeName, value) {
  const db = await openDB();
  const tx = txStores(db, 'readwrite', storeName);
  const store = tx.objectStore(storeName);
  return promisify(store.put(value));
}

export async function del(storeName, key) {
  const db = await openDB();
  const tx = txStores(db, 'readwrite', storeName);
  const store = tx.objectStore(storeName);
  return promisify(store.delete(key));
}

export async function getByIndex(storeName, indexName, query) {
  const db = await openDB();
  const tx = txStores(db, 'readonly', storeName);
  const index = tx.objectStore(storeName).index(indexName);
  return promisify(index.getAll(query));
}

export async function exportAll(activeProjectId) {
  const [projects, decks, tags, matches] = await Promise.all([
    getAll('projects'), getAll('decks'), getAll('tags'), getAll('matches')
  ]);
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    activeProjectId: activeProjectId || null,
    projects, decks, tags, matches
  };
}

export async function exportProject(projectId) {
  const [projects, matches, decks, tags] = await Promise.all([
    getAll('projects'), getAll('matches'), getAll('decks'), getAll('tags')
  ]);
  const proj = projects.find(p => p.id === projectId);
  const related = matches.filter(m => m.projectId === projectId);
  // Embed deck/tag by names only (names are already present in match)
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    project: proj || null,
    matches: related
  };
}

export async function exportDecksOnly() {
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    decks: await getAll('decks')
  };
}

export async function importJSON(data) {
  const db = await openDB();
  const tx = txStores(db, 'readwrite', 'projects','decks','tags','matches','meta');
  const putAll = (store, items) => Promise.all((items||[]).map(v => promisify(tx.objectStore(store).put(v))));
  // naive import; in real migration we would de-dup and remap IDs
  if (data.projects) await putAll('projects', data.projects);
  if (data.decks) await putAll('decks', data.decks);
  if (data.tags) await putAll('tags', data.tags);
  if (data.matches) await putAll('matches', (data.matches||[]).map(withTagsFlat));
  return true;
}

// Utilities specific to entities
export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now();
}

export function nowIso() { return new Date().toISOString(); }

export function withTagsFlat(match) {
  const tags = Array.isArray(match.tags) ? match.tags : [];
  return { ...match, tags_flat: tags.map(t => (t && t.tagName) ? t.tagName : '').filter(Boolean) };
}

export async function addProject({name, description, period}) {
  const id = uuid();
  const now = nowIso();
  await put('projects', { id, name, description: description||'', period: period||null, createdAt: now, updatedAt: now, archived: false });
  return id;
}

export async function addDeck({name, color, tags, favorite, note}) {
  const id = uuid();
  const now = nowIso();
  await put('decks', { id, name, color: color||null, tags: tags||[], favorite: !!favorite, note: note||null, createdAt: now, updatedAt: now });
  return id;
}

export async function updateDeck(id, updates) {
  const db = await openDB();
  const tx = db.transaction(['decks'], 'readwrite');
  const store = tx.objectStore('decks');
  const old = await new Promise((res,rej)=>{ const r = store.get(id); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); });
  if (!old) throw new Error('deck not found');
  const merged = { ...old, ...updates, id, updatedAt: nowIso() };
  await new Promise((res,rej)=>{ const r = store.put(merged); r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error); });
  return true;
}

export async function addTag({name, color, description}) {
  const id = uuid();
  const now = nowIso();
  await put('tags', { id, name, color: color||null, description: description||null, createdAt: now, updatedAt: now });
  return id;
}

export async function addMatch(match) {
  const id = uuid();
  const now = nowIso();
  const rec = withTagsFlat({ ...match, id, createdAt: now, updatedAt: now, deleted: false });
  await put('matches', rec);
  return id;
}

export async function listMatchesByProject(projectId) {
  const all = await getAll('matches');
  return all.filter(m => m.projectId === projectId && !m.deleted).sort((a,b)=> (a.playedAt||'').localeCompare(b.playedAt||''));
}

export async function listDecks() { return getAll('decks'); }
export async function listTags() { return getAll('tags'); }
export async function listProjects() { return getAll('projects'); }

export async function getMatch(id){
  const db = await openDB();
  const tx = db.transaction(['matches'], 'readonly');
  const store = tx.objectStore('matches');
  return new Promise((res,rej)=>{ const r = store.get(id); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); });
}

export async function updateMatch(id, updates){
  const db = await openDB();
  const tx = db.transaction(['matches'], 'readwrite');
  const store = tx.objectStore('matches');
  const old = await new Promise((res,rej)=>{ const r = store.get(id); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); });
  if (!old) throw new Error('match not found');
  const merged = withTagsFlat({ ...old, ...updates, id, updatedAt: nowIso() });
  await new Promise((res,rej)=>{ const r = store.put(merged); r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error); });
  return true;
}

export async function setMatchDeleted(id, deleted){
  const db = await openDB();
  const tx = db.transaction(['matches'], 'readwrite');
  const store = tx.objectStore('matches');
  const old = await new Promise((res,rej)=>{ const r = store.get(id); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); });
  if (!old) return false;
  old.deleted = !!deleted; old.updatedAt = nowIso();
  await new Promise((res,rej)=>{ const r = store.put(old); r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error); });
  return true;
}

export async function listAllMatchesByProject(projectId){
  const all = await getAll('matches');
  return all.filter(m => m.projectId === projectId).sort((a,b)=> (a.playedAt||'').localeCompare(b.playedAt||''));
}
