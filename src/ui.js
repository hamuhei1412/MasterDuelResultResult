// Minimal UI helpers: chip input, rendering, DOM utils

export function $(sel, root=document){ return root.querySelector(sel); }
export function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

export function formatPct(v){ return v==null? 'N/A' : `${v.toFixed(1)}%`; }

export function el(tag, attrs={}, ...children){
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)){
    if (k==='class') e.className = v; else if (k.startsWith('on') && typeof v==='function') e.addEventListener(k.slice(2), v);
    else if (v!=null) e.setAttribute(k, v);
  }
  for (const c of children){ if (c==null) continue; e.append(c.nodeType? c : document.createTextNode(String(c))); }
  return e;
}

export function mount(parent, child){ parent.innerHTML=''; if (child) parent.appendChild(child); }

// --- JST time helpers ---
const JST_OFFSET_MS = 9*60*60*1000;
function pad2(n){ return n<10? '0'+n : String(n); }

export function jstNowInputValue(){
  const d = new Date(Date.now()+JST_OFFSET_MS);
  // Use UTC getters to extract JST components
  const s = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return s;
}

export function jstIsoToInputValue(iso){
  const t = Date.parse(iso||'');
  const d = isFinite(t)? new Date(t+JST_OFFSET_MS) : new Date(Date.now()+JST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function jstInputToIso(val){
  // val: 'YYYY-MM-DDTHH:MM' interpreted as JST values
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/.exec(val||'');
  if (!m) return new Date().toISOString();
  const [_, y, mo, d, h, mi] = m;
  const ms = Date.UTC(Number(y), Number(mo)-1, Number(d), Number(h), Number(mi)) - JST_OFFSET_MS;
  return new Date(ms).toISOString();
}

export function fmtJst(iso){
  const t = Date.parse(iso||'');
  if (!isFinite(t)) return '';
  const d = new Date(t+JST_OFFSET_MS);
  return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth()+1)}/${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function chipInput(container, { allowNew=true, suggestions=[] }={}){
  container.classList.add('chip-input');
  const state = { values: [] };
  const input = el('input', { type:'text', placeholder:'Enterで追加' });
  container.append(input);
  function addChip(val){
    const name = String(val||'').trim();
    if (!name) return;
    if (state.values.includes(name)) return;
    state.values.push(name);
    const chip = el('span', { class:'chip' }, name, el('span',{class:'x', onclick:()=> removeChip(name)}, '×'));
    container.insertBefore(chip, input);
  }
  function removeChip(name){
    state.values = state.values.filter(v=>v!==name);
    $all('.chip', container).forEach(ch => { if (ch.firstChild && ch.firstChild.nodeValue===name) ch.remove(); });
  }
  input.addEventListener('keydown', (e)=>{
    if (e.key==='Enter'){
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      if (!allowNew && !suggestions.includes(v)) return;
      addChip(v); input.value='';
    } else if (e.key==='Backspace' && !input.value) {
      const last = state.values[state.values.length-1];
      if (last) removeChip(last);
    }
  });
  return {
    setSuggestions(list){ suggestions = list||[]; },
    set(values){ state.values = []; $all('.chip', container).forEach(c=>c.remove()); (values||[]).forEach(addChip); },
    get(){ return [...state.values]; },
    clear(){ this.set([]); input.value=''; }
  };
}
