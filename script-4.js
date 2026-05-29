// script-4.js
// p5.js 스케치 (도형 렌더링, 마우스/키 이벤트) / 재생 제어 / UI 버튼 이벤트

// ─── p5 Sketch ───────────────────────────────────────────────────────────────
new p5(function (p) {
  // 도형 색상 반환 (BW 모드 처리)
  function getShapeColor(s) {
    if (bwMode) return "#000000";
    return s.color || "#111";
  }

  // 도형 하나를 그래픽스 버퍼 g에 그리기 (isHit: 스캔라인 접촉 시 밝게)
  function drawShapeToG(g, s, isHit) {
    const baseCol = getShapeColor(s);
    const col = p.color(baseCol);
    const r = p.red(col),
      gr = p.green(col),
      b = p.blue(col);
    const fr = isHit ? r * 0.5 + 127.5 : r;
    const fg = isHit ? gr * 0.5 + 127.5 : gr;
    const fb = isHit ? b * 0.5 + 127.5 : b;
    const alpha = isHit ? 180 : 255;

    if (s.type === "line") {
      const n = s.count || 1;
      const dx = s.x2 - s.x1,
        dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy) || 1;
      const px2 = -dy / len,
        py2 = dx / len,
        gap = 14;
      g.noFill();
      g.strokeWeight(isHit ? 12 : 9);
      g.stroke(fr, fg, fb, alpha);
      g.strokeCap(p.ROUND);
      g.drawingContext.setLineDash([]);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * gap;
        g.line(s.x1 + px2 * off, s.y1 + py2 * off, s.x2 + px2 * off, s.y2 + py2 * off);
      }
    } else if (s.type === "dotted") {
      g.noFill();
      g.strokeWeight(3);
      g.stroke(fr, fg, fb, alpha);
      g.strokeCap(p.ROUND);
      const dotGap = s.dotGap || 8;
      const dx = s.x2 - s.x1,
        dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy);
      const dots = Math.floor(len / dotGap);
      for (let i = 0; i <= dots; i++) {
        const t = dots === 0 ? 0 : i / dots;
        g.circle(s.x1 + dx * t, s.y1 + dy * t, 4);
      }
    } else if (s.type === "bezier") {
      g.noFill();
      g.strokeWeight(3);
      g.stroke(fr, fg, fb, alpha);
      g.strokeCap(p.ROUND);
      g.drawingContext.setLineDash([]);
      if (s.pts.length === 3) {
        g.beginShape();
        g.vertex(s.pts[0].x, s.pts[0].y);
        g.quadraticVertex(s.pts[1].x, s.pts[1].y, s.pts[2].x, s.pts[2].y);
        g.endShape();
      } else {
        g.bezier(
          s.pts[0].x,
          s.pts[0].y,
          s.pts[1].x,
          s.pts[1].y,
          s.pts[2].x,
          s.pts[2].y,
          s.pts[3].x,
          s.pts[3].y
        );
      }
    } else if (s.type === "concentric") {
      g.noFill();
      g.strokeWeight(2);
      g.stroke(fr, fg, fb, alpha);
      g.drawingContext.setLineDash([]);
      const rings = s.rings || 4;
      for (let i = 1; i <= rings; i++) g.circle(s.x, s.y, (s.r / rings) * i * 2);
    } else if (s.type === "pen") {
      g.drawingContext.setLineDash([]);
      if (s.path && s.path.length > 1) {
        g.noFill();
        g.stroke(fr, fg, fb, alpha);
        g.strokeWeight(8);
        g.strokeCap(p.ROUND);
        g.strokeJoin(p.ROUND);
        g.beginShape();
        g.curveVertex(s.path[0].x, s.path[0].y);
        for (const pt of s.path) g.curveVertex(pt.x, pt.y);
        g.curveVertex(s.path[s.path.length - 1].x, s.path[s.path.length - 1].y);
        g.endShape();
      }
      if (s.nodes && s.nodes.length) {
        g.noStroke();
        g.fill(fr, fg, fb, alpha);
        for (const nd of s.nodes) g.circle(nd.x, nd.y, nd.r * 2);
      }
    } else if (s.type === "penNode") {
      g.drawingContext.setLineDash([]);
      g.noStroke();
      g.fill(fr, fg, fb, alpha);
      g.circle(s.x, s.y, s.r * 2);
    } else {
      // circle, rect, triangle, semi
      g.noStroke();
      g.fill(fr, fg, fb, alpha);
      if (s.type === "rect") g.rect(s.x, s.y, s.w, s.h);
      else if (s.type === "circle") g.circle(s.x, s.y, s.r * 2);
      else if (s.type === "semi")
        g.arc(s.cx, s.cy, s.r * 2, s.r * 2, s.angle - p.HALF_PI, s.angle + p.HALF_PI, p.CHORD);
      else if (s.type === "triangle")
        g.triangle(s.pts[0].x, s.pts[0].y, s.pts[1].x, s.pts[1].y, s.pts[2].x, s.pts[2].y);
    }
  }

  // 오프스크린 버퍼 재렌더 (pgDirty 플래그로 제어)
  function renderBuffer() {
    if (!pg || pg.width !== logicalW || pg.height !== logicalH) {
      if (pg) pg.remove();
      pg = p.createGraphics(logicalW, logicalH);
    }
    pg.background(255);
    for (const s of shapes) drawShapeToG(pg, s, false);
    pgDirty = false;
  }

  p.setup = function () {
    const cont = document.getElementById("sketch-container");
    logicalW = cont.offsetWidth;
    logicalH = cont.offsetHeight;
    scoreCenterX = Math.round(logicalW / 2);
    typeCursorX = LEFT_MARGIN;
    const c = p.createCanvas(Math.round(logicalW * zoom), Math.round(logicalH * zoom));
    c.parent("sketch-container");
    pRef = p;
    pg = p.createGraphics(logicalW, logicalH);
    pgDirty = true;
    c.elt.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const lx = p.mouseX / zoom,
        ly = p.mouseY / zoom;
      if (!isPlaying && currentTool !== "select") deleteNearest(lx, ly);
    });
  };

  p.draw = function () {
    if (pgDirty) renderBuffer();
    const lmx = p.mouseX / zoom,
      lmy = p.mouseY / zoom;
    p.push();
    p.scale(zoom);
    p.image(pg, 0, 0);

    // 스캔라인 재생
    if (isPlaying) {
      const speed = parseFloat(document.getElementById("speedSlider").value);
      const rowShapes =
        typeLines.length > 0 ? shapes.filter((s) => getShapeRow(s) === currentPlayLine) : shapes;
      updateAudio(logicalH, rowShapes);
      scanX += speed;
      if (scanX > logicalW + 30) {
        stopAllAudio();
        prevLineHit = {};
        currentPlayLine++;
        if (currentPlayLine >= Math.max(1, typeLines.length)) {
          p.pop();
          stopPlayback();
          return;
        }
        scanX = 0;
        const cont = document.getElementById("sketch-container");
        const rowY = typeLines[currentPlayLine] ? typeLines[currentPlayLine].y * zoom : 0;
        cont.scrollTop = Math.max(0, rowY - cont.clientHeight / 2);
      }
      if (typeLines.length > 0) {
        const lh = computeLineHeight();
        const ty = typeLines[currentPlayLine] ? typeLines[currentPlayLine].y : logicalH / 2;
        p.noStroke();
        p.fill(0, 0, 0, 4);
        p.rect(0, ty - lh / 2, logicalW, lh);
      }
      for (const s of rowShapes) if (getIntersectionY(s, scanX) !== null) drawShapeToG(p, s, true);
      p.stroke(0, 0, 0, 15);
      p.strokeWeight(8 / zoom);
      p.line(scanX, 0, scanX, logicalH);
      p.stroke(0, 0, 0, 60);
      p.strokeWeight(0.5 / zoom);
      p.line(scanX, 0, scanX, logicalH);
    }

    // 선택 하이라이트
    if (currentTool === "select") {
      p.drawingContext.setLineDash([4 / zoom, 3 / zoom]);
      p.noFill();
      p.stroke(60, 120, 255);
      p.strokeWeight(1 / zoom);
      for (const id of selectedIds) {
        const s = shapes.find((sh) => sh.id === id);
        if (!s) continue;
        const pad = 8;
        if (s.type === "circle" || s.type === "concentric") p.circle(s.x, s.y, (s.r + pad) * 2);
        else {
          const bb = shapeBBox(s);
          p.rect(bb.x1 - pad, bb.y1 - pad, bb.x2 - bb.x1 + pad * 2, bb.y2 - bb.y1 + pad * 2, 2);
        }
      }
      p.drawingContext.setLineDash([]);
      if (selDragStart && selDragCurr) {
        const rx = Math.min(selDragStart.x, selDragCurr.x);
        const ry = Math.min(selDragStart.y, selDragCurr.y);
        p.stroke(60, 120, 255, 80);
        p.fill(60, 120, 255, 10);
        p.strokeWeight(0.5 / zoom);
        p.rect(
          rx,
          ry,
          Math.abs(selDragStart.x - selDragCurr.x),
          Math.abs(selDragStart.y - selDragCurr.y)
        );
      }
    }

    // 타입 커서 깜빡임
    if (typeMode) {
      const blink = Math.floor(p.millis() / 500) % 2 === 0;
      if (blink) {
        const cy = typeCursorY !== null ? typeCursorY : logicalH / 2;
        p.stroke(80, 120, 255, 120);
        p.strokeWeight(1 / zoom);
        p.noFill();
        p.line(typeCursorX, cy - 70, typeCursorX, cy + 70);
      }
    }

    // 펜 드로잉 라이브 프리뷰 (일시정지 원 포함)
    if (currentTool === "pen" && penDrawing) {
      const now = p.millis();
      const pauseTime = now - penLastMoveTime;
      if (pauseTime > 2 && penLastPos) {
        const r = 10 + Math.floor((pauseTime - 2) / 150) * 10;
        if (!penPauseCircle) penPauseCircle = { x: penLastPos.x, y: penLastPos.y, r };
        else penPauseCircle.r = r;
      }
      const pc = bwMode ? 0 : 80;
      const pa = 160;
      p.drawingContext.setLineDash([]);
      if (penPath.length > 1) {
        p.noFill();
        p.stroke(pc, pc, pc, pa);
        p.strokeWeight(8);
        p.strokeCap(p.ROUND);
        p.strokeJoin(p.ROUND);
        p.beginShape();
        p.curveVertex(penPath[0].x, penPath[0].y);
        for (const pt of penPath) p.curveVertex(pt.x, pt.y);
        p.curveVertex(penPath[penPath.length - 1].x, penPath[penPath.length - 1].y);
        p.endShape();
      }
      p.noStroke();
      p.fill(pc, pc, pc, pa);
      for (const nd of penNodes) p.circle(nd.x, nd.y, nd.r * 2);
      if (penPauseCircle) {
        p.noStroke();
        p.fill(pc, pc, pc, pa);
        p.circle(penPauseCircle.x, penPauseCircle.y, penPauseCircle.r * 2);
      }
    }

    // 드래그 프리뷰 (circle / rect / dotted 등)
    if (dragStart && p.mouseIsPressed && !["triangle", "select", "bezier"].includes(currentTool)) {
      p.stroke(bwMode ? 0 : 180);
      p.strokeWeight(1 / zoom);
      p.noFill();
      p.drawingContext.setLineDash([]);
      if (currentTool === "circle" || currentTool === "concentric") {
        const r = p.dist(dragStart.x, dragStart.y, lmx, lmy);
        if (r > 2) p.circle(dragStart.x, dragStart.y, r * 2);
      } else if (currentTool === "rect") {
        const rw = Math.abs(lmx - dragStart.x),
          rh = Math.abs(lmy - dragStart.y);
        if (rw > 2 || rh > 2)
          p.rect(Math.min(dragStart.x, lmx), Math.min(dragStart.y, lmy), rw, rh);
      } else if (currentTool === "dotted") {
        p.strokeWeight(1 / zoom);
        p.drawingContext.setLineDash([3, 5]);
        p.line(dragStart.x, dragStart.y, lmx, lmy);
        p.drawingContext.setLineDash([]);
      }
    }

    // 트라이앵글 / 베지어 클릭 프리뷰
    if ((currentTool === "triangle" || currentTool === "bezier") && triPts.length > 0) {
      p.stroke(bwMode ? 0 : 180);
      p.strokeWeight(1 / zoom);
      p.noFill();
      p.drawingContext.setLineDash([]);
      if (currentTool === "bezier") {
        if (triPts.length === 1) p.line(triPts[0].x, triPts[0].y, lmx, lmy);
        else if (triPts.length === 2) {
          p.beginShape();
          p.vertex(triPts[0].x, triPts[0].y);
          p.quadraticVertex(triPts[1].x, triPts[1].y, lmx, lmy);
          p.endShape();
        }
      } else {
        for (let i = 0; i < triPts.length - 1; i++)
          p.line(triPts[i].x, triPts[i].y, triPts[i + 1].x, triPts[i + 1].y);
        p.line(triPts[triPts.length - 1].x, triPts[triPts.length - 1].y, lmx, lmy);
        if (triPts.length === 2) p.line(lmx, lmy, triPts[0].x, triPts[0].y);
      }
      p.fill(bwMode ? 0 : 150);
      p.noStroke();
      triPts.forEach((pt) => p.circle(pt.x, pt.y, 4 / zoom));
      document.getElementById("triCount").textContent = `${triPts.length} / 3  ·  Esc to cancel`;
    } else {
      document.getElementById("triCount").textContent = "";
    }

    p.pop();

    // 글리프 알림 토스트
    const cont = document.getElementById("sketch-container");
    const sx = cont.scrollLeft,
      sy = cont.scrollTop;
    if (glyphNotif && Date.now() - glyphNotif.time < 2000) {
      const fade = Math.min(1, (2000 - (Date.now() - glyphNotif.time)) / 300);
      p.noStroke();
      p.fill(glyphNotif.ok ? p.color(60, 120, 255, fade * 200) : p.color(210, 80, 60, fade * 200));
      p.rect(sx + 16, sy + 16, 190, 24, 2);
      p.fill(255, fade * 255);
      p.textAlign(p.LEFT, p.CENTER);
      p.textSize(8);
      p.text(
        glyphNotif.ok
          ? `"${glyphNotif.char}" saved to glyph library`
          : `"${glyphNotif.char}" not mapped yet`,
        sx + 24,
        sy + 28
      );
    }
  };

  p.mousePressed = function () {
    const lx = p.mouseX / zoom,
      ly = p.mouseY / zoom;
    if (lx < 0 || ly < 0 || lx > logicalW || ly > logicalH) return;
    if (isPlaying || p.mouseButton === p.RIGHT) return;
    if (currentTool === "select") {
      selDragStart = { x: lx, y: ly };
      selDragCurr = null;
      return;
    }
    if (currentTool === "triangle") {
      triPts.push({ x: lx, y: ly });
      if (triPts.length === 3) {
        shapes.push({ id: nextId++, type: "triangle", pts: [...triPts], color: nextColor() });
        triPts = [];
        pgDirty = true;
      }
      return;
    }
    if (currentTool === "bezier") {
      triPts.push({ x: lx, y: ly });
      if (triPts.length === 3) {
        shapes.push({ id: nextId++, type: "bezier", pts: [...triPts], color: nextColor() });
        triPts = [];
        pgDirty = true;
      }
      return;
    }
    if (currentTool === "pen") {
      penDrawing = true;
      penPath = [{ x: lx, y: ly }];
      penNodes = [];
      penLastPos = { x: lx, y: ly };
      penLastMoveTime = p.millis();
      penPauseCircle = null;
      return;
    }
    dragStart = { x: lx, y: ly };
  };

  p.mouseDragged = function () {
    const lx = p.mouseX / zoom,
      ly = p.mouseY / zoom;
    if (currentTool === "select" && selDragStart) selDragCurr = { x: lx, y: ly };
    if (currentTool === "pen" && penDrawing) {
      const dist = penLastPos ? Math.hypot(lx - penLastPos.x, ly - penLastPos.y) : 0;
      if (dist > 4) {
        if (penPauseCircle) {
          penNodes.push({ ...penPauseCircle });
          penPauseCircle = null;
        }
        penPath.push({ x: lx, y: ly });
        penLastPos = { x: lx, y: ly };
        penLastMoveTime = p.millis();
      }
    }
  };

  p.mouseReleased = function () {
    const lx = p.mouseX / zoom,
      ly = p.mouseY / zoom;
    if (lx < 0 || ly < 0 || lx > logicalW || ly > logicalH) {
      dragStart = null;
      selDragStart = null;
      selDragCurr = null;
      return;
    }
    if (currentTool === "select") {
      if (selDragStart) {
        const dist = Math.hypot(lx - selDragStart.x, ly - selDragStart.y);
        if (dist < 6) {
          const hit = findShapeAt(selDragStart.x, selDragStart.y);
          if (hit) {
            if (p.keyIsDown(p.SHIFT)) {
              if (selectedIds.has(hit.id)) selectedIds.delete(hit.id);
              else selectedIds.add(hit.id);
            } else {
              selectedIds.clear();
              selectedIds.add(hit.id);
            }
          } else selectedIds.clear();
        } else {
          const rx = Math.min(selDragStart.x, lx),
            ry = Math.min(selDragStart.y, ly);
          const rx2 = Math.max(selDragStart.x, lx),
            ry2 = Math.max(selDragStart.y, ly);
          if (!p.keyIsDown(p.SHIFT)) selectedIds.clear();
          for (const s of shapes) {
            const bb = shapeBBox(s);
            if (bb.x2 >= rx && bb.x1 <= rx2 && bb.y2 >= ry && bb.y1 <= ry2) selectedIds.add(s.id);
          }
        }
      }
      selDragStart = null;
      selDragCurr = null;
      return;
    }
    if (currentTool === "pen") {
      if (penDrawing) {
        if (penPauseCircle) {
          penNodes.push({ ...penPauseCircle });
          penPauseCircle = null;
        }
        if (penPath.length > 1) {
          const col = nextColor();
          shapes.push({ id: nextId++, type: "pen", path: [...penPath], nodes: [], color: col });
          for (const nd of penNodes)
            shapes.push({ id: nextId++, type: "penNode", x: nd.x, y: nd.y, r: nd.r, color: col });
          pgDirty = true;
        }
        penDrawing = false;
        penPath = [];
        penNodes = [];
        penLastPos = null;
        penPauseCircle = null;
      }
      return;
    }
    if (!dragStart || currentTool === "triangle" || currentTool === "bezier") {
      dragStart = null;
      return;
    }
    const d = p.dist(dragStart.x, dragStart.y, lx, ly);
    if (currentTool === "circle" && d > 5) {
      shapes.push({
        id: nextId++,
        type: "circle",
        x: dragStart.x,
        y: dragStart.y,
        r: d,
        color: nextColor(),
      });
      pgDirty = true;
    } else if (currentTool === "concentric" && d > 5) {
      shapes.push({
        id: nextId++,
        type: "concentric",
        x: dragStart.x,
        y: dragStart.y,
        r: d,
        rings: Math.max(2, Math.min(8, Math.round(d / 15))),
        color: nextColor(),
      });
      pgDirty = true;
    } else if (currentTool === "rect") {
      const rw = Math.abs(lx - dragStart.x),
        rh = Math.abs(ly - dragStart.y);
      if (rw > 5 && rh > 5) {
        shapes.push({
          id: nextId++,
          type: "rect",
          x: Math.min(dragStart.x, lx),
          y: Math.min(dragStart.y, ly),
          w: rw,
          h: rh,
          color: nextColor(),
        });
        pgDirty = true;
      }
    } else if (currentTool === "dotted" && d > 5) {
      shapes.push({
        id: nextId++,
        type: "dotted",
        x1: dragStart.x,
        y1: dragStart.y,
        x2: lx,
        y2: ly,
        dotGap: Math.max(4, Math.min(20, d / 12)),
        color: nextColor(),
      });
      pgDirty = true;
    }
    dragStart = null;
  };

  p.keyPressed = function () {
    if (p.keyCode === 27) {
      triPts = [];
      dragStart = null;
      selDragStart = null;
      selDragCurr = null;
      penDrawing = false;
      penPath = [];
      penNodes = [];
      penLastPos = null;
      penPauseCircle = null;
    }
    if (p.keyCode === p.BACKSPACE && !isPlaying && !typeMode && shapes.length > 0) {
      shapes.pop();
      pgDirty = true;
    }
  };

  p.windowResized = function () {
    const cont = document.getElementById("sketch-container");
    const newW = Math.max(cont.offsetWidth, logicalW);
    if (newW > logicalW) {
      logicalW = newW;
      pgDirty = true;
    }
    const newH = cont.offsetHeight;
    if (newH > logicalH) {
      logicalH = newH;
      pgDirty = true;
    }
    pRef.resizeCanvas(Math.round(logicalW * zoom), Math.round(logicalH * zoom));
  };
});

// ─── 재생 제어 ───────────────────────────────────────────────────────────────
async function startPlayback() {
  if (isPlaying) return;
  await Tone.start();
  initTone();
  isPlaying = true;
  scanX = 0;
  currentPlayLine = 0;
  prevLineHit = {};
  document.getElementById("playBtn").classList.add("active");
}

function stopPlayback() {
  isPlaying = false;
  stopAllAudio();
  prevLineHit = {};
  pgDirty = true;
  document.getElementById("playBtn").classList.remove("active");
}

// ─── UI 이벤트 ───────────────────────────────────────────────────────────────
document.getElementById("playBtn").addEventListener("click", () => {
  isPlaying ? stopPlayback() : startPlayback();
});

document.getElementById("clearBtn").addEventListener("click", () => {
  if (isPlaying) stopPlayback();
  shapes = [];
  triPts = [];
  dragStart = null;
  selectedIds.clear();
  typedStack = [];
  typeCursorY = null;
  typeLines = [];
  currentLineIdx = 0;
  lineWidths = {};
  scoreCenterX = Math.round(logicalW / 2);
  typeCursorX = LEFT_MARGIN;
  pgDirty = true;
});

document.getElementById("saveBtn").addEventListener("click", () => saveProject(true));
document.getElementById("loadBtn").addEventListener("click", loadProjectDialog);
document.getElementById("loadInput").addEventListener("change", (e) => {
  if (e.target.files[0]) loadProject(e.target.files[0]);
  e.target.value = "";
});

document.getElementById("bwBtn").addEventListener("click", () => {
  bwMode = !bwMode;
  document.getElementById("bwBtn").classList.toggle("active-bw", bwMode);
  pgDirty = true;
});

document.getElementById("zoomSlider").addEventListener("input", (e) => {
  dragStart = null;
  selDragStart = null;
  selDragCurr = null;
  const oldZoom = zoom;
  zoom = parseInt(e.target.value) / 100;
  document.getElementById("zoom-label").textContent = e.target.value + "%";
  const cont = document.getElementById("sketch-container");
  const logCX = (cont.scrollLeft + cont.clientWidth / 2) / oldZoom;
  const logCY = (cont.scrollTop + cont.clientHeight / 2) / oldZoom;
  if (pRef) pRef.resizeCanvas(Math.round(logicalW * zoom), Math.round(logicalH * zoom));
  cont.scrollLeft = logCX * zoom - cont.clientWidth / 2;
  cont.scrollTop = logCY * zoom - cont.clientHeight / 2;
});

// 툴 버튼 전환
const allToolIds = ["toolPen", "toolSelect"];
const toolMap = { toolPen: "pen", toolSelect: "select" };

function setActiveTool(id) {
  currentTool = toolMap[id];
  triPts = [];
  dragStart = null;
  selectedIds.clear();
  penDrawing = false;
  penPath = [];
  penNodes = [];
  penLastPos = null;
  penPauseCircle = null;
  allToolIds.forEach((k) => document.getElementById(k).classList.toggle("active", k === id));
}

allToolIds.forEach((id) => {
  document.getElementById(id).addEventListener("click", () => setActiveTool(id));
});

// Type Mode 토글
document.getElementById("typeModeBtn").addEventListener("click", () => {
  typeMode = !typeMode;
  document.getElementById("typeModeBtn").classList.toggle("active-type", typeMode);
  if (typeMode) {
    if (typeCursorY === null) typeCursorY = logicalH / 2;
    typeCursorX = LEFT_MARGIN + (lineWidths[currentLineIdx] || 0);
    if (typeLines.length === 0) {
      typeLines = [{ y: typeCursorY }];
      currentLineIdx = 0;
      pgDirty = true;
    }
  }
});

// 오버라이트 다이얼로그 버튼
document.getElementById("overwriteConfirmBtn").addEventListener("click", () => {
  if (pendingGlyph) {
    finalizeGlyph(pendingGlyph.char, pendingGlyph.sel);
    pendingGlyph = null;
  }
  document.getElementById("overwritePrompt").classList.remove("visible");
});

document.getElementById("overwriteCancelBtn").addEventListener("click", () => {
  pendingGlyph = null;
  document.getElementById("overwritePrompt").classList.remove("visible");
});

// 글리프 프롬프트 키 입력
document.getElementById("glyphInput").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    dismissGlyphPrompt();
    return;
  }
  if (/^[A-Za-z0-9?!.,\-]$/.test(e.key)) {
    e.preventDefault();
    commitGlyph(e.key);
  }
});

// 전역 키보드 단축키
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.target.matches("input, button")) {
    e.preventDefault();
    isPlaying ? stopPlayback() : startPlayback();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    saveProject(e.shiftKey); // Shift+CMD+S → Save As
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "g") {
    e.preventDefault();
    if (currentTool === "select" && selectedIds.size > 0) showGlyphPrompt();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "a") {
    e.preventDefault();
    setActiveTool("toolSelect");
    for (const s of shapes) selectedIds.add(s.id);
    return;
  }
  if (typeMode && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.matches("input")) {
    if (/^[A-Za-z0-9?!.,\-]$/.test(e.key)) {
      e.preventDefault();
      placeGlyph(e.key);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      undoLastGlyph();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      addTypeLine();
      return;
    }
  }
});
