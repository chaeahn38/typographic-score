// script-2.js
// 도형 geometry: 스캔라인 교차(getIntersectionY), 거리(shapeDist), 바운딩박스(shapeBBox),
// 이동(offsetShape / offsetShapeXInPlace), 클릭 검색(findShapeAt), 삭제(deleteNearest)

// ─── 스캔라인 x에서 도형과의 교차 y 좌표 반환 ──────────────────────────────
function getIntersectionY(s, x) {
  if (s.type === "penNode") return Math.abs(x - s.x) <= s.r ? s.y : null;
  if (s.type === "rect") return x >= s.x && x <= s.x + s.w ? s.y + s.h / 2 : null;
  if (s.type === "circle") return Math.abs(x - s.x) <= s.r ? s.y : null;
  if (s.type === "concentric") return Math.abs(x - s.x) <= s.r ? s.y : null;
  if (s.type === "semi") {
    const xs = [
      s.cx + s.r * Math.cos(s.angle - Math.PI / 2),
      s.cx + s.r * Math.cos(s.angle + Math.PI / 2),
      s.cx + s.r * Math.cos(s.angle),
    ];
    return x >= Math.min(...xs) && x <= Math.max(...xs) ? s.cy : null;
  }
  if (s.type === "line" || s.type === "dotted") {
    const n = s.count || 1;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy) || 1;
    const px2 = -dy / len, py2 = dx / len, gap = 7;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * gap;
      const lx1 = s.x1 + px2 * off, lx2 = s.x2 + px2 * off;
      const mn = Math.min(lx1, lx2), mx = Math.max(lx1, lx2);
      if (x >= mn && x <= mx) {
        const ly1 = s.y1 + py2 * off, ly2 = s.y2 + py2 * off;
        if (mx === mn) return (ly1 + ly2) / 2;
        return ly1 + ((x - lx1) / (lx2 - lx1)) * (ly2 - ly1);
      }
    }
    return null;
  }
  if (s.type === "bezier") {
    const pts = s.pts;
    let closest = null, closestDist = 999;
    for (let t = 0; t <= 1; t += 0.01) {
      const it = 1 - t;
      let bx, by;
      if (pts.length === 3) {
        bx = it*it*pts[0].x + 2*it*t*pts[1].x + t*t*pts[2].x;
        by = it*it*pts[0].y + 2*it*t*pts[1].y + t*t*pts[2].y;
      } else {
        bx = it*it*it*pts[0].x + 3*it*it*t*pts[1].x + 3*it*t*t*pts[2].x + t*t*t*pts[3].x;
        by = it*it*it*pts[0].y + 3*it*it*t*pts[1].y + 3*it*t*t*pts[2].y + t*t*t*pts[3].y;
      }
      if (Math.abs(bx - x) < closestDist) { closestDist = Math.abs(bx - x); closest = by; }
    }
    return closestDist < 5 ? closest : null;
  }
  if (s.type === "triangle") {
    const edges = [[s.pts[0], s.pts[1]], [s.pts[1], s.pts[2]], [s.pts[2], s.pts[0]]];
    const ys = [];
    for (const [a, b] of edges) {
      const mn = Math.min(a.x, b.x), mx = Math.max(a.x, b.x);
      if (x >= mn && x <= mx && mx > mn)
        ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
    }
    return ys.length ? ys.reduce((a, b) => a + b) / ys.length : null;
  }
  if (s.type === "pen") {
    if (s.path && s.path.length > 1) {
      for (let i = 0; i < s.path.length - 1; i++) {
        const a = s.path[i], b = s.path[i + 1];
        const mn = Math.min(a.x, b.x), mx = Math.max(a.x, b.x);
        if (x >= mn && x <= mx) {
          const t = mx === mn ? 0.5 : (x - a.x) / (b.x - a.x);
          return a.y + t * (b.y - a.y);
        }
      }
    }
    if (s.nodes) {
      for (const nd of s.nodes) if (Math.abs(x - nd.x) <= nd.r) return nd.y;
    }
    return null;
  }
  return null;
}

// ─── 점-선분 거리 ────────────────────────────────────────────────────────────
function ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx*dx + dy*dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax)*dx + (py - ay)*dy) / l2));
  return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
}

// ─── 도형과 좌표 (x, y) 사이의 거리 ────────────────────────────────────────
function shapeDist(s, x, y) {
  if (s.type === "penNode") return Math.abs(Math.hypot(x - s.x, y - s.y) - s.r);
  if (s.type === "rect") {
    const nx = Math.max(s.x, Math.min(s.x + s.w, x));
    const ny = Math.max(s.y, Math.min(s.y + s.h, y));
    return Math.hypot(x - nx, y - ny);
  }
  if (s.type === "circle" || s.type === "concentric")
    return Math.abs(Math.hypot(x - s.x, y - s.y) - s.r);
  if (s.type === "semi") return Math.abs(Math.hypot(x - s.cx, y - s.cy) - s.r);
  if (s.type === "line" || s.type === "dotted")
    return ptSegDist(x, y, s.x1, s.y1, s.x2, s.y2);
  if (s.type === "bezier") {
    let minD = Infinity;
    const pts = s.pts;
    for (let t = 0; t <= 1; t += 0.02) {
      const it = 1 - t;
      let bx, by;
      if (pts.length === 3) {
        bx = it*it*pts[0].x + 2*it*t*pts[1].x + t*t*pts[2].x;
        by = it*it*pts[0].y + 2*it*t*pts[1].y + t*t*pts[2].y;
      } else {
        bx = it*it*it*pts[0].x + 3*it*it*t*pts[1].x + 3*it*t*t*pts[2].x + t*t*t*pts[3].x;
        by = it*it*it*pts[0].y + 3*it*it*t*pts[1].y + 3*it*t*t*pts[2].y + t*t*t*pts[3].y;
      }
      minD = Math.min(minD, Math.hypot(x - bx, y - by));
    }
    return minD;
  }
  if (s.type === "triangle") {
    const [a, b, c] = s.pts;
    return Math.min(
      ptSegDist(x, y, a.x, a.y, b.x, b.y),
      ptSegDist(x, y, b.x, b.y, c.x, c.y),
      ptSegDist(x, y, c.x, c.y, a.x, a.y)
    );
  }
  if (s.type === "pen") {
    let minD = Infinity;
    if (s.path)
      for (let i = 0; i < s.path.length - 1; i++)
        minD = Math.min(minD, ptSegDist(x, y, s.path[i].x, s.path[i].y, s.path[i+1].x, s.path[i+1].y));
    if (s.nodes)
      for (const nd of s.nodes)
        minD = Math.min(minD, Math.abs(Math.hypot(x - nd.x, y - nd.y) - nd.r));
    return minD;
  }
  return Infinity;
}

// ─── 도형의 축 정렬 바운딩박스 반환 ─────────────────────────────────────────
function shapeBBox(s) {
  if (s.type === "penNode") return { x1: s.x - s.r, y1: s.y - s.r, x2: s.x + s.r, y2: s.y + s.r };
  if (s.type === "rect") return { x1: s.x, y1: s.y, x2: s.x + s.w, y2: s.y + s.h };
  if (s.type === "circle" || s.type === "concentric")
    return { x1: s.x - s.r, y1: s.y - s.r, x2: s.x + s.r, y2: s.y + s.r };
  if (s.type === "semi")
    return { x1: s.cx - s.r, y1: s.cy - s.r, x2: s.cx + s.r, y2: s.cy + s.r };
  if (s.type === "line" || s.type === "dotted")
    return { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) };
  if (s.type === "bezier") {
    const xs = s.pts.map((p) => p.x), ys = s.pts.map((p) => p.y);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  if (s.type === "triangle")
    return {
      x1: Math.min(s.pts[0].x, s.pts[1].x, s.pts[2].x),
      y1: Math.min(s.pts[0].y, s.pts[1].y, s.pts[2].y),
      x2: Math.max(s.pts[0].x, s.pts[1].x, s.pts[2].x),
      y2: Math.max(s.pts[0].y, s.pts[1].y, s.pts[2].y),
    };
  if (s.type === "pen") {
    const allX = [...(s.path||[]).map(p=>p.x), ...(s.nodes||[]).flatMap(n=>[n.x-n.r, n.x+n.r])];
    const allY = [...(s.path||[]).map(p=>p.y), ...(s.nodes||[]).flatMap(n=>[n.y-n.r, n.y+n.r])];
    if (!allX.length) return { x1: 0, y1: 0, x2: 0, y2: 0 };
    return { x1: Math.min(...allX), y1: Math.min(...allY), x2: Math.max(...allX), y2: Math.max(...allY) };
  }
  return { x1: 0, y1: 0, x2: 0, y2: 0 };
}

// ─── 도형을 (dx, dy) 만큼 복사+이동하여 반환 ────────────────────────────────
function offsetShape(s, dx, dy) {
  const n = JSON.parse(JSON.stringify(s));
  if (s.type === "rect" || s.type === "circle" || s.type === "concentric") {
    n.x += dx; n.y += dy;
  } else if (s.type === "semi") {
    n.cx += dx; n.cy += dy;
  } else if (s.type === "line" || s.type === "dotted") {
    n.x1 += dx; n.y1 += dy; n.x2 += dx; n.y2 += dy;
  } else if (s.type === "bezier" || s.type === "triangle") {
    n.pts = s.pts.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
  } else if (s.type === "pen") {
    n.path = s.path.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
    n.nodes = s.nodes.map((nd) => ({ x: nd.x + dx, y: nd.y + dy, r: nd.r }));
  } else if (s.type === "penNode") {
    n.x += dx; n.y += dy;
  }
  return n;
}

// ─── 도형 x 좌표만 in-place로 이동 (타이핑 레이아웃용) ────────────────────
function offsetShapeXInPlace(s, dx) {
  if (s.type === "rect" || s.type === "circle" || s.type === "concentric") s.x += dx;
  else if (s.type === "semi") s.cx += dx;
  else if (s.type === "line" || s.type === "dotted") { s.x1 += dx; s.x2 += dx; }
  else if (s.type === "bezier" || s.type === "triangle") s.pts.forEach((pt) => { pt.x += dx; });
  else if (s.type === "pen") {
    s.path.forEach((pt) => { pt.x += dx; });
    s.nodes.forEach((nd) => { nd.x += dx; });
  } else if (s.type === "penNode") s.x += dx;
}

// ─── 클릭 좌표에서 가장 가까운 도형 찾기 ────────────────────────────────────
function findShapeAt(x, y) {
  let best = null, bestD = 24 / zoom;
  for (const s of shapes) {
    const d = shapeDist(s, x, y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

// ─── 우클릭 삭제: 가장 가까운 도형 제거 ─────────────────────────────────────
function deleteNearest(x, y) {
  let best = Infinity, idx = -1;
  shapes.forEach((s, i) => {
    const d = shapeDist(s, x, y);
    if (d < best) { best = d; idx = i; }
  });
  if (idx >= 0 && best < 32 / zoom) {
    shapes.splice(idx, 1);
    pgDirty = true;
  }
}
