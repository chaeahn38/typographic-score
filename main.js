// main.js
// 전역 상태 변수 / 색상 풀 / 음계 계산 / Tone.js 오디오 엔진 초기화 및 재생 제어

// ─── State ─────────────────────────────────────────────────────────────────
let currentTool = "pen";
let shapes = [];
let nextId = 0;
let dragStart = null;
let triPts = [];
let isPlaying = false;
let scanX = 0;
let currentPlayLine = 0;
let bwMode = true;
let fontMode = "regular"; // "regular" | "bold" | "line" | "dots"

let zoom = 0.8;
let logicalW = 1200;
let logicalH = 600;
let tracking = 10;

let selectedIds = new Set();
let selDragStart = null;
let selDragCurr = null;

let glyphs = {};
let typedStack = [];
let typeCursorX = 0;
let typeCursorY = null;
let typeMode = false;
let typeCursorCharIdx = 0;
let glyphNotif = null;
let typeLines = [];
let currentLineIdx = 0;
let lineWidths = {};
let scoreCenterX = 600;
const LEFT_MARGIN = 60;

let pRef = null;
let pg = null;
let pgDirty = true;

let penDrawing = false;
let penPath = [];
let penNodes = [];
let penLastPos = null;
let penLastMoveTime = 0;
let penPauseCircle = null;

// ─── Color pool ─────────────────────────────────────────────────────────────
const COLORS = ["#d42b2b", "#1a55d4", "#1e9e3a", "#e07010", "#0890ec", "#f00372", "#5a4fcf"];
let colorPool = [];
function nextColor() {
  if (bwMode) return "#000000";
  if (colorPool.length === 0) {
    colorPool = [...COLORS];
    for (let i = colorPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [colorPool[i], colorPool[j]] = [colorPool[j], colorPool[i]];
    }
  }
  return colorPool.pop();
}

// ─── Musical scale ───────────────────────────────────────────────────────────
const SCALE_FREQS = []; // soprano: octaves 2–6
const TENOR_FREQS = []; // tenor (BLACK mode): octaves 0–4
(function buildScales() {
  const penta = [0, 2, 4, 7, 9];
  for (let oct = 2; oct <= 6; oct++)
    for (const s of penta) SCALE_FREQS.push(440 * Math.pow(2, (12 * (oct + 1) + s - 69) / 12));
  SCALE_FREQS.sort((a, b) => a - b);

  for (let oct = 0; oct <= 4; oct++)
    for (const s of penta) TENOR_FREQS.push(440 * Math.pow(2, (12 * (oct + 1) + s - 69) / 12));
  TENOR_FREQS.sort((a, b) => a - b);
})();

function yToNote(y, h) {
  const freqs = fontMode === "bold" ? TENOR_FREQS : SCALE_FREQS;
  const t = 1 - Math.max(0, Math.min(1, y / h));
  const idx = Math.round(t * (freqs.length - 1));
  return freqs[Math.max(0, Math.min(freqs.length - 1, idx))];
}

// ─── Tone.js synth pools ─────────────────────────────────────────────────────
let toneStarted = false;
let reverb, limiter, lineChorus, lineFilter, lineDelay;
let sinePool = [],
  fmNodePool = [],
  lineSinePool = [];
const MAX_POLY = 12;

function initTone() {
  if (toneStarted) return;
  toneStarted = true;
  reverb = new Tone.Reverb({ decay: 4, wet: 0.4, preDelay: 0.1 }).toDestination();
  limiter = new Tone.Compressor({ threshold: -18, ratio: 5, attack: 0.005, release: 0.2 }).connect(
    reverb
  );

  // pen 경로 — 부드러운 사인파
  for (let i = 0; i < MAX_POLY; i++) {
    const sine = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 1.4, decay: 0.2, sustain: 0.9, release: 3.5 },
    });
    sine.volume.value = 6;
    sine.connect(limiter);
    sinePool.push({ synth: sine, busy: false, shapeId: null });
  }
  // LINE 모드 전용 — 통통 튀는 소리 (짧은 어택 + 핑퐁 딜레이)
  lineDelay = new Tone.PingPongDelay({ delayTime: 0.15, feedback: 0.35, wet: 0.4 }).connect(
    limiter
  );
  for (let i = 0; i < MAX_POLY; i++) {
    const s = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.04, decay: 0.5, sustain: 0.35, release: 2.0 },
    });
    s.volume.value = 4;
    s.connect(lineDelay);
    lineSinePool.push({ synth: s, busy: false, shapeId: null });
  }
  // penNode (멈춤 원) — FM 벨 소리
  for (let i = 0; i < MAX_POLY; i++) {
    const fmNode = new Tone.FMSynth({
      harmonicity: 2,
      modulationIndex: 14,
      oscillator: { type: "sine" },
      envelope: { attack: 0.6, decay: 1.0, sustain: 0.2, release: 3.5 },
      modulation: { type: "sine" },
      modulationEnvelope: { attack: 0.04, decay: 0.4, sustain: 0.1, release: 2.5 },
    });
    fmNode.volume.value = 4;
    fmNode.connect(limiter);
    fmNodePool.push({ synth: fmNode, busy: false, shapeId: null });
  }
}

// ─── Synth pool 선택 ─────────────────────────────────────────────────────────
function getPool(type) {
  if (fontMode === "line") return lineSinePool;
  if (type === "penNode") return fmNodePool;
  return sinePool;
}

// ─── 음 트리거 / 업데이트 / 해제 ────────────────────────────────────────────
let activeSounds = {};

function triggerShape(s, freq) {
  if (activeSounds[s.id]) return;
  const pool = getPool(s.type);
  const slot = pool.find((p) => !p.busy);
  if (!slot) return;
  slot.busy = true;
  slot.shapeId = s.id;
  slot.synth.volume.value = fontMode === "bold" ? 14 : 6;
  slot.synth.triggerAttack(Tone.Frequency(freq, "hz").toNote());
  activeSounds[s.id] = { pool, slot, type: s.type, lastFreq: freq };
}

function updateShapeFreq(s, freq) {
  const active = activeSounds[s.id];
  if (!active) return;
  if (Math.abs(freq - active.lastFreq) > 2) {
    active.slot.synth.frequency.rampTo(freq, 0.08);
    active.lastFreq = freq;
  }
}

function releaseShape(id) {
  const active = activeSounds[id];
  if (!active) return;
  try {
    active.slot.synth.triggerRelease();
  } catch (e) {}
  setTimeout(() => {
    active.slot.busy = false;
    active.slot.shapeId = null;
    active.slot.synth.volume.value = 6;
  }, 1800);
  delete activeSounds[id];
}

function stopAllAudio() {
  for (const id in activeSounds) {
    const active = activeSounds[id];
    try {
      active.slot.synth.triggerRelease();
    } catch (e) {}
    setTimeout(() => {
      active.slot.busy = false;
      active.slot.shapeId = null;
    }, 200);
  }
  activeSounds = {};
}

// ─── 스캔라인 오디오 업데이트 ────────────────────────────────────────────────
function updateAudio(h, shapesToPlay) {
  const activeSet = new Set();
  for (const s of shapesToPlay) {
    // DOT 모드: pen 경로 오디오 뮤트
    if (fontMode === "dots" && s.type === "pen") {
      if (activeSounds[s.id]) releaseShape(s.id);
      continue;
    }
    const y = getIntersectionY(s, scanX);
    if (y === null) {
      if (activeSounds[s.id]) releaseShape(s.id);
      continue;
    }
    const freq = yToNote(y, h);
    activeSet.add(s.id);
    if (!activeSounds[s.id]) triggerShape(s, freq);
    else updateShapeFreq(s, freq);
  }
  for (const id in activeSounds) {
    if (!activeSet.has(parseInt(id))) releaseShape(parseInt(id));
  }
}

// ─── pen / penNode 전용 ──────────────────────────────────────────────────────

function getIntersectionY(s, x) {
  if (s.type === "penNode") return Math.abs(x - s.x) <= s.r ? s.y : null;
  if (s.type === "pen") {
    if (s.path && s.path.length > 1) {
      for (let i = 0; i < s.path.length - 1; i++) {
        const a = s.path[i],
          b = s.path[i + 1];
        const mn = Math.min(a.x, b.x),
          mx = Math.max(a.x, b.x);
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

function ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay,
    l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function shapeDist(s, x, y) {
  if (s.type === "penNode") return Math.abs(Math.hypot(x - s.x, y - s.y) - s.r);
  if (s.type === "pen") {
    let minD = Infinity;
    if (s.path)
      for (let i = 0; i < s.path.length - 1; i++)
        minD = Math.min(
          minD,
          ptSegDist(x, y, s.path[i].x, s.path[i].y, s.path[i + 1].x, s.path[i + 1].y)
        );
    if (s.nodes)
      for (const nd of s.nodes)
        minD = Math.min(minD, Math.abs(Math.hypot(x - nd.x, y - nd.y) - nd.r));
    return minD;
  }
  return Infinity;
}

function shapeBBox(s) {
  if (s.type === "penNode") return { x1: s.x - s.r, y1: s.y - s.r, x2: s.x + s.r, y2: s.y + s.r };
  if (s.type === "pen") {
    const allX = [
      ...(s.path || []).map((p) => p.x),
      ...(s.nodes || []).flatMap((n) => [n.x - n.r, n.x + n.r]),
    ];
    const allY = [
      ...(s.path || []).map((p) => p.y),
      ...(s.nodes || []).flatMap((n) => [n.y - n.r, n.y + n.r]),
    ];
    if (!allX.length) return { x1: 0, y1: 0, x2: 0, y2: 0 };
    return {
      x1: Math.min(...allX),
      y1: Math.min(...allY),
      x2: Math.max(...allX),
      y2: Math.max(...allY),
    };
  }
  return { x1: 0, y1: 0, x2: 0, y2: 0 };
}

function offsetShape(s, dx, dy) {
  const n = JSON.parse(JSON.stringify(s));
  if (s.type === "pen") {
    n.path = s.path.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
    n.nodes = s.nodes.map((nd) => ({ x: nd.x + dx, y: nd.y + dy, r: nd.r }));
  } else if (s.type === "penNode") {
    n.x += dx;
    n.y += dy;
  }
  return n;
}

function offsetShapeXInPlace(s, dx) {
  if (s.type === "pen") {
    s.path.forEach((pt) => { pt.x += dx; });
    s.nodes.forEach((nd) => { nd.x += dx; });
  } else if (s.type === "penNode") {
    s.x += dx;
  }
}

function offsetShapeYInPlace(s, dy) {
  if (s.type === "pen") {
    s.path.forEach((pt) => { pt.y += dy; });
    s.nodes.forEach((nd) => { nd.y += dy; });
  } else if (s.type === "penNode") {
    s.y += dy;
  }
}

function findShapeAt(x, y) {
  let best = null,
    bestD = 24 / zoom;
  for (const s of shapes) {
    const d = shapeDist(s, x, y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function deleteNearest(x, y) {
  let best = Infinity,
    idx = -1;
  shapes.forEach((s, i) => {
    const d = shapeDist(s, x, y);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  if (idx >= 0 && best < 32 / zoom) {
    shapes.splice(idx, 1);
    pgDirty = true;
  }
}

// ─── 타입라인 레이아웃 / 글리프 시스템 / 저장·불러오기 ──────────────────────

function getShapeRow(s) {
  if (s.lineIdx !== undefined) return s.lineIdx;
  if (typeLines.length === 0) return 0;
  const bb = shapeBBox(s);
  const cy = (bb.y1 + bb.y2) / 2;
  const lh = computeLineHeight();
  for (let i = 0; i < typeLines.length; i++)
    if (cy >= typeLines[i].y - lh / 2 && cy < typeLines[i].y + lh / 2) return i;
  let nearest = 0,
    nearestDist = Infinity;
  for (let i = 0; i < typeLines.length; i++) {
    const d = Math.abs(cy - typeLines[i].y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = i;
    }
  }
  return nearest;
}

function computeLineHeight() {
  const heights = Object.values(glyphs).map((g) => g.height);
  return Math.round(Math.max(150, (heights.length ? Math.max(...heights) : 200) * 0.6));
}

function getLineShapeIds(lineIdx) {
  const ids = new Set();
  for (const entry of typedStack)
    if ((entry.lineIdx ?? 0) === lineIdx) for (const id of entry.ids) ids.add(id);
  return ids;
}

function shiftLineShapesX(lineIdx, delta) {
  if (Math.abs(delta) < 0.01) return;
  for (const entry of typedStack) {
    if ((entry.lineIdx ?? 0) === lineIdx) {
      for (const id of entry.ids) {
        const s = shapes.find((sh) => sh.id === id);
        if (s) offsetShapeXInPlace(s, delta);
      }
    }
  }
}

function addTypeLine() {
  const lh = computeLineHeight();
  const curY = typeLines.length > 0 ? typeLines[currentLineIdx].y : logicalH / 2;
  const newY = curY + lh;
  typeLines.push({ y: newY });
  currentLineIdx = typeLines.length - 1;
  lineWidths[currentLineIdx] = 0;
  typeCursorX = scoreCenterX;
  typeCursorY = newY;
  if (newY + lh * 0.7 > logicalH) {
    logicalH = Math.round(newY + lh + 80);
  }
  pgDirty = true;
}

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
  const minX = Math.min(...bbs.map((b) => b.x1)),
    minY = Math.min(...bbs.map((b) => b.y1));
  const maxX = Math.max(...bbs.map((b) => b.x2)),
    maxY = Math.max(...bbs.map((b) => b.y2));
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
  localStorage.setItem("typo-score-glyphs", JSON.stringify(glyphs));
}

function commitGlyph(char) {
  if (!/^[A-Za-z0-9?!.,\-]$/.test(char)) return;
  const sel = shapes.filter((s) => selectedIds.has(s.id));
  if (!sel.length) {
    dismissGlyphPrompt();
    return;
  }
  dismissGlyphPrompt();
  if (glyphs[char]) {
    pendingGlyph = { char, sel };
    document.getElementById("overwriteChar").textContent = char;
    document.getElementById("overwritePrompt").classList.add("visible");
    return;
  }
  finalizeGlyph(char, sel);
}

const SPACE_WIDTH = 20;
function placeSpace() {
  if (typeCursorY === null) return;
  const lineIdx = currentLineIdx;
  const W = lineWidths[lineIdx] || 0;
  const gap = W > 0 ? 24 + tracking : 0;
  const newW = W + gap + SPACE_WIDTH;
  shiftLineShapesX(lineIdx, -(gap + SPACE_WIDTH) / 2);
  lineWidths[lineIdx] = newW;
  typedStack.push({ char: " ", ids: [], glyphWidth: SPACE_WIDTH, gap, lineIdx });
  typeCursorX = scoreCenterX + newW / 2;
}

function pasteTextWithWrap(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let lineLimit = 7 + Math.round(Math.random());
  let wordCount = 0;
  for (const word of words) {
    if (wordCount > 0 && wordCount % lineLimit === 0) {
      addTypeLine();
      lineLimit = 7 + Math.round(Math.random());
    } else if (wordCount > 0) {
      placeSpace();
    }
    for (const char of word) {
      if (/^[A-Za-z0-9?!.,\-]$/.test(char)) placeGlyph(char);
    }
    wordCount++;
  }
}

function getLineEntries(lineIdx) {
  return typedStack.filter((e) => (e.lineIdx ?? 0) === lineIdx);
}

function getLineCursorX(lineIdx, charIdx) {
  const entries = getLineEntries(lineIdx);
  const W = lineWidths[lineIdx] || 0;
  let x = scoreCenterX - W / 2;
  for (let i = 0; i < Math.min(charIdx, entries.length); i++) {
    x += entries[i].gap + entries[i].glyphWidth;
  }
  return x;
}

function setCursorFromClick(lx, ly) {
  if (!typeLines.length) return;
  let closestLine = 0, minDist = Infinity;
  for (let i = 0; i < typeLines.length; i++) {
    const d = Math.abs(typeLines[i].y - ly);
    if (d < minDist) { minDist = d; closestLine = i; }
  }
  const entries = getLineEntries(closestLine);
  const W = lineWidths[closestLine] || 0;
  const slotXs = [scoreCenterX - W / 2];
  let x = scoreCenterX - W / 2;
  for (const e of entries) { x += e.gap + e.glyphWidth; slotXs.push(x); }
  let closestSlot = slotXs.length - 1, minXDist = Infinity;
  for (let i = 0; i < slotXs.length; i++) {
    const d = Math.abs(slotXs[i] - lx);
    if (d < minXDist) { minXDist = d; closestSlot = i; }
  }
  currentLineIdx = closestLine;
  typeCursorCharIdx = closestSlot;
  typeCursorY = typeLines[closestLine].y;
  typeCursorX = slotXs[closestSlot];
  pgDirty = true;
}

function placeGlyph(char) {
  const g = glyphs[char];
  if (!g) { glyphNotif = { char, time: Date.now(), ok: false }; return false; }
  if (typeCursorY === null)
    typeCursorY = typeLines.length > 0 ? typeLines[currentLineIdx].y : logicalH / 2;

  const lineIdx = currentLineIdx;
  const entries = getLineEntries(lineIdx);
  const charIdx = Math.min(typeCursorCharIdx, entries.length);
  const W = lineWidths[lineIdx] || 0;

  const addition = g.width + (W > 0 ? 24 + tracking : 0);
  const newW = W + addition;
  const gapBeforeNew = charIdx === 0 || W === 0 ? 0 : 24 + tracking;

  // shift ALL shapes left by addition/2 (centering)
  for (const e of entries) {
    for (const id of e.ids) {
      const s = shapes.find((sh) => sh.id === id);
      if (s) offsetShapeXInPlace(s, -addition / 2);
    }
  }
  // shift shapes at charIdx and after right by addition
  for (let i = charIdx; i < entries.length; i++) {
    for (const id of entries[i].ids) {
      const s = shapes.find((sh) => sh.id === id);
      if (s) offsetShapeXInPlace(s, addition);
    }
  }
  // if inserting at position 0 in non-empty line, old first entry gets a gap
  if (charIdx === 0 && entries.length > 0 && W > 0) entries[0].gap = 24 + tracking;

  let prefixW = 0;
  for (let i = 0; i < charIdx; i++) prefixW += entries[i].gap + entries[i].glyphWidth;
  const placeX = scoreCenterX - newW / 2 + prefixW + gapBeforeNew;

  const ty = typeCursorY - g.height / 2;
  const ids = [];
  for (const relS of g.shapes) {
    const placed = offsetShape(relS, placeX, ty);
    placed.id = nextId++;
    placed.lineIdx = lineIdx;
    shapes.push(placed);
    ids.push(placed.id);
  }

  const newEntry = { char, ids, glyphWidth: g.width, gap: gapBeforeNew, lineIdx };
  if (charIdx >= entries.length) {
    let insertPos = typedStack.length;
    for (let i = typedStack.length - 1; i >= 0; i--) {
      if ((typedStack[i].lineIdx ?? 0) <= lineIdx) { insertPos = i + 1; break; }
    }
    typedStack.splice(insertPos, 0, newEntry);
  } else {
    typedStack.splice(typedStack.indexOf(entries[charIdx]), 0, newEntry);
  }

  lineWidths[lineIdx] = newW;
  typeCursorCharIdx = charIdx + 1;
  typeCursorX = scoreCenterX + newW / 2;
  pgDirty = true;
  return true;
}

function mergeWithPreviousLine() {
  if (currentLineIdx === 0) return;
  const prevIdx = currentLineIdx - 1;
  const currIdx = currentLineIdx;
  const PW = lineWidths[prevIdx] || 0;
  const CW = lineWidths[currIdx] || 0;
  const gap = PW > 0 && CW > 0 ? 24 + tracking : 0;
  const mergedW = PW + gap + CW;
  const prevEntries = getLineEntries(prevIdx);
  const currEntries = getLineEntries(currIdx);
  const deltaY = typeLines[prevIdx].y - typeLines[currIdx].y;

  for (const e of prevEntries)
    for (const id of e.ids) {
      const s = shapes.find((sh) => sh.id === id);
      if (s) offsetShapeXInPlace(s, -(gap + CW) / 2);
    }

  for (const e of currEntries)
    for (const id of e.ids) {
      const s = shapes.find((sh) => sh.id === id);
      if (s) { offsetShapeXInPlace(s, (PW + gap) / 2); offsetShapeYInPlace(s, deltaY); }
    }

  if (currEntries.length > 0 && PW > 0) currEntries[0].gap = 24 + tracking;
  for (const e of currEntries) e.lineIdx = prevIdx;

  lineWidths[prevIdx] = mergedW;
  delete lineWidths[currIdx];
  typeLines.splice(currIdx, 1);
  currentLineIdx = prevIdx;
  typeCursorCharIdx = prevEntries.length;
  typeCursorY = typeLines[prevIdx].y;
  pgDirty = true;
}

function deleteAtCursor() {
  const lineIdx = currentLineIdx;
  const entries = getLineEntries(lineIdx);
  const charIdx = typeCursorCharIdx - 1;
  if (charIdx < 0) { mergeWithPreviousLine(); return; }

  const entry = entries[charIdx];
  const nextEntry = entries[charIdx + 1];
  const W = lineWidths[lineIdx] || 0;
  const reduction = entry.glyphWidth + (charIdx === 0 ? (nextEntry?.gap || 0) : entry.gap);
  const newW = Math.max(0, W - reduction);

  if (charIdx === 0 && nextEntry) nextEntry.gap = 0;

  const removedIds = new Set(entry.ids);
  shapes = shapes.filter((s) => !removedIds.has(s.id));

  const remaining = entries.filter((_, i) => i !== charIdx);
  for (const e of remaining) {
    for (const id of e.ids) {
      const s = shapes.find((sh) => sh.id === id);
      if (s) offsetShapeXInPlace(s, reduction / 2);
    }
  }
  for (let i = charIdx; i < remaining.length; i++) {
    for (const id of remaining[i].ids) {
      const s = shapes.find((sh) => sh.id === id);
      if (s) offsetShapeXInPlace(s, -reduction);
    }
  }

  typedStack.splice(typedStack.indexOf(entry), 1);
  lineWidths[lineIdx] = newW;
  typeCursorCharIdx = charIdx;
  typeCursorY = typeLines[lineIdx]?.y ?? typeCursorY;
  typeCursorX = getLineCursorX(lineIdx, charIdx);
  pgDirty = true;
}

function clearAllTyped() {
  const allIds = new Set(typedStack.flatMap((e) => e.ids));
  shapes = shapes.filter((s) => !allIds.has(s.id));
  typedStack = [];
  lineWidths = {};
  typeLines = [{ y: logicalH / 2 }];
  currentLineIdx = 0;
  typeCursorX = scoreCenterX;
  typeCursorY = logicalH / 2;
  selectedIds.clear();
  pgDirty = true;
}

function relayoutAllText() {
  if (!typedStack.length) return;
  const chars = typedStack.map((e) => ({ char: e.char, lineIdx: e.lineIdx }));
  const savedLineYs = typeLines.map((l) => l.y);
  const allIds = new Set(typedStack.flatMap((e) => e.ids));
  shapes = shapes.filter((s) => !allIds.has(s.id));
  typedStack = [];
  lineWidths = {};
  let prevLineIdx = -1;
  for (const { char, lineIdx } of chars) {
    if (lineIdx !== prevLineIdx) {
      currentLineIdx = lineIdx;
      typeCursorY = savedLineYs[lineIdx] || typeCursorY;
      prevLineIdx = lineIdx;
    }
    if (char === " ") placeSpace();
    else placeGlyph(char);
  }
  pgDirty = true;
}

function updateGlyphKeysUI() {
  const keys = Object.keys(glyphs);
  const upper = keys.filter((k) => /[A-Z0-9?!.,\-]/.test(k)).sort();
  const lower = keys.filter((k) => /[a-z]/.test(k)).sort();
  const parts = [];
  if (upper.length) parts.push(upper.join(" "));
  if (lower.length) parts.push(lower.join(" "));
  document.getElementById("glyphKeys").textContent = parts.length
    ? "Glyphs: " + parts.join(" · ")
    : "";
}

// ─── 저장 / 불러오기 ─────────────────────────────────────────────────────────
let fileHandle = null;

function getProjectData() {
  return {
    version: 3,
    shapes,
    glyphs,
    typeCursorX,
    typeCursorY,
    typedStack,
    nextId,
    logicalW,
    logicalH,
    typeLines,
    currentLineIdx,
    lineWidths,
    scoreCenterX,
    bwMode,
  };
}

function downloadJson(json) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "score.json";
  a.click();
  URL.revokeObjectURL(url);
}

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
  const cont = document.getElementById("sketch-container");
  logicalW = data.logicalW || cont.clientWidth;
  logicalH = data.logicalH || cont.clientHeight;
  scoreCenterX = Math.round(cont.clientWidth / 2);
  if (data.bwMode !== undefined) {
    bwMode = data.bwMode;
    document.getElementById("bwBtn").classList.toggle("active-bw", bwMode);
  }
  selectedIds.clear();
  pgDirty = true;
  if (pRef) {
    pRef.resizeCanvas(cont.clientWidth, cont.clientHeight);
  }
  updateGlyphKeysUI();
  localStorage.setItem("typo-score-glyphs", JSON.stringify(glyphs));
}

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

function loadProject(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      applyProjectData(JSON.parse(e.target.result));
    } catch {
      alert("Invalid project file.");
    }
  };
  reader.readAsText(file);
}

const RANDOM_PHRASES = [
  "Sunshine",
  "Daisy",
  "Butter",
  "Mellow",
  "Linen",
  "Soft",
  "Amber",
  "Haze",
  "Dew",
  "Velvet",
  "Morning",
  "Light",
  "Sunwarm",
  "Meadow",
  "Breeze",
];

function insertRandomPhrase() {
  if (!Object.keys(glyphs).length) return;
  const phrase = RANDOM_PHRASES[Math.floor(Math.random() * RANDOM_PHRASES.length)];
  const MARGIN = 80;
  const availW = logicalW - MARGIN * 2;

  function calcWordW(word) {
    let w = 0,
      first = true;
    for (const char of word) {
      const g = glyphs[char];
      if (!g) continue;
      if (!first) w += 24 + tracking;
      w += g.width;
      first = false;
    }
    return w;
  }

  const allWords = phrase
    .split("\n")
    .flatMap((l) => l.trim().split(/\s+/))
    .filter(Boolean);
  const lineGroups = [];
  let curGroup = [],
    curW = 0;
  for (const word of allWords) {
    const ww = calcWordW(word);
    const spaceW = curW > 0 ? 24 + tracking + SPACE_WIDTH + (24 + tracking) : 0;
    if (curW + spaceW + ww > availW && curGroup.length > 0) {
      lineGroups.push(curGroup);
      curGroup = [word];
      curW = ww;
    } else {
      curGroup.push(word);
      curW += spaceW + ww;
    }
  }
  if (curGroup.length > 0) lineGroups.push(curGroup);

  const lh = computeLineHeight();
  const startY = Math.round(logicalH / 2 - ((lineGroups.length - 1) * lh) / 2);

  typeCursorY = startY;
  typeLines = [{ y: startY }];
  currentLineIdx = 0;

  for (let i = 0; i < lineGroups.length; i++) {
    if (i > 0) addTypeLine();
    const words = lineGroups[i];
    for (let j = 0; j < words.length; j++) {
      if (j > 0) placeSpace();
      for (const char of words[j]) {
        if (/^[A-Za-z0-9?!.,\-]$/.test(char)) placeGlyph(char);
      }
    }
  }
}

// 페이지 로드 시 글리프 라이브러리 복원
(function () {
  try {
    const saved = localStorage.getItem("typo-score-glyphs");
    if (saved) {
      Object.assign(glyphs, JSON.parse(saved));
      updateGlyphKeysUI();
    }
  } catch (e) {}
})();

// ─── p5.js 스케치 (도형 렌더링, 마우스/키 이벤트) ───────────────────────────
new p5(function (p) {
  function getShapeColor(s) {
    if (bwMode) return "#000000";
    return s.color || "#111";
  }

  function drawShapeToG(g, s, isHit) {
    if (fontMode === "dots" && s.type === "pen") return;

    const baseCol = getShapeColor(s);
    const col = p.color(baseCol);
    const r = p.red(col),
      gr = p.green(col),
      b = p.blue(col);
    const fr = isHit ? r * 0.5 + 127.5 : r;
    const fg = isHit ? gr * 0.5 + 127.5 : gr;
    const fb = isHit ? b * 0.5 + 127.5 : b;
    const alpha = isHit ? 180 : 255;
    const sw = fontMode === "bold" ? 3 : 1;

    function applyFill() {
      if (fontMode === "line") {
        g.noFill();
        g.stroke(fr, fg, fb, alpha);
        g.strokeWeight(2 * sw);
      } else {
        g.noStroke();
        g.fill(fr, fg, fb, alpha);
      }
    }

    function drawStrokeExpanded(weight, drawFn) {
      if (fontMode === "line") {
        g.stroke(fr, fg, fb, alpha);
        g.strokeWeight(weight + 3);
        drawFn();
        g.stroke(255, 255, 255, 255);
        g.strokeWeight(Math.max(1, weight - 3));
        drawFn();
      } else {
        g.stroke(fr, fg, fb, alpha);
        g.strokeWeight(weight);
        drawFn();
      }
    }

    if (s.type === "pen") {
      g.drawingContext.setLineDash([]);
      if (s.path && s.path.length > 1) {
        g.noFill();
        g.strokeCap(p.ROUND);
        g.strokeJoin(p.ROUND);
        const pDraw = () => {
          g.beginShape();
          g.curveVertex(s.path[0].x, s.path[0].y);
          for (const pt of s.path) g.curveVertex(pt.x, pt.y);
          g.curveVertex(s.path[s.path.length - 1].x, s.path[s.path.length - 1].y);
          g.endShape();
        };
        drawStrokeExpanded(8 * sw, pDraw);
      }
      if (s.nodes && s.nodes.length) {
        g.noStroke();
        g.fill(fr, fg, fb, alpha);
        for (const nd of s.nodes) g.circle(nd.x, nd.y, nd.r * 2);
      }
    } else if (s.type === "penNode") {
      g.drawingContext.setLineDash([]);
      applyFill();
      if (fontMode === "line") g.strokeWeight(2);
      g.circle(s.x, s.y, s.r * 2);
    }
  }

  function renderBuffer() {
    if (!pg || pg.width !== p.width || pg.height !== p.height) {
      if (pg) pg.remove();
      pg = p.createGraphics(p.width, p.height);
    }
    pg.background(255);
    pg.push();
    pg.translate(p.width / 2, p.height / 2);
    pg.scale(zoom);
    pg.translate(-scoreCenterX, -logicalH / 2);
    for (const s of shapes) drawShapeToG(pg, s, false);
    pg.pop();
    pgDirty = false;
  }

  p.setup = function () {
    const cont = document.getElementById("sketch-container");
    logicalW = cont.clientWidth;
    logicalH = cont.clientHeight;
    scoreCenterX = Math.round(cont.clientWidth / 2);
    typeCursorX = scoreCenterX;
    const c = p.createCanvas(logicalW, logicalH);
    c.parent("sketch-container");
    pRef = p;
    pg = p.createGraphics(logicalW, logicalH);
    pgDirty = true;
    setTimeout(() => {
      if (pRef) pRef.windowResized();
    }, 100);
    fetch("score.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.glyphs) glyphs = data.glyphs;
        insertRandomPhrase();
      })
      .catch(() => insertRandomPhrase());
    c.elt.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const lx = (p.mouseX - p.width / 2) / zoom + scoreCenterX;
      const ly = (p.mouseY - p.height / 2) / zoom + logicalH / 2;
      if (!isPlaying && currentTool !== "select") deleteNearest(lx, ly);
    });
  };

  p.draw = function () {
    if (pgDirty) renderBuffer();
    p.background(255);
    const cw = p.width;
    const ch = p.height;
    const lmx = (p.mouseX - cw / 2) / zoom + scoreCenterX;
    const lmy = (p.mouseY - ch / 2) / zoom + logicalH / 2;
    p.image(pg, 0, 0);

    p.push();
    p.translate(cw / 2, ch / 2);
    p.scale(zoom);
    p.translate(-scoreCenterX, -logicalH / 2);

    if (isPlaying) {
      const speed = 8;
      updateAudio(logicalH, shapes);
      scanX += speed;
      if (scanX > logicalW + 30) {
        p.pop();
        stopPlayback();
        return;
      }
      for (const s of shapes) if (getIntersectionY(s, scanX) !== null) drawShapeToG(p, s, true);
    }

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

    if (typeMode) {
      const blink = Math.floor(p.millis() / 500) % 2 === 0;
      if (blink) {
        const cx = getLineCursorX(currentLineIdx, typeCursorCharIdx);
        const cy = typeCursorY !== null ? typeCursorY : logicalH / 2;
        p.stroke(80, 120, 255, 120);
        p.strokeWeight(1 / zoom);
        p.noFill();
        p.line(cx, cy - 70, cx, cy + 70);
      }
    }

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

    if (isPlaying) {
      const scanXScreen = cw / 2 + (scanX - scoreCenterX) * zoom;
      p.blendMode(p.DIFFERENCE);
      p.stroke(255);
      p.strokeWeight(1);
      p.line(scanXScreen, 0, scanXScreen, ch);
      p.blendMode(p.BLEND);
    }

    if (glyphNotif && Date.now() - glyphNotif.time < 2000) {
      const fade = Math.min(1, (2000 - (Date.now() - glyphNotif.time)) / 300);
      p.noStroke();
      p.fill(glyphNotif.ok ? p.color(60, 120, 255, fade * 200) : p.color(210, 80, 60, fade * 200));
      p.rect(16, 16, 190, 24, 2);
      p.fill(255, fade * 255);
      p.textAlign(p.LEFT, p.CENTER);
      p.textSize(8);
      p.text(
        glyphNotif.ok
          ? `"${glyphNotif.char}" saved to glyph library`
          : `"${glyphNotif.char}" not mapped yet`,
        24,
        28
      );
    }
  };

  p.mousePressed = function () {
    const lx = (p.mouseX - p.width / 2) / zoom + scoreCenterX;
    const ly = (p.mouseY - p.height / 2) / zoom + logicalH / 2;
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
    const lx = (p.mouseX - p.width / 2) / zoom + scoreCenterX;
    const ly = (p.mouseY - p.height / 2) / zoom + logicalH / 2;
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
    const lx = (p.mouseX - p.width / 2) / zoom + scoreCenterX;
    const ly = (p.mouseY - p.height / 2) / zoom + logicalH / 2;
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
    const newSCX = Math.round(cont.clientWidth / 2);
    const dx = newSCX - scoreCenterX;
    if (dx !== 0) {
      for (const s of shapes) offsetShapeXInPlace(s, dx);
      if (typeCursorY !== null) typeCursorX += dx;
    }
    scoreCenterX = newSCX;
    logicalW = cont.clientWidth;
    logicalH = cont.clientHeight;
    pRef.resizeCanvas(cont.clientWidth, cont.clientHeight);
    pgDirty = true;
  };
});

// ─── 재생 제어 ───────────────────────────────────────────────────────────────
function updateToolActiveStates() {
  document.getElementById("toolPen").classList.toggle("active", currentTool === "pen" && !typeMode && !isPlaying);
  document.getElementById("toolSelect").classList.toggle("active", currentTool === "select" && !typeMode && !isPlaying);
  document.getElementById("typeModeBtn").classList.toggle("active", typeMode);
  document.getElementById("playBtn").classList.toggle("active", isPlaying);
}

async function startPlayback() {
  if (isPlaying) return;
  await Tone.start();
  initTone();
  isPlaying = true;
  scanX = 0;
  currentPlayLine = 0;
  prevLineHit = {};
  updateToolActiveStates();
}

function stopPlayback() {
  isPlaying = false;
  stopAllAudio();
  prevLineHit = {};
  pgDirty = true;
  updateToolActiveStates();
}

// ─── UI 이벤트 ───────────────────────────────────────────────────────────────

document.addEventListener(
  "click",
  (e) => {
    if (e.detail === 0 && e.target.closest("button")) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  },
  true
);


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

document.getElementById("loadInput").addEventListener("change", (e) => {
  if (e.target.files[0]) loadProject(e.target.files[0]);
  e.target.value = "";
});

document.getElementById("bwBtn").addEventListener("click", () => {
  bwMode = !bwMode;
  document.getElementById("bwBtn").classList.toggle("active", !bwMode);
  pgDirty = true;
});

document.getElementById("trackingSlider").addEventListener("input", (e) => {
  tracking = parseInt(e.target.value);
  relayoutAllText();
});

const FONT_MODES = ["fontRegular", "fontBold", "fontLine", "fontDot"];
const FONT_MODE_MAP = {
  fontRegular: "regular",
  fontBold: "bold",
  fontLine: "line",
  fontDot: "dots",
};

function setFontMode(id) {
  fontMode = FONT_MODE_MAP[id];
  FONT_MODES.forEach((k) => document.getElementById(k).classList.toggle("active", k === id));
  pgDirty = true;
  if (fontMode !== "line" && isPlaying) stopAllAudio();
}

FONT_MODES.forEach((id) => {
  document.getElementById(id).addEventListener("click", () => setFontMode(id));
});

function applyZoomDelta(deltaPt) {
  const newPt = Math.min(240, Math.max(12, zoom * 30 + deltaPt));
  zoom = newPt / 30;
  pgDirty = true;
}

// trackpad pinch (ctrl+wheel on Mac)
document.getElementById("sketch-container").addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      applyZoomDelta(-e.deltaY * 0.4);
    }
  },
  { passive: false }
);

// touch pinch
let _pinchDist = null;
document.getElementById("sketch-container").addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length === 2)
      _pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
  },
  { passive: true }
);
document.getElementById("sketch-container").addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length === 2 && _pinchDist !== null) {
      e.preventDefault();
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      applyZoomDelta((d - _pinchDist) * 0.3);
      _pinchDist = d;
    }
  },
  { passive: false }
);
document.getElementById("sketch-container").addEventListener("touchend", () => {
  _pinchDist = null;
});

const toolMap = { toolPen: "pen", toolSelect: "select" };

function setActiveTool(id) {
  if (typeMode && id !== "typeModeBtn") { typeMode = false; typeCapture.blur(); }
  if (isPlaying && id !== "playBtn") stopPlayback();

  if (id === "typeModeBtn") {
    typeMode = !typeMode;
    if (typeMode) {
      if (typeCursorY === null) typeCursorY = logicalH / 2;
      if (typeLines.length === 0) { typeLines = [{ y: typeCursorY }]; currentLineIdx = 0; pgDirty = true; }
      const entries = getLineEntries(currentLineIdx);
      typeCursorCharIdx = entries.length;
      typeCapture.focus();
    } else {
      typeCapture.blur();
    }
  } else if (id === "playBtn") {
    if (isPlaying) { stopPlayback(); return; }
    else startPlayback();
  } else {
    currentTool = toolMap[id] || "pen";
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
  updateToolActiveStates();
}

["toolPen", "toolSelect", "typeModeBtn", "playBtn"].forEach((id) => {
  document.getElementById(id).addEventListener("click", () => setActiveTool(id));
});

// ─── typeCapture ───────────────────────────────────────────────────────────
const typeCapture = document.getElementById("typeCapture");

typeCapture.addEventListener("keydown", (e) => {
  if (!typeMode) return;
  if ((e.metaKey || e.ctrlKey) && e.key === "a") {
    e.preventDefault();
    e.stopPropagation();
    for (const entry of typedStack) for (const id of entry.ids) selectedIds.add(id);
    pgDirty = true;
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    const typedIds = typedStack.flatMap((en) => en.ids);
    const allSelected = typedIds.length > 0 && typedIds.every((id) => selectedIds.has(id));
    if (allSelected) { e.preventDefault(); e.stopPropagation(); clearAllTyped(); return; }
  }
  if (e.code === "Space" && !e.metaKey && !e.ctrlKey) {
    e.preventDefault(); placeSpace(); return;
  }
  if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (typeCursorCharIdx > 0) { typeCursorCharIdx--; }
      else if (currentLineIdx > 0) {
        currentLineIdx--;
        typeCursorCharIdx = getLineEntries(currentLineIdx).length;
        typeCursorY = typeLines[currentLineIdx]?.y ?? typeCursorY;
      }
      pgDirty = true; return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const entries = getLineEntries(currentLineIdx);
      if (typeCursorCharIdx < entries.length) { typeCursorCharIdx++; }
      else if (currentLineIdx < typeLines.length - 1) {
        currentLineIdx++;
        typeCursorCharIdx = 0;
        typeCursorY = typeLines[currentLineIdx]?.y ?? typeCursorY;
      }
      pgDirty = true; return;
    }
    if (/^[A-Za-z0-9?!.,\-]$/.test(e.key)) {
      e.preventDefault(); placeGlyph(e.key); return;
    }
    if (e.key === "Backspace") {
      e.preventDefault(); deleteAtCursor(); return;
    }
    if (e.key === "Enter") {
      e.preventDefault(); addTypeLine(); return;
    }
  }
});

typeCapture.addEventListener("paste", (e) => {
  e.preventDefault();
  if (!typeMode) return;
  const text = e.clipboardData.getData("text");
  if (text) pasteTextWithWrap(text);
  typeCapture.value = "";
});

document.getElementById("sketch-container").addEventListener("click", (e) => {
  if (!typeMode) return;
  const canvas = document.querySelector("#sketch-container canvas");
  if (canvas && pRef) {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const lx = (mx - pRef.width / 2) / zoom + scoreCenterX;
    const ly = (my - pRef.height / 2) / zoom + logicalH / 2;
    setCursorFromClick(lx, ly);
  }
  typeCapture.focus();
});

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

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    saveProject(e.shiftKey);
    return;
  }
  if (e.altKey && e.code === "KeyP") {
    e.preventDefault();
    document.getElementById("playBtn").click();
    return;
  }
  if (e.altKey && e.code === "KeyD") {
    e.preventDefault();
    document.getElementById("clearBtn").click();
    return;
  }
  if (e.altKey && e.code === "KeyT") {
    e.preventDefault();
    document.getElementById("typeModeBtn").click();
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
  if (typeMode && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.matches("input, textarea")) {
    if (e.code === "Space") {
      e.preventDefault();
      placeSpace();
      return;
    }
    if (/^[A-Za-z0-9?!.,\-]$/.test(e.key)) {
      e.preventDefault();
      placeGlyph(e.key);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      deleteAtCursor();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      addTypeLine();
      return;
    }
  }
});
