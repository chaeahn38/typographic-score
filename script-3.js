// script-3.js
// 타입라인 레이아웃 / 글리프 시스템 (저장·배치·취소) / 프로젝트 저장·불러오기 (File System Access API)

// ─── 타입라인 helpers ────────────────────────────────────────────────────────

// 도형이 속한 줄(row) 인덱스 반환
function getShapeRow(s) {
  if (s.lineIdx !== undefined) return s.lineIdx;
  if (typeLines.length === 0) return 0;
  const bb = shapeBBox(s);
  const cy = (bb.y1 + bb.y2) / 2;
  const lh = computeLineHeight();
  for (let i = 0; i < typeLines.length; i++)
    if (cy >= typeLines[i].y - lh / 2 && cy < typeLines[i].y + lh / 2) return i;
  let nearest = 0, nearestDist = Infinity;
  for (let i = 0; i < typeLines.length; i++) {
    const d = Math.abs(cy - typeLines[i].y);
    if (d < nearestDist) { nearestDist = d; nearest = i; }
  }
  return nearest;
}

// 등록된 글리프 높이로 줄 간격 계산
function computeLineHeight() {
  const heights = Object.values(glyphs).map((g) => g.height);
  return Math.round(Math.max(150, (heights.length ? Math.max(...heights) : 200) * 1.6));
}

// 특정 줄에 속한 shape id 집합 반환
function getLineShapeIds(lineIdx) {
  const ids = new Set();
  for (const entry of typedStack)
    if ((entry.lineIdx ?? 0) === lineIdx) for (const id of entry.ids) ids.add(id);
  return ids;
}

// 새 타입라인 추가 (Enter 키)
function addTypeLine() {
  const lh = computeLineHeight();
  const curY = typeLines.length > 0 ? typeLines[currentLineIdx].y : logicalH / 2;
  const newY = curY + lh;
  typeLines.push({ y: newY });
  currentLineIdx = typeLines.length - 1;
  lineWidths[currentLineIdx] = 0;
  typeCursorX = LEFT_MARGIN;
  typeCursorY = newY;
  if (newY + lh * 0.7 > logicalH) {
    logicalH = Math.round(newY + lh + 80);
    if (pRef) pRef.resizeCanvas(Math.round(logicalW * zoom), Math.round(logicalH * zoom));
  }
  pgDirty = true;
  const cont = document.getElementById("sketch-container");
  cont.scrollTop = Math.max(0, newY * zoom - cont.clientHeight / 2);
}

// ─── 글리프 시스템 ───────────────────────────────────────────────────────────

function showGlyphPrompt() {
  document.getElementById("glyphPrompt").classList.add("visible");
  const inp = document.getElementById("glyphInput");
  inp.value = "";
  setTimeout(() => inp.focus(), 40);
}

function dismissGlyphPrompt() {
  document.getElementById("glyphPrompt").classList.remove("visible");
}

let pendingGlyph = null;

function finalizeGlyph(char, sel) {
  const bbs = sel.map(shapeBBox);
  const minX = Math.min(...bbs.map((b) => b.x1)), minY = Math.min(...bbs.map((b) => b.y1));
  const maxX = Math.max(...bbs.map((b) => b.x2)), maxY = Math.max(...bbs.map((b) => b.y2));
  glyphs[char] = {
    shapes: sel.map((s) => offsetShape(s, -minX, -minY)),
    width: maxX - minX,
    height: maxY - minY,
  };
  const selIds = new Set(sel.map((sh) => sh.id));
  shapes = shapes.filter((sh) => !selIds.has(sh.id));
  selectedIds.clear();
  pgDirty = true;
  glyphNotif = { char, time: Date.now(), ok: true };
  updateGlyphKeysUI();
  localStorage.setItem('typo-score-glyphs', JSON.stringify(glyphs));
}

// 선택된 도형을 알파벳 키에 글리프로 등록
function commitGlyph(char) {
  if (!/^[A-Za-z0-9?!.,\-]$/.test(char)) return;
  const sel = shapes.filter((s) => selectedIds.has(s.id));
  if (!sel.length) { dismissGlyphPrompt(); return; }
  dismissGlyphPrompt();
  if (glyphs[char]) {
    pendingGlyph = { char, sel };
    document.getElementById("overwriteChar").textContent = char;
    document.getElementById("overwritePrompt").classList.add("visible");
    return;
  }
  finalizeGlyph(char, sel);
}

// 등록된 글리프를 현재 커서 위치에 배치
function placeGlyph(char) {
  const g = glyphs[char];
  if (!g) { glyphNotif = { char, time: Date.now(), ok: false }; return false; }
  if (typeCursorY === null)
    typeCursorY = typeLines.length > 0 ? typeLines[currentLineIdx].y : logicalH / 2;
  const lineIdx = currentLineIdx;
  const W = lineWidths[lineIdx] || 0;
  const gap = W > 0 ? 24 : 0;
  const placeX = LEFT_MARGIN + W + gap;
  const newW = W + gap + g.width;
  lineWidths[lineIdx] = newW;
  const topY = typeCursorY - g.height / 2;
  const ids = [];
  for (const relS of g.shapes) {
    const placed = offsetShape(relS, placeX, topY);
    placed.id = nextId++;
    placed.lineIdx = lineIdx;
    shapes.push(placed);
    ids.push(placed.id);
  }
  typedStack.push({ char, ids, glyphWidth: g.width, lineIdx });
  if (LEFT_MARGIN + newW + 200 > logicalW) {
    logicalW += 800;
    if (pRef) pRef.resizeCanvas(Math.round(logicalW * zoom), Math.round(logicalH * zoom));
  }
  typeCursorX = LEFT_MARGIN + newW;
  pgDirty = true;
  const cont = document.getElementById("sketch-container");
  cont.scrollLeft = Math.max(0, typeCursorX * zoom - cont.clientWidth / 2);
  return true;
}

// 마지막 배치된 글리프 취소 (Backspace)
function undoLastGlyph() {
  if (!typedStack.length) return;
  const last = typedStack.pop();
  shapes = shapes.filter((s) => !last.ids.includes(s.id));
  const lineIdx = last.lineIdx ?? 0;
  const W = lineWidths[lineIdx] || 0;
  const gap = W > last.glyphWidth ? 24 : 0;
  lineWidths[lineIdx] = Math.max(0, W - last.glyphWidth - gap);
  currentLineIdx = lineIdx;
  typeCursorY = typeLines[lineIdx] ? typeLines[lineIdx].y : typeCursorY;
  typeCursorX = LEFT_MARGIN + (lineWidths[lineIdx] || 0);
  pgDirty = true;
}

// 툴바의 글리프 키 표시 업데이트
function updateGlyphKeysUI() {
  const keys = Object.keys(glyphs);
  const upper = keys.filter((k) => /[A-Z0-9?!.,\-]/.test(k)).sort();
  const lower = keys.filter((k) => /[a-z]/.test(k)).sort();
  const parts = [];
  if (upper.length) parts.push(upper.join(" "));
  if (lower.length) parts.push(lower.join(" "));
  document.getElementById("glyphKeys").textContent = parts.length ? "Glyphs: " + parts.join(" · ") : "";
}

// ─── 저장 / 불러오기 ─────────────────────────────────────────────────────────
let fileHandle = null;

function getProjectData() {
  return {
    version: 3, shapes, glyphs, typeCursorX, typeCursorY, typedStack,
    nextId, logicalW, logicalH, typeLines, currentLineIdx, lineWidths, scoreCenterX, bwMode,
  };
}

// 구형 브라우저용 다운로드 폴백
function downloadJson(json) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "score.json"; a.click();
  URL.revokeObjectURL(url);
}

// CMD+S → 덮어쓰기, Shift+CMD+S / Save 버튼 → Save As
async function saveProject(forceAs = false) {
  const json = JSON.stringify(getProjectData(), null, 2);
  if (!forceAs && fileHandle) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (e) {}
  }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "score.json",
        types: [{ description: "Score JSON", accept: { "application/json": [".json"] } }],
      });
      fileHandle = handle;
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
    } catch (e) {
      if (e.name !== "AbortError") downloadJson(json);
    }
  } else {
    downloadJson(json);
  }
}

// JSON 데이터를 앱 상태에 적용
function applyProjectData(data) {
  if (isPlaying) stopPlayback();
  shapes = data.shapes || [];
  glyphs = data.glyphs || {};
  typeCursorX = data.typeCursorX || 0;
  typeCursorY = data.typeCursorY || null;
  typedStack = data.typedStack || [];
  nextId = data.nextId || 0;
  typeLines = data.typeLines || [];
  currentLineIdx = data.currentLineIdx || 0;
  lineWidths = data.lineWidths || {};
  if (data.logicalW) logicalW = data.logicalW;
  if (data.logicalH) logicalH = data.logicalH;
  if (data.scoreCenterX) scoreCenterX = data.scoreCenterX;
  if (data.bwMode !== undefined) {
    bwMode = data.bwMode;
    document.getElementById("bwBtn").classList.toggle("active-bw", bwMode);
  }
  selectedIds.clear();
  pgDirty = true;
  if (pRef) pRef.resizeCanvas(Math.round(logicalW * zoom), Math.round(logicalH * zoom));
  updateGlyphKeysUI();
  localStorage.setItem('typo-score-glyphs', JSON.stringify(glyphs));
}

// Load 버튼: File System Access API 우선, 폴백은 <input type=file>
async function loadProjectDialog() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "Score JSON", accept: { "application/json": [".json"] } }],
      });
      fileHandle = handle;
      const file = await handle.getFile();
      applyProjectData(JSON.parse(await file.text()));
    } catch (e) {
      if (e.name !== "AbortError") alert("Could not open file.");
    }
  } else {
    document.getElementById("loadInput").click();
  }
}

// 구형 브라우저 <input> 폴백용
function loadProject(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try { applyProjectData(JSON.parse(e.target.result)); }
    catch { alert("Invalid project file."); }
  };
  reader.readAsText(file);
}

// 페이지 로드 시 글리프 라이브러리 복원
(function () {
  try {
    const saved = localStorage.getItem('typo-score-glyphs');
    if (saved) {
      Object.assign(glyphs, JSON.parse(saved));
      updateGlyphKeysUI();
    }
  } catch (e) {}
})();
