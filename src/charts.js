// Lightweight canvas line chart (no deps)

export function drawLineChart(canvas, points, { padding=24, color='#7aa2f7', grid='#273048', axis='#99a0b0' }={}){
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 200;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0,0,w,h);

  if (!points || points.length===0) {
    ctx.fillStyle = axis; ctx.font = '12px sans-serif'; ctx.fillText('データなし', 10, 20); return;
  }

  const x0 = padding, y0 = padding, x1 = w - padding, y1 = h - padding;
  const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = (maxX - minX) || 1;
  const dy = (maxY - minY) || 1;

  // grid
  ctx.strokeStyle = grid; ctx.lineWidth = 1;
  for (let i=0;i<=4;i++){
    const yy = y0 + (y1-y0)*(i/4);
    line(ctx, x0, yy, x1, yy);
  }

  // axes labels (min/max)
  ctx.fillStyle = axis; ctx.font = '12px sans-serif';
  ctx.fillText(String(minY), 4, y1);
  ctx.fillText(String(maxY), 4, y0+8);

  // path
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p,i)=>{
    const x = x0 + (x1-x0)*((p.x - minX)/dx);
    const y = y1 - (y1-y0)*((p.y - minY)/dy);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

function line(ctx,x1,y1,x2,y2){ ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }

