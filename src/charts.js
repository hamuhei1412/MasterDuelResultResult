// Pretty line chart with axes, grid, tooltip, smoothing (no deps)

export function ensureLineChart(canvas, points, options={}){
  if (!canvas) return;
  if (!canvas.__lc) canvas.__lc = new LineChart(canvas, options);
  canvas.__lc.update(points, options);
}

// Simple pie chart (no deps)
export function ensurePieChart(canvas, items, options={}){
  if (!canvas) return;
  if (!canvas.__pc) canvas.__pc = new PieChart(canvas, options);
  canvas.__pc.update(items, options);
}

class LineChart{
  constructor(canvas, options){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = [];
    this.opts = options;
    this.padding = 36;
    this.hover = null;
    this.tooltip = makeTooltip(canvas);
    this._onMove = this.onMove.bind(this);
    this._onLeave = this.onLeave.bind(this);
    canvas.addEventListener('mousemove', this._onMove);
    canvas.addEventListener('mouseleave', this._onLeave);
    this.ro = new ResizeObserver(()=> this.draw());
    this.ro.observe(canvas);
  }
  update(points, options={}){
    this.points = Array.isArray(points)? points.slice() : [];
    this.opts = { color:'#7aa2f7', grid:'#273048', axis:'#99a0b0', area:'rgba(122,162,247,0.15)', xDomain: null, xMode:'time', ...options };
    this.draw();
  }
  setSize(){
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 220;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }
  draw(){
    this.setSize();
    const { ctx, w, h, padding:pad } = this;
    ctx.clearRect(0,0,w,h);
    ctx.save();
    const points = this.points;
    const { axis, grid, color, area, xDomain, xMode } = this.opts;
    const x0 = pad+24, y0 = pad, x1 = w - pad, y1 = h - pad;
    const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
    let minX, maxX;
    if (xDomain && isFinite(xDomain[0]) && isFinite(xDomain[1])){
      minX = Number(xDomain[0]); maxX = Number(xDomain[1]);
    } else if (points.length){
      minX = Math.min(...xs); maxX = Math.max(...xs);
    } else {
      const now = Date.now(); minX = now; maxX = now + 1;
    }
    const [minY, maxY] = points.length ? paddedRange(Math.min(...ys), Math.max(...ys)) : [0,1];
    const dx = (maxX - minX) || 1; const dy = (maxY - minY) || 1;
    const xMap = (x)=> x0 + (x1-x0) * ((x - minX)/dx);
    const yMap = (y)=> y1 - (y1-y0) * ((y - minY)/dy);

    // grid + axes
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    const yTicks = niceTicks(minY, maxY, 5);
    for(const t of yTicks){ const yy = yMap(t); line(ctx, x0, yy, x1, yy); }
    ctx.strokeStyle = axis; line(ctx, x0, y0, x0, y1); line(ctx, x0, y1, x1, y1);
    ctx.fillStyle = axis; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign='right'; ctx.textBaseline='middle';
    for(const t of yTicks){ const yy = yMap(t); ctx.fillText(String(t), x0-6, yy); }
    // x ticks
    ctx.textAlign='center'; ctx.textBaseline='top';
    const xTicks = xMode==='count' ? niceTicks(minX, maxX, 5) : timeTicks(minX, maxX, 5);
    for(const t of xTicks){
      const xx = xMap(t);
      const label = xMode==='count' ? String(Math.round(t)) : fmtTime(t, minX, maxX);
      ctx.fillText(label, xx, y1+4);
      ctx.strokeStyle = grid; line(ctx, xx, y0, xx, y1);
    }

    // smoothed path
    if (points.length){
      const path = smoothedPath(points.map(p=>({ x:xMap(p.x), y:yMap(p.y) })));
      // area under line
      if (area){
        ctx.fillStyle = area;
        ctx.beginPath();
        pathTo(ctx, path);
        ctx.lineTo(path[path.length-1].x, y1);
        ctx.lineTo(path[0].x, y1);
        ctx.closePath();
        ctx.fill();
      }
      // line
      const grad = ctx.createLinearGradient(0,y0,0,y1);
      grad.addColorStop(0, color); grad.addColorStop(1, color);
      ctx.strokeStyle = grad; ctx.lineWidth = 2;
      ctx.beginPath(); pathTo(ctx, path); ctx.stroke();

      // points (for small N)
      if (points.length <= 40){
        ctx.fillStyle = color; for(const p of path){ dot(ctx, p.x, p.y, 2.5); }
      }

      // hover marker
      if (this.hover){
        const i = nearestIndex(points, this.hover.x, (v)=>xMap(v));
        if (i>=0){
          const px = xMap(points[i].x), py = yMap(points[i].y);
          ctx.strokeStyle = 'rgba(0,0,0,0.15)'; line(ctx, px, y0, px, y1);
          ctx.fillStyle = '#000'; dot(ctx, px, py, 3.5);
          this.tooltip.show(px, y0+8, xMode==='count'? fmtTooltipCount(points[i]) : fmtTooltip(points[i]));
        }
      } else {
        this.tooltip.hide();
      }
    } else {
      // No data: draw only axes/grid and a note
      ctx.fillStyle = axis; ctx.font = '12px system-ui, sans-serif'; ctx.fillText('データなし', 10, 20);
      this.tooltip.hide();
    }
    ctx.restore();
  }
  onMove(e){
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    this.hover = { x, y }; this.draw();
  }
  onLeave(){ this.hover = null; this.draw(); }
}

class PieChart{
  constructor(canvas, options){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.opts = options;
    this.ro = new ResizeObserver(()=> this.draw());
    this.ro.observe(canvas);
  }
  update(items, options={}){
    // items: [{ label, value, color }]
    this.items = Array.isArray(items)? items.filter(i=>i && i.value>0) : [];
    this.opts = { donut:false, innerRatio:0.6, stroke:'#fff', strokeWidth:1, label:false, ...options };
    this.draw();
  }
  setSize(){
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 360;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }
  draw(){
    this.setSize();
    const { ctx, w, h } = this;
    ctx.clearRect(0,0,w,h);
    const total = this.items.reduce((s,i)=>s+i.value, 0);
    if (!total){
      ctx.fillStyle = '#99a0b0'; ctx.font='12px system-ui, sans-serif'; ctx.fillText('データなし', 10, 20); return;
    }
    const cx = w/2, cy = h/2;
    const r = Math.min(w, h) * 0.36; // big pie
    let a0 = -Math.PI/2;
    ctx.lineWidth = this.opts.strokeWidth;
    for (const it of this.items){
      const a1 = a0 + (Math.PI*2) * (it.value/total);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fillStyle = it.color || '#7aa2f7';
      ctx.fill();
      if (this.opts.stroke){ ctx.strokeStyle = this.opts.stroke; ctx.stroke(); }
      a0 = a1;
    }
    if (this.opts.donut){
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(cx, cy, r*this.opts.innerRatio, 0, Math.PI*2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

function makeTooltip(canvas){
  let el = canvas.parentElement.querySelector('.chart-tooltip');
  if (!el){
    el = document.createElement('div');
    el.className = 'chart-tooltip';
    canvas.parentElement.appendChild(el);
  }
  return {
    show(x, y, html){ el.innerHTML = html; el.style.display='block'; el.style.left = Math.round(x+12)+'px'; el.style.top = Math.round(y+8)+'px'; },
    hide(){ el.style.display='none'; }
  };
}

function nearestIndex(points, x, mapX){
  if (!points.length) return -1;
  let best=0, bestD=Infinity;
  for (let i=0;i<points.length;i++){
    const dx = Math.abs(mapX(points[i].x)-x);
    if (dx<bestD){ best=i; bestD=dx; }
  }
  return best;
}

function paddedRange(minY, maxY){
  if (!isFinite(minY) || !isFinite(maxY)) return [0, 1];
  if (minY===maxY){ const pad = Math.max(1, Math.abs(minY)*0.1); return [minY-pad, maxY+pad]; }
  const r = maxY - minY; const pad = r*0.1; return [Math.floor(minY-pad), Math.ceil(maxY+pad)];
}
function niceTicks(min, max, count){
  const span = max-min; if (span<=0) return [min];
  const step = niceStep(span/(count||5));
  const start = Math.ceil(min/step)*step;
  const ticks = [];
  for(let v=start; v<=max+1e-9; v+=step){ ticks.push(roundNice(v)); }
  return ticks;
}
function niceStep(raw){
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  if (n<1.5) return 1*pow;
  if (n<3) return 2*pow;
  if (n<7) return 5*pow;
  return 10*pow;
}
function roundNice(v){ return Math.round(v*100)/100; }
function timeTicks(minX, maxX, count){
  if (maxX<=minX) return [minX];
  const span = maxX-minX; const step = Math.round(span/(count||5));
  const ticks = [];
  for(let t=minX; t<=maxX+1; t+=step){ ticks.push(t); }
  return ticks;
}
function fmtTime(x, minX, maxX){
  const d = new Date(x);
  const daySpan = (maxX-minX)/(1000*60*60*24);
  if (daySpan <= 2) return `${pad2(d.getMonth()+1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())}`;
}
function fmtTooltip(p){
  const d = new Date(p.x);
  return `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}<br/><b>${p.y}</b>`;
}
function fmtTooltipCount(p){ return `試合 ${p.x}<br/><b>${p.y}</b>`; }
function pad2(n){ return n<10? '0'+n : String(n); }

function smoothedPath(pts){
  if (pts.length<=2) return pts;
  // Monotone cubic interpolation
  const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
  const ms = [];
  for(let i=0;i<xs.length-1;i++) ms.push( (ys[i+1]-ys[i])/(xs[i+1]-xs[i] || 1) );
  const ds = [ms[0], ...ms, ms[ms.length-1]];
  const cps = [];
  for(let i=0;i<xs.length;i++){
    const m = i===0? ms[0] : (i===ms.length? ms[ms.length-1] : (ms[i-1]+ms[i])/2);
    const prevX = xs[i-1]??xs[i], nextX = xs[i+1]??xs[i];
    const dx = (nextX - prevX)/6;
    cps.push({
      x: xs[i], y: ys[i],
      c1x: xs[i]-dx, c1y: ys[i]-m*dx,
      c2x: xs[i]+dx, c2y: ys[i]+m*dx
    });
  }
  // build path points as bezier segments endpoints
  const path = cps.map(p=>({x:p.x,y:p.y,c1x:p.c1x,c1y:p.c1y,c2x:p.c2x,c2y:p.c2y}));
  return path;
}
function pathTo(ctx, path){
  for(let i=0;i<path.length;i++){
    const p = path[i];
    if (i===0) ctx.moveTo(p.x, p.y);
    else ctx.bezierCurveTo(path[i-1].c2x, path[i-1].c2y, p.c1x, p.c1y, p.x, p.y);
  }
}
function line(ctx,x1,y1,x2,y2){ ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
function dot(ctx,x,y,r){ ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
