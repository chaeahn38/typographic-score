// script-1.js
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
let bwMode = false;

let zoom = 1.0;
let logicalW = 1200;
let logicalH = 600;

let selectedIds = new Set();
let selDragStart = null;
let selDragCurr = null;

let glyphs = {};
let typedStack = [];
let typeCursorX = 0;
let typeCursorY = null;
let typeMode = false;
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

// ─── Musical scale (pentatonic, octaves 2–6) ────────────────────────────────
const SCALE_FREQS = [];
(function buildScale() {
  const pentatonic = [0, 2, 4, 7, 9];
  for (let octave = 2; octave <= 6; octave++)
    for (const semi of pentatonic)
      SCALE_FREQS.push(440 * Math.pow(2, (12 * (octave + 1) + semi - 69) / 12));
  SCALE_FREQS.sort((a, b) => a - b);
})();

function yToNote(y, h) {
  const t = 1 - Math.max(0, Math.min(1, y / h));
  const idx = Math.round(t * (SCALE_FREQS.length - 1));
  return SCALE_FREQS[Math.max(0, Math.min(SCALE_FREQS.length - 1, idx))];
}

// ─── Tone.js synth pools ─────────────────────────────────────────────────────
let toneStarted = false;
let reverb, limiter;
let fmPool = [], sinePool = [], amPool = [], pluckPool = [], rectPool = [], fmNodePool = [];
const MAX_POLY = 12;

function initTone() {
  if (toneStarted) return;
  toneStarted = true;
  reverb = new Tone.Reverb({ decay: 4, wet: 0.4, preDelay: 0.1 }).toDestination();
  limiter = new Tone.Limiter(-6).connect(reverb);

  for (let i = 0; i < MAX_POLY; i++) {
    const fm = new Tone.FMSynth({
      harmonicity: 3.01, modulationIndex: 6,
      oscillator: { type: "sine" },
      envelope: { attack: 0.3, decay: 0.6, sustain: 0.6, release: 1.5 },
      modulation: { type: "sine" },
      modulationEnvelope: { attack: 0.4, decay: 0.3, sustain: 0.8, release: 1.2 },
    });
    fm.volume.value = -18;
    fm.connect(limiter);
    fmPool.push({ synth: fm, busy: false, shapeId: null });
  }
  for (let i = 0; i < MAX_POLY; i++) {
    const sine = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 1.4, decay: 0.2, sustain: 0.9, release: 3.5 },
    });
    sine.volume.value = -14;
    sine.connect(limiter);
    sinePool.push({ synth: sine, busy: false, shapeId: null });
  }
  for (let i = 0; i < MAX_POLY; i++) {
    const am = new Tone.AMSynth({
      harmonicity: 2.5, oscillator: { type: "triangle" },
      envelope: { attack: 0.4, decay: 0.5, sustain: 0.5, release: 2.0 },
      modulation: { type: "sine" },
      modulationEnvelope: { attack: 0.5, decay: 0.4, sustain: 0.7, release: 1.5 },
    });
    am.volume.value = -16;
    am.connect(limiter);
    amPool.push({ synth: am, busy: false, shapeId: null });
  }
  for (let i = 0; i < MAX_POLY; i++) {
    const pluck = new Tone.PluckSynth({ attackNoise: 1.2, dampening: 3000, resonance: 0.96 });
    pluck.volume.value = -12;
    pluck.connect(limiter);
    pluckPool.push({ synth: pluck, busy: false, shapeId: null });
  }
  for (let i = 0; i < MAX_POLY; i++) {
    const sq = new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0.8, release: 0.5 },
    });
    sq.volume.value = -40;
    sq.connect(limiter);
    rectPool.push({ synth: sq, busy: false, shapeId: null });
  }
  // FM bell — pause-circle (penNode) 전용: 높은 modulation, 긴 release
  for (let i = 0; i < MAX_POLY; i++) {
    const fmNode = new Tone.FMSynth({
      harmonicity: 2, modulationIndex: 14,
      oscillator: { type: "sine" },
      envelope: { attack: 0.6, decay: 1.0, sustain: 0.2, release: 3.5 },
      modulation: { type: "sine" },
      modulationEnvelope: { attack: 0.04, decay: 0.4, sustain: 0.1, release: 2.5 },
    });
    fmNode.volume.value = -12;
    fmNode.connect(limiter);
    fmNodePool.push({ synth: fmNode, busy: false, shapeId: null });
  }
}

// ─── Synth pool 선택 ─────────────────────────────────────────────────────────
function getPool(type) {
  if (type === "circle") return fmPool;
  if (type === "concentric") return fmPool;
  if (type === "semi") return sinePool;
  if (type === "triangle") return amPool;
  if (type === "line") return pluckPool;
  if (type === "dotted") return pluckPool;
  if (type === "bezier") return sinePool;
  if (type === "rect") return rectPool;
  if (type === "pen") return sinePool;
  if (type === "penNode") return fmNodePool;
  return fmPool;
}

// ─── 음 트리거 / 업데이트 / 해제 ────────────────────────────────────────────
let activeSounds = {};

function triggerShape(s, freq) {
  if (activeSounds[s.id]) return;
  const pool = getPool(s.type);
  let slot = pool.find((p) => !p.busy);
  if (!slot) return;
  slot.busy = true;
  slot.shapeId = s.id;
  const note = Tone.Frequency(freq, "hz").toNote();
  if (s.type === "line" || s.type === "dotted") {
    const volMap = { 1: -22, 2: -8 };
    slot.synth.volume.value = volMap[s.count || 1] ?? -15;
  }
  slot.synth.triggerAttack(note);
  activeSounds[s.id] = { pool, slot, type: s.type, lastFreq: freq };
}

function updateShapeFreq(s, freq) {
  const active = activeSounds[s.id];
  if (!active || s.type === "line" || s.type === "dotted") return;
  if (Math.abs(freq - active.lastFreq) > 2) {
    active.slot.synth.frequency.rampTo(freq, 0.08);
    active.lastFreq = freq;
  }
}

function releaseShape(id) {
  const active = activeSounds[id];
  if (!active) return;
  if (active.type !== "line" && active.type !== "dotted") {
    try { active.slot.synth.triggerRelease(); } catch (e) {}
  }
  setTimeout(() => {
    active.slot.busy = false;
    active.slot.shapeId = null;
  }, active.type === "line" || active.type === "dotted" ? 100 : 1800);
  delete activeSounds[id];
}

function stopAllAudio() {
  for (const id in activeSounds) {
    const active = activeSounds[id];
    try {
      if (active.type !== "line" && active.type !== "dotted")
        active.slot.synth.triggerRelease();
    } catch (e) {}
    setTimeout(() => { active.slot.busy = false; active.slot.shapeId = null; }, 200);
  }
  activeSounds = {};
}

// ─── 스캔라인 오디오 업데이트 ────────────────────────────────────────────────
let prevLineHit = {};

function updateAudio(h, shapesToPlay) {
  const activeSet = new Set();
  for (const s of shapesToPlay) {
    const y = getIntersectionY(s, scanX);
    if (y === null) {
      if (activeSounds[s.id]) releaseShape(s.id);
      prevLineHit[s.id] = false;
      continue;
    }
    const freq = yToNote(y, h);
    activeSet.add(s.id);
    if (s.type === "line" || s.type === "dotted") {
      if (!prevLineHit[s.id]) {
        if (activeSounds[s.id]) releaseShape(s.id);
        triggerShape(s, freq);
        prevLineHit[s.id] = true;
      }
    } else {
      if (!activeSounds[s.id]) triggerShape(s, freq);
      else updateShapeFreq(s, freq);
    }
  }
  for (const id in activeSounds) {
    if (!activeSet.has(parseInt(id))) {
      releaseShape(parseInt(id));
      prevLineHit[parseInt(id)] = false;
    }
  }
}
