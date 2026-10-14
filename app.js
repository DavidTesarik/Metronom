/* Metronom + Tour Tempo — app.js
   Vše běží lokálně. Žádné síťové volání, žádná třetí strana. */
"use strict";

var APP_VERSION = "1.0";
var DB_KEY = "metronom:data";
var SCHEMA = 1;

var $ = function (id) { return document.getElementById(id); };

/* ============================ STAV A ÚLOŽIŠTĚ ============================ */

function defaults() {
  return {
    schema: SCHEMA,
    settings: {
      view: "music",
      theme: "auto",
      sound: "wood",
      volume: 0.8,
      vibrate: false,
      wake: true,
      log: true,
      music: {
        bpm: 100, beats: 4, sub: 1, swing: 0, accent: true,
        countIn: 0,
        trainerOn: false, trStep: 5, trBars: 4, trMax: 180,
        silentOn: false, silPlay: 2, silMute: 2
      },
      golf: { back: 24, ratio: 3, gap: 1.4, jitter: 0, prep: false, goal: 30 }
    },
    presets: { music: [], golf: [] },
    sessions: []
  };
}

function deepMerge(base, add) {
  if (!add || typeof add !== "object") return base;
  Object.keys(add).forEach(function (k) {
    var v = add[k];
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      deepMerge(base[k], v);
    } else if (v !== undefined && v !== null) {
      base[k] = v;
    }
  });
  return base;
}

var storageOk = true;

function loadState() {
  var s = defaults();
  try {
    var raw = localStorage.getItem(DB_KEY);
    if (!raw) return s;
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return s;
    // migrace podle schema (zatím jen jedna verze)
    if (typeof parsed.schema !== "number") parsed.schema = SCHEMA;
    deepMerge(s, parsed);
    if (!Array.isArray(s.sessions)) s.sessions = [];
    if (!s.presets || !Array.isArray(s.presets.music)) s.presets = { music: [], golf: [] };
    if (!Array.isArray(s.presets.golf)) s.presets.golf = [];
    s.schema = SCHEMA;
  } catch (e) {
    console.warn("Uložená data se nepodařilo načíst, používám výchozí.", e);
  }
  return s;
}

var S = loadState();
var saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(S));
      storageOk = true;
    } catch (e) {
      if (storageOk) { storageOk = false; toast("Nastavení se nepodařilo uložit."); }
      console.warn("Uložení selhalo:", e);
    }
  }, 180);
}

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(function () {});
}

var MS = S.settings.music;
var GS = S.settings.golf;

/* ================================= AUDIO ================================= */

var ctx = null, master = null, noiseBuf = null, ttWave = null;
var ttCurves = {};
var TT_DUR = 0.32;
var TT = { C4: 261.6, Eb4: 311.1, F4: 349.2 };

function ensureAudio() {
  if (!ctx) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { toast("Prohlížeč neumí Web Audio."); return false; }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return true;
}

function getNoise() {
  if (noiseBuf) return noiseBuf;
  var len = Math.floor(ctx.sampleRate * 0.3);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  var d = noiseBuf.getChannelData(0);
  for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/* obecný hlas pro klasické zvuky metronomu */
function voice(t, o) {
  var gain = o.gain;
  if (gain <= 0.0005) return;
  if (o.freq) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    g.connect(master);
    var osc = ctx.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.bend) osc.frequency.exponentialRampToValueAtTime(o.freq * o.bend, t + o.dur);
    osc.connect(g); osc.start(t); osc.stop(t + o.dur + 0.03);
    if (o.freq2) {
      var o2 = ctx.createOscillator();
      o2.type = o.type || "sine";
      o2.frequency.setValueAtTime(o.freq2, t);
      o2.connect(g); o2.start(t); o2.stop(t + o.dur + 0.03);
    }
  }
  if (o.click) {
    var n = ctx.createBufferSource(); n.buffer = getNoise();
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = o.clickFreq || 2000; bp.Q.value = o.q || 5;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * o.click, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + (o.clickDur || 0.03));
    n.connect(bp); bp.connect(ng); ng.connect(master);
    n.start(t); n.stop(t + 0.09);
  }
}

/* Tour Tempo tón: spektrum a obálka odvozené z měření originálních tónů */
function getTtWave() {
  if (ttWave) return ttWave;
  var amps = [0, 1, 0.35, 0.16, 0.07, 0.07, 0.06, 0.09, 0.02];
  var real = new Float32Array(amps.length), imag = new Float32Array(amps.length);
  for (var i = 0; i < amps.length; i++) imag[i] = amps[i];
  ttWave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  return ttWave;
}

function ttCurve(gain) {
  var key = gain.toFixed(3);
  if (ttCurves[key]) return ttCurves[key];
  var N = 160, a = new Float32Array(N);
  for (var i = 0; i < N; i++) {
    var t = i / (N - 1) * TT_DUR;
    var v = t < 0.003 ? t / 0.003 : Math.exp(-Math.pow(t / 0.135, 2.2));
    a[i] = v * gain;
  }
  a[N - 1] = 0;
  ttCurves[key] = a;
  return a;
}

function tourTone(t, f0, gain, dur) {
  if (gain <= 0.0005) return;
  var d = dur || TT_DUR;
  var g = ctx.createGain(); g.connect(master);
  g.gain.setValueCurveAtTime(ttCurve(gain), t, d);
  var o = ctx.createOscillator();
  o.setPeriodicWave(getTtWave());
  o.frequency.setValueAtTime(f0, t);
  o.connect(g); o.start(t); o.stop(t + d + 0.02);
}

var KITS = {
  wood: {
    accent: { freq: 1500, dur: 0.055, type: "triangle", click: 0.85, clickFreq: 2400, q: 4 },
    beat:   { freq: 1050, dur: 0.05,  type: "triangle", click: 0.6,  clickFreq: 1700, q: 4 },
    sub:    { freq: 1050, dur: 0.028, type: "triangle", click: 0.28, clickFreq: 1700, q: 4 }
  },
  beep: {
    accent: { freq: 1760, dur: 0.075, type: "sine" },
    beat:   { freq: 1175, dur: 0.06,  type: "sine" },
    sub:    { freq: 1175, dur: 0.035, type: "sine" }
  },
  tick: {
    accent: { dur: 0.03, click: 1.6, clickFreq: 6000, q: 2, clickDur: 0.035 },
    beat:   { dur: 0.03, click: 1.1, clickFreq: 4200, q: 2, clickDur: 0.03 },
    sub:    { dur: 0.02, click: 0.5, clickFreq: 4200, q: 2, clickDur: 0.02 }
  },
  cowbell: {
    accent: { freq: 835, freq2: 560, dur: 0.10,  type: "square", click: 0.2,  clickFreq: 3000 },
    beat:   { freq: 660, freq2: 445, dur: 0.08,  type: "square", click: 0.12, clickFreq: 3000 },
    sub:    { freq: 660, freq2: 445, dur: 0.035, type: "square" }
  },
  puls: {
    accent: { freq: 220, dur: 0.13, type: "sine", bend: 0.7,  click: 0.15, clickFreq: 900 },
    beat:   { freq: 165, dur: 0.11, type: "sine", bend: 0.75 },
    sub:    { freq: 165, dur: 0.05, type: "sine" }
  }
};
var LEVEL_GAIN = { accent: 1, beat: 0.62, sub: 0.3 };
var TT_LEVEL = {
  accent: { f: TT.F4,  g: 1,    d: TT_DUR },
  beat:   { f: TT.C4,  g: 0.8,  d: TT_DUR },
  sub:    { f: TT.Eb4, g: 0.34, d: 0.16 }
};

function playTick(level, t) {
  if (S.settings.sound === "tour") {
    var p = TT_LEVEL[level];
    tourTone(t, p.f, p.g * S.settings.volume, p.d);
    return;
  }
  var kit = KITS[S.settings.sound] || KITS.wood;
  var o = {}, src = kit[level];
  for (var k in src) o[k] = src[k];
  o.gain = LEVEL_GAIN[level] * S.settings.volume;
  voice(t, o);
}

var GOLF_TONES = {
  address: { f: TT.C4,  g: 0.78 },
  top:     { f: TT.Eb4, g: 0.95 },
  impact:  { f: TT.F4,  g: 1 },
  prep:    { f: TT.C4,  g: 0.22, d: 0.14 }
};

function playGolfTone(name, t) {
  if (t <= ctx.currentTime) return;
  var p = GOLF_TONES[name];
  tourTone(t, p.f, p.g * S.settings.volume, p.d);
}

/* =============================== PLÁNOVAČ =============================== */

var LOOKAHEAD = 0.14, TIMER_MS = 25;
var running = false, runMode = null, timer = null;
var nextTime = 0, pos = { bar: 0, beat: 0, sub: 0 }, visQ = [];
var nextRep = 0, sessionReps = 0, sessionStart = 0, bpmMin = 0, bpmMax = 0;

function effBar() { return pos.bar - MS.countIn; }

function isMutedBar() {
  var e = effBar();
  if (e < 0 || !MS.silentOn) return false;
  var cycle = MS.silPlay + MS.silMute;
  return (e % cycle) >= MS.silPlay;
}

function scheduleMusic() {
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    var beatDur = 60 / MS.bpm;
    var n = MS.sub;
    var swingOn = (n === 2 && MS.swing > 0);
    var f = 0.5 + (MS.swing / 100) * (2 / 3 - 0.5);

    var subPhase = swingOn ? (pos.sub === 0 ? 0 : f) : pos.sub / n;
    var dur = swingOn ? beatDur * (pos.sub === 0 ? f : 1 - f) : beatDur / n;
    var level = pos.sub !== 0 ? "sub" : (pos.beat === 0 && MS.accent ? "accent" : "beat");
    var muted = isMutedBar();

    if (!muted) playTick(level, nextTime);

    visQ.push({
      t: nextTime,
      phase: (pos.beat + subPhase) / MS.beats,
      beat: pos.beat,
      level: level,
      hit: pos.sub === 0 && !muted
    });

    nextTime += dur;
    pos.sub++;
    if (pos.sub >= n) { pos.sub = 0; pos.beat++; }
    if (pos.beat >= MS.beats) {
      pos.beat = 0; pos.bar++;
      if (MS.trainerOn && effBar() > 0 && effBar() % MS.trBars === 0 && MS.bpm < MS.trMax) {
        setBpm(Math.min(MS.trMax, MS.bpm + MS.trStep));
      }
    }
  }
}

function golfTimes() {
  var back = GS.back / 30;
  return { back: back, down: back / GS.ratio };
}

function scheduleGolf() {
  while (nextRep < ctx.currentTime + LOOKAHEAD) {
    var tm = golfTimes();
    var t0 = nextRep;
    if (GS.prep && GS.gap >= 1.4) {
      playGolfTone("prep", t0 - 1.0);
      playGolfTone("prep", t0 - 0.5);
    }
    playGolfTone("address", t0);
    playGolfTone("top", t0 + tm.back);
    playGolfTone("impact", t0 + tm.back + tm.down);
    visQ.push({ golf: true, t: t0, back: tm.back, down: tm.down, counted: false });
    var jitter = GS.jitter > 0 ? (Math.random() * 2 - 1) * GS.jitter : 0;
    nextRep = t0 + tm.back + tm.down + Math.max(0.4, GS.gap + jitter);
  }
}

function tickLoop() {
  if (!running) return;
  if (runMode === "music") scheduleMusic(); else scheduleGolf();
  if (visQ.length > 64) visQ.splice(0, visQ.length - 48);
}

/* wake lock */
var wakeSentinel = null;
function requestWake() {
  if (!S.settings.wake || !navigator.wakeLock) return;
  navigator.wakeLock.request("screen").then(function (s) { wakeSentinel = s; }).catch(function () {});
}
function releaseWake() {
  if (wakeSentinel) { try { wakeSentinel.release(); } catch (e) {} wakeSentinel = null; }
}

function start(mode) {
  if (!ensureAudio()) return;
  running = true; runMode = mode; visQ = []; lastVis = null;
  sessionReps = 0; sessionStart = Date.now();
  bpmMin = MS.bpm; bpmMax = MS.bpm;
  var lead = 0.25;
  if (mode === "music") {
    pos = { bar: 0, beat: 0, sub: 0 };
    nextTime = ctx.currentTime + lead;
    $("mPlay").textContent = "Zastavit";
    $("mPlay").classList.add("on");
    $("mLive").textContent = "Metronom běží, " + MS.bpm + " úderů za minutu.";
  } else {
    nextRep = ctx.currentTime + lead + (GS.prep && GS.gap >= 1.4 ? 1.2 : 0);
    $("gReps").textContent = "0";
    $("gPlay").textContent = "Zastavit";
    $("gPlay").classList.add("on");
    $("gLive").textContent = "Tóny běží, tempo " + golfLabel() + ".";
  }
  timer = setInterval(tickLoop, TIMER_MS);
  tickLoop();
  requestWake();
}

function stop() {
  if (!running) return;
  var mode = runMode;
  running = false; runMode = null;
  clearInterval(timer); timer = null;
  visQ = []; lastVis = null;
  releaseWake();

  $("mPlay").textContent = "Spustit"; $("mPlay").classList.remove("on");
  $("gPlay").textContent = "Spustit"; $("gPlay").classList.remove("on");
  $("mRing").setAttribute("d", ""); $("gRing").setAttribute("d", "");
  setHand("mHand", 0); setHand("gHand", 180);
  Array.prototype.forEach.call(document.querySelectorAll(".dot"), function (d) { d.classList.remove("on"); });
  Array.prototype.forEach.call(document.querySelectorAll(".gdot"), function (d) { d.classList.remove("on"); });
  $("mLive").textContent = "Metronom zastaven.";
  $("gLive").textContent = "Tóny zastaveny.";

  logSession(mode);
}

function toggle(mode) {
  if (running && runMode === mode) stop();
  else { if (running) stop(); start(mode); }
}

/* =============================== VIZUÁL =============================== */

function polar(r, a) {
  var rad = a * Math.PI / 180;
  return [100 + r * Math.sin(rad), 100 - r * Math.cos(rad)];
}
function arcPath(r, a0, a1) {
  if (Math.abs(a1 - a0) < 0.3) return "";
  var p0 = polar(r, a0), p1 = polar(r, a1), d = a1 - a0;
  return "M" + p0[0].toFixed(2) + " " + p0[1].toFixed(2) +
         " A" + r + " " + r + " 0 " + (Math.abs(d) > 180 ? 1 : 0) + " " + (d >= 0 ? 1 : 0) +
         " " + p1[0].toFixed(2) + " " + p1[1].toFixed(2);
}
function setHand(id, angle) {
  $(id).setAttribute("transform", "rotate(" + angle.toFixed(2) + " 100 100)");
}
function buildTicks(id, angles, firstHighlight) {
  var g = $(id);
  g.innerHTML = "";
  angles.forEach(function (a, i) {
    var p1 = polar(78, a), p2 = polar(firstHighlight && i === 0 ? 66 : 70, a);
    var l = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l.setAttribute("x1", p1[0].toFixed(2)); l.setAttribute("y1", p1[1].toFixed(2));
    l.setAttribute("x2", p2[0].toFixed(2)); l.setAttribute("y2", p2[1].toFixed(2));
    l.setAttribute("class", "tickline" + (firstHighlight && i === 0 ? " on" : ""));
    g.appendChild(l);
  });
}
function buildMusicDial() {
  var a = [];
  for (var i = 0; i < MS.beats; i++) a.push(i * 360 / MS.beats);
  buildTicks("mTicks", a, true);
  var d = $("mDots");
  d.innerHTML = "";
  for (var j = 0; j < MS.beats; j++) {
    var s = document.createElement("span");
    s.className = "dot" + (j === 0 ? " first" : "");
    d.appendChild(s);
  }
}
buildTicks("gTicks", [180, -10], false);

function flash(id) {
  var p = $(id);
  p.classList.remove("hit");
  void p.offsetWidth;
  p.classList.add("hit");
}

var lastVis = null;
function frame() {
  requestAnimationFrame(frame);
  if (!running || !ctx) return;
  var now = ctx.currentTime;
  while (visQ.length > 1 && visQ[1].t <= now) visQ.shift();
  var ev = visQ[0];
  if (!ev) return;

  if (ev !== lastVis && ev.t <= now) {
    lastVis = ev;
    if (!ev.golf) {
      var dots = document.querySelectorAll("#mDots .dot");
      for (var i = 0; i < dots.length; i++) dots[i].classList.toggle("on", i === ev.beat);
      if (ev.hit) {
        if (ev.level !== "sub") flash("mPulse");
        if (S.settings.vibrate && navigator.vibrate) navigator.vibrate(ev.level === "accent" ? 26 : 14);
      }
    }
  }

  if (ev.golf) {
    var ang = 180, stage = -1;
    if (now >= ev.t && now < ev.t + ev.back) {
      stage = 0; ang = 180 - 190 * ((now - ev.t) / ev.back);
    } else if (now >= ev.t + ev.back && now < ev.t + ev.back + ev.down) {
      stage = 1; ang = -10 + 190 * ((now - ev.t - ev.back) / ev.down);
    } else if (now >= ev.t + ev.back + ev.down) {
      stage = 2;
    }
    setHand("gHand", ang);
    $("gRing").setAttribute("d", stage < 0 ? "" : arcPath(86, 180, ang));
    var gd = document.querySelectorAll("#gDots .gdot");
    var on = [
      stage === 0 && now - ev.t < 0.18,
      stage === 1 && now - (ev.t + ev.back) < 0.18,
      stage === 2 && now - (ev.t + ev.back + ev.down) < 0.18
    ];
    for (var k = 0; k < gd.length; k++) gd[k].classList.toggle("on", !!on[k]);
    if (stage === 2 && !ev.counted) {
      ev.counted = true;
      sessionReps++;
      $("gReps").textContent = sessionReps;
      updateGoalHint();
      flash("gPulse");
      if (S.settings.vibrate && navigator.vibrate) navigator.vibrate(20);
    }
  } else {
    var barDur = (60 / MS.bpm) * MS.beats;
    var p = Math.min(1, ev.phase + Math.max(0, now - ev.t) / barDur);
    setHand("mHand", Math.min(359.5, p * 360));
    $("mRing").setAttribute("d", arcPath(86, 0, Math.min(359.5, p * 360)));
  }
}
requestAnimationFrame(frame);

/* ============================== POPISKY ============================== */

var TEMPI = [[40, "Largo"], [60, "Larghetto"], [66, "Adagio"], [76, "Andante"],
             [108, "Moderato"], [120, "Allegro"], [168, "Vivace"], [200, "Presto"], [1000, "Prestissimo"]];
function tempoName(b) {
  for (var i = 0; i < TEMPI.length; i++) if (b < TEMPI[i][0]) return TEMPI[i][1];
  return "";
}
function fmt(n, d) { return n.toFixed(d).replace(".", ","); }

var RATIO_LABEL = { 3: "3:1", 2.5: "2,5:1", 2: "2:1", 1.733: "1,73:1" };
function downFrames() { return Math.round(GS.back / GS.ratio); }
function golfLabel() { return GS.back + "/" + downFrames(); }

function refreshMusic() {
  $("mBig").textContent = MS.bpm;
  var bits = [MS.beats + "/4"];
  if (MS.sub > 1) bits.push(["", "", "osminy", "triola", "šestnáctiny"][MS.sub]);
  if (MS.trainerOn) bits.push("→ " + MS.trMax);
  $("mNote").textContent = bits.join(" · ");
  $("tempoName").textContent = tempoName(MS.bpm);
}

function refreshGolf() {
  var tm = golfTimes();
  $("gBig").textContent = golfLabel();
  $("gLabel").textContent = "snímků · " + (RATIO_LABEL[GS.ratio] || "vlastní");
  $("gNote").textContent = fmt(tm.back, 2) + " s + " + fmt(tm.down, 2) + " s = " + fmt(tm.back + tm.down, 2) + " s";
  var bar = $("gRatiobar").children;
  bar[0].style.flex = String(GS.ratio);
  bar[1].style.flex = "1";
  updateGoalHint();
}

function updateGoalHint() {
  var h = $("gGoalHint");
  if (!GS.goal) { h.textContent = "Bez cíle"; return; }
  if (sessionReps >= GS.goal) h.textContent = "Cíl " + GS.goal + " švihů splněný";
  else h.textContent = "Cíl " + GS.goal + " švihů · zbývá " + (GS.goal - sessionReps);
}

function setBpm(v) {
  MS.bpm = Math.max(30, Math.min(260, Math.round(v)));
  $("bpmRange").value = MS.bpm;
  if (running && runMode === "music") {
    if (MS.bpm < bpmMin) bpmMin = MS.bpm;
    if (MS.bpm > bpmMax) bpmMax = MS.bpm;
  }
  refreshMusic(); save();
}

function setBack(v) {
  GS.back = Math.max(12, Math.min(36, Math.round(v)));
  $("gBack").value = GS.back;
  $("gBackVal").textContent = GS.back;
  refreshGolf(); renderGolfPresets(); save();
}

/* ============================== NAVIGACE ============================== */

var VIEWS = ["music", "golf", "stats", "settings"];
var TITLES = { music: "Metronom", golf: "Golfový švih", stats: "Statistiky", settings: "Nastavení" };

function setView(v) {
  S.settings.view = v;
  VIEWS.forEach(function (name) {
    $("view-" + name).hidden = name !== v;
    $("tab-" + name).setAttribute("aria-selected", String(name === v));
  });
  $("viewTitle").textContent = TITLES[v];
  $("topNote").textContent = (running && runMode === "music") ? "Metronom běží"
                          : (running && runMode === "golf") ? "Tóny běží" : "";
  if (v === "stats") renderStats();
  window.scrollTo(0, 0);
  save();
}
VIEWS.forEach(function (v) { $("tab-" + v).addEventListener("click", function () { setView(v); }); });

/* ============================== TOAST ============================== */

var toastEl = null, toastTimer = null;
function toast(msg, undoLabel, undoFn) {
  if (toastEl) toastEl.remove();
  clearTimeout(toastTimer);
  toastEl = document.createElement("div");
  toastEl.className = "toast";
  toastEl.setAttribute("role", "status");
  var span = document.createElement("span");
  span.textContent = msg;
  toastEl.appendChild(span);
  if (undoFn) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = undoLabel || "Zpět";
    b.addEventListener("click", function () { undoFn(); hideToast(); });
    toastEl.appendChild(b);
  }
  document.body.appendChild(toastEl);
  toastTimer = setTimeout(hideToast, undoFn ? 6000 : 3200);
}
function hideToast() {
  clearTimeout(toastTimer);
  if (toastEl) { toastEl.remove(); toastEl = null; }
}

/* ============================ METRONOM — UI ============================ */

function holdable(el, fn) {
  var t1 = null, t2 = null;
  el.addEventListener("pointerdown", function (e) {
    e.preventDefault(); fn();
    t1 = setTimeout(function () { t2 = setInterval(fn, 70); }, 420);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
    el.addEventListener(ev, function () { clearTimeout(t1); clearInterval(t2); });
  });
}

$("mPlay").addEventListener("click", function () { toggle("music"); });
holdable($("mMinus"), function () { setBpm(MS.bpm - 1); });
holdable($("mPlus"), function () { setBpm(MS.bpm + 1); });
$("bpmRange").addEventListener("input", function (e) { setBpm(+e.target.value); });

var taps = [], tapReset = null;
$("tapBtn").addEventListener("click", function () {
  var now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2400) taps = [];
  taps.push(now);
  if (taps.length > 5) taps.shift();
  if (taps.length >= 2) {
    var sum = 0;
    for (var i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
    setBpm(60000 / (sum / (taps.length - 1)));
    $("tapBtn").textContent = MS.bpm + " úderů — ťukej dál";
  } else {
    $("tapBtn").textContent = "Ťukej dál…";
  }
  clearTimeout(tapReset);
  tapReset = setTimeout(function () { $("tapBtn").textContent = "Ťukni tempo"; taps = []; }, 2600);
});

var beatsSel = $("beats");
for (var bi = 1; bi <= 12; bi++) {
  var o = document.createElement("option");
  o.value = bi;
  o.textContent = bi + (bi === 1 ? " doba" : bi < 5 ? " doby" : " dob");
  beatsSel.appendChild(o);
}
beatsSel.addEventListener("change", function (e) {
  MS.beats = +e.target.value; buildMusicDial(); refreshMusic(); save();
});

$("subSeg").addEventListener("click", function (e) {
  var b = e.target.closest("button"); if (!b) return;
  MS.sub = +b.dataset.sub;
  Array.prototype.forEach.call($("subSeg").children, function (x) {
    x.setAttribute("aria-pressed", String(x === b));
  });
  refreshMusic(); save();
});

function bindRange(id, valId, apply, fmtFn) {
  $(id).addEventListener("input", function (e) {
    var v = +e.target.value;
    apply(v);
    if (valId) $(valId).textContent = fmtFn ? fmtFn(v) : String(v);
    updateHints(); refreshMusic(); refreshGolf(); save();
  });
}
bindRange("swing", "swingVal", function (v) { MS.swing = v; }, function (v) { return v + " %"; });
bindRange("trStep", "trStepVal", function (v) { MS.trStep = v; }, function (v) { return "+" + v; });
bindRange("trBars", "trBarsVal", function (v) { MS.trBars = v; });
bindRange("trMax", "trMaxVal", function (v) { MS.trMax = v; });
bindRange("silPlay", "silPlayVal", function (v) { MS.silPlay = v; });
bindRange("silMute", "silMuteVal", function (v) { MS.silMute = v; });
bindRange("countIn", "countInVal", function (v) { MS.countIn = v; });
bindRange("vol", "volVal", function (v) { S.settings.volume = v / 100; }, function (v) { return v + " %"; });
bindRange("gBack", "gBackVal", function (v) { GS.back = v; renderGolfPresets(); });
bindRange("gGap", "gGapVal", function (v) { GS.gap = v / 10; }, function (v) { return fmt(v / 10, 1) + " s"; });
bindRange("gJitter", "gJitterVal", function (v) { GS.jitter = v / 10; },
          function (v) { return v === 0 ? "vypnuto" : "± " + fmt(v / 10, 1) + " s"; });
bindRange("gGoal", "gGoalVal", function (v) { GS.goal = v; },
          function (v) { return v === 0 ? "bez cíle" : String(v); });

function bindSwitch(id, apply) {
  $(id).addEventListener("click", function () {
    var el = $(id);
    var next = el.getAttribute("aria-pressed") !== "true";
    el.setAttribute("aria-pressed", String(next));
    apply(next); updateHints(); refreshMusic(); refreshGolf(); save();
  });
}
bindSwitch("accent", function (v) { MS.accent = v; });
bindSwitch("trainerOn", function (v) { MS.trainerOn = v; });
bindSwitch("silentOn", function (v) { MS.silentOn = v; });
bindSwitch("gPrep", function (v) { GS.prep = v; });
bindSwitch("vibrate", function (v) { S.settings.vibrate = v; });
bindSwitch("wake", function (v) { S.settings.wake = v; if (!v) releaseWake(); else if (running) requestWake(); });
bindSwitch("logOn", function (v) { S.settings.log = v; });

function updateHints() {
  $("trHint").textContent = "+" + MS.trStep + " úderů každé " + MS.trBars +
    (MS.trBars < 5 ? " takty" : " taktů") + ", strop " + MS.trMax;
  $("silHint").textContent = "Zní " + MS.silPlay + (MS.silPlay < 5 ? " takty" : " taktů") +
    ", pak " + MS.silMute + (MS.silMute < 5 ? " takty" : " taktů") + " ticho";
}

$("sound").addEventListener("change", function (e) {
  S.settings.sound = e.target.value;
  save();
  if (ensureAudio()) playTick("beat", ctx.currentTime + 0.03);
});

/* ============================== GOLF — UI ============================== */

$("gPlay").addEventListener("click", function () { toggle("golf"); });
holdable($("gMinus"), function () { setBack(GS.back - 1); });
holdable($("gPlus"), function () { setBack(GS.back + 1); });
$("gRatio").addEventListener("change", function (e) {
  GS.ratio = +e.target.value; refreshGolf(); renderGolfPresets(); save();
});

var GOLF_PRESETS = [
  { group: "Plná hra — poměr 3:1" },
  { b: 18, r: 3, name: "18/6",  note: "explozivní" },
  { b: 21, r: 3, name: "21/7",  note: "velmi rychlé" },
  { b: 24, r: 3, name: "24/8",  note: "rychlé" },
  { b: 27, r: 3, name: "27/9",  note: "svižné" },
  { b: 30, r: 3, name: "30/10", note: "pomalejší" },
  { b: 33, r: 3, name: "33/11", note: "hranice" },
  { group: "Krátká hra a putt — poměr 2:1" },
  { b: 14, r: 2, name: "14/7" },
  { b: 16, r: 2, name: "16/8" },
  { b: 18, r: 2, name: "18/9" },
  { b: 20, r: 2, name: "20/10" },
  { b: 22, r: 2, name: "22/11" },
  { group: "Jako ve zpomalených videích" },
  { b: 24, r: 1.733, name: "24/14", note: "poměr 1,73:1" }
];

function renderGolfPresets() {
  var box = $("golfPresets");
  box.innerHTML = "";
  GOLF_PRESETS.forEach(function (p) {
    if (p.group) {
      var h = document.createElement("span");
      h.className = "grouplbl";
      h.textContent = p.group;
      box.appendChild(h);
      return;
    }
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("aria-pressed", String(GS.back === p.b && GS.ratio === p.r));
    b.appendChild(document.createTextNode(p.name));
    if (p.note) {
      var s = document.createElement("span");
      s.className = "sub"; s.textContent = p.note;
      b.appendChild(s);
    }
    b.addEventListener("click", function () {
      GS.back = p.b; GS.ratio = p.r;
      $("gBack").value = p.b; $("gBackVal").textContent = p.b;
      $("gRatio").value = String(p.r);
      refreshGolf(); renderGolfPresets(); save();
    });
    box.appendChild(b);
  });
}

/* ============================= PŘEDVOLBY ============================= */

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function renderPresetList(boxId, kind) {
  var box = $(boxId);
  box.innerHTML = "";
  var list = S.presets[kind];
  if (!list.length) {
    var e = document.createElement("span");
    e.className = "hint";
    e.textContent = "Zatím žádná vlastní předvolba.";
    box.appendChild(e);
    return;
  }
  list.forEach(function (p, idx) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "chip";
    b.appendChild(document.createTextNode(p.name));
    b.addEventListener("click", function () { applyPreset(kind, p); });
    var x = document.createElement("span");
    x.className = "x"; x.textContent = "×";
    x.setAttribute("role", "button");
    x.setAttribute("tabindex", "0");
    x.setAttribute("aria-label", "Smazat předvolbu " + p.name);
    var del = function (ev) {
      ev.stopPropagation();
      var removed = S.presets[kind].splice(idx, 1)[0];
      save(); renderPresetList(boxId, kind);
      toast("Předvolba smazána", "Zpět", function () {
        S.presets[kind].splice(idx, 0, removed);
        save(); renderPresetList(boxId, kind);
      });
    };
    x.addEventListener("click", del);
    x.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); del(ev); }
    });
    b.appendChild(x);
    box.appendChild(b);
  });
}

function applyPreset(kind, p) {
  if (kind === "music") {
    MS.bpm = p.d.bpm; MS.beats = p.d.beats; MS.sub = p.d.sub; MS.swing = p.d.swing;
    $("bpmRange").value = MS.bpm;
    beatsSel.value = MS.beats;
    $("swing").value = MS.swing; $("swingVal").textContent = MS.swing + " %";
    Array.prototype.forEach.call($("subSeg").children, function (x) {
      x.setAttribute("aria-pressed", String(+x.dataset.sub === MS.sub));
    });
    buildMusicDial(); refreshMusic();
  } else {
    GS.back = p.d.back; GS.ratio = p.d.ratio; GS.gap = p.d.gap; GS.jitter = p.d.jitter || 0;
    $("gBack").value = GS.back; $("gBackVal").textContent = GS.back;
    $("gRatio").value = String(GS.ratio);
    $("gGap").value = Math.round(GS.gap * 10); $("gGapVal").textContent = fmt(GS.gap, 1) + " s";
    $("gJitter").value = Math.round(GS.jitter * 10);
    $("gJitterVal").textContent = GS.jitter === 0 ? "vypnuto" : "± " + fmt(GS.jitter, 1) + " s";
    refreshGolf(); renderGolfPresets();
  }
  save();
  toast("Předvolba " + p.name + " načtena");
}

$("mPresetSave").addEventListener("click", function () {
  var name = ($("mPresetName").value || "").trim() || (MS.bpm + " · " + MS.beats + "/4");
  S.presets.music.push({ id: uid(), name: name.slice(0, 40),
    d: { bpm: MS.bpm, beats: MS.beats, sub: MS.sub, swing: MS.swing } });
  $("mPresetName").value = "";
  save(); renderPresetList("musicPresets", "music");
  toast("Uloženo jako " + name);
});

$("gPresetSave").addEventListener("click", function () {
  var name = ($("gPresetName").value || "").trim() || golfLabel();
  S.presets.golf.push({ id: uid(), name: name.slice(0, 40),
    d: { back: GS.back, ratio: GS.ratio, gap: GS.gap, jitter: GS.jitter } });
  $("gPresetName").value = "";
  save(); renderPresetList("golfUserPresets", "golf");
  toast("Uloženo jako " + name);
});

/* ============================== SEZENÍ ============================== */

function logSession(mode) {
  if (!S.settings.log || !sessionStart) return;
  var dur = Math.round((Date.now() - sessionStart) / 1000);
  sessionStart = 0;
  if (mode === "golf") {
    if (sessionReps < 3) return;
    S.sessions.push({ id: uid(), t: Date.now(), mode: "golf", dur: dur,
      reps: sessionReps, tempo: golfLabel() });
  } else {
    if (dur < 20) return;
    S.sessions.push({ id: uid(), t: Date.now(), mode: "music", dur: dur,
      reps: 0, tempo: (bpmMin === bpmMax ? String(bpmMin) : bpmMin + "–" + bpmMax) });
  }
  if (S.sessions.length > 2000) S.sessions.splice(0, S.sessions.length - 2000);
  save();
  toast(mode === "golf"
    ? "Zapsáno: " + sessionReps + " švihů"
    : "Zapsáno: " + Math.round(dur / 60) + " min cvičení");
}

/* ============================= STATISTIKY ============================= */

var statsDays = 7;
$("periodSeg").addEventListener("click", function (e) {
  var b = e.target.closest("button"); if (!b) return;
  statsDays = +b.dataset.days;
  Array.prototype.forEach.call($("periodSeg").children, function (x) {
    x.setAttribute("aria-pressed", String(x === b));
  });
  renderStats();
});
$("statsGo").addEventListener("click", function () { setView("golf"); });

function dayKey(ts) {
  var d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function startOfToday() {
  var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}

function renderStats() {
  var all = S.sessions;
  if (!all.length) { $("statsEmpty").hidden = false; $("statsBody").hidden = true; return; }
  $("statsEmpty").hidden = true; $("statsBody").hidden = false;

  var from = statsDays ? startOfToday() - (statsDays - 1) * 86400000 : 0;
  var inRange = all.filter(function (s) { return s.t >= from; });

  var reps = 0, secs = 0;
  inRange.forEach(function (s) { reps += (s.reps || 0); secs += (s.dur || 0); });
  $("kReps").textContent = reps;
  $("kMin").textContent = Math.round(secs / 60);

  // série dní
  var daySet = {};
  all.forEach(function (s) { daySet[dayKey(s.t)] = true; });
  var streak = 0, cursor = startOfToday();
  if (!daySet[dayKey(cursor)]) cursor -= 86400000;
  while (daySet[dayKey(cursor)]) { streak++; cursor -= 86400000; }
  $("kStreak").textContent = streak;
  $("kStreakLbl").textContent = streak === 1 ? "den v řadě" : (streak >= 2 && streak <= 4 ? "dny v řadě" : "dní v řadě");

  drawChart(statsDays ? Math.min(statsDays, 30) : 30);
  drawTempoBreakdown(inRange);
  drawSessionList();
}

function drawChart(days) {
  var svg = $("chart");
  svg.innerHTML = "";
  var W = 320, H = 120, padB = 14, padT = 6;
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("preserveAspectRatio", "none");

  var buckets = [];
  for (var i = days - 1; i >= 0; i--) {
    var t = startOfToday() - i * 86400000;
    buckets.push({ t: t, key: dayKey(t), reps: 0, secs: 0 });
  }
  var map = {};
  buckets.forEach(function (b) { map[b.key] = b; });
  S.sessions.forEach(function (s) {
    var b = map[dayKey(s.t)];
    if (b) { b.reps += (s.reps || 0); b.secs += (s.dur || 0); }
  });

  var maxR = 1, maxM = 1;
  buckets.forEach(function (b) {
    if (b.reps > maxR) maxR = b.reps;
    if (b.secs / 60 > maxM) maxM = b.secs / 60;
  });

  var slot = W / buckets.length;
  var bw = Math.max(2, Math.min(14, slot / 2 - 1.5));
  var usable = H - padB - padT;

  buckets.forEach(function (b, i) {
    var x = i * slot + slot / 2;
    var hr = (b.reps / maxR) * usable;
    var hm = ((b.secs / 60) / maxM) * usable;
    if (b.reps > 0) addBar(svg, x - bw - 1, H - padB - hr, bw, hr, "bar");
    if (b.secs > 0) addBar(svg, x + 1, H - padB - hm, bw, hm, "bar music");
  });

  // popisky: první, prostřední, poslední den
  [0, Math.floor(buckets.length / 2), buckets.length - 1].forEach(function (i, n) {
    var b = buckets[i];
    if (!b) return;
    var d = new Date(b.t);
    var tx = document.createElementNS("http://www.w3.org/2000/svg", "text");
    tx.setAttribute("class", "axis");
    tx.setAttribute("y", H - 3);
    tx.setAttribute("x", n === 0 ? 2 : (n === 2 ? W - 2 : W / 2));
    tx.setAttribute("text-anchor", n === 0 ? "start" : (n === 2 ? "end" : "middle"));
    tx.textContent = d.getDate() + "." + (d.getMonth() + 1) + ".";
    svg.appendChild(tx);
  });

  var totR = 0, totM = 0;
  buckets.forEach(function (b) { totR += b.reps; totM += b.secs / 60; });
  $("chartDesc").textContent = "Sloupcový graf za posledních " + buckets.length + " dní: celkem " +
    totR + " švihů a " + Math.round(totM) + " minut cvičení. Nejvíc švihů za den: " + maxR + ".";
}

function addBar(svg, x, y, w, h, cls) {
  var r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  r.setAttribute("class", cls);
  r.setAttribute("x", x.toFixed(1));
  r.setAttribute("y", y.toFixed(1));
  r.setAttribute("width", w.toFixed(1));
  r.setAttribute("height", Math.max(1.5, h).toFixed(1));
  r.setAttribute("rx", "1.5");
  svg.appendChild(r);
}

function drawTempoBreakdown(list) {
  var box = $("tempoList");
  box.innerHTML = "";
  var counts = {};
  list.forEach(function (s) {
    if (s.mode !== "golf") return;
    counts[s.tempo] = (counts[s.tempo] || 0) + (s.reps || 0);
  });
  var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 5);
  if (!keys.length) {
    $("tempoBreakdown").hidden = true;
    return;
  }
  $("tempoBreakdown").hidden = false;
  var max = counts[keys[0]];
  keys.forEach(function (k) {
    var row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = "8px";
    var l = document.createElement("span");
    l.className = "lbl"; l.style.flex = "0 0 62px"; l.textContent = k;
    var track = document.createElement("span");
    track.style.cssText = "flex:1;height:8px;border-radius:99px;background:var(--surface2);overflow:hidden";
    var fill = document.createElement("span");
    fill.style.cssText = "display:block;height:100%;background:var(--accent);width:" +
      Math.round(counts[k] / max * 100) + "%";
    track.appendChild(fill);
    var v = document.createElement("span");
    v.className = "val"; v.textContent = counts[k];
    row.appendChild(l); row.appendChild(track); row.appendChild(v);
    box.appendChild(row);
  });
}

function drawSessionList() {
  var ul = $("sessionList");
  ul.innerHTML = "";
  var list = S.sessions.slice().sort(function (a, b) { return b.t - a.t; }).slice(0, 12);
  list.forEach(function (s) {
    var li = document.createElement("li");
    var left = document.createElement("div");
    var d = new Date(s.t);
    var title = document.createElement("div");
    title.textContent = s.mode === "golf"
      ? s.reps + " švihů · " + s.tempo
      : Math.max(1, Math.round(s.dur / 60)) + " min · " + s.tempo + " úderů";
    var meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = (s.mode === "golf" ? "Golf" : "Hudba") + " · " +
      d.getDate() + "." + (d.getMonth() + 1) + ". " +
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    left.appendChild(title); left.appendChild(meta);
    var del = document.createElement("button");
    del.type = "button"; del.className = "btn";
    del.style.cssText = "min-height:36px;padding:6px 10px";
    del.textContent = "Smazat";
    del.setAttribute("aria-label", "Smazat sezení z " + d.getDate() + "." + (d.getMonth() + 1) + ".");
    del.addEventListener("click", function () {
      var i = S.sessions.findIndex(function (x) { return x.id === s.id; });
      if (i < 0) return;
      var removed = S.sessions.splice(i, 1)[0];
      save(); renderStats();
      toast("Sezení smazáno", "Zpět", function () {
        S.sessions.splice(i, 0, removed); save(); renderStats();
      });
    });
    li.appendChild(left); li.appendChild(del);
    ul.appendChild(li);
  });
}

/* ============================== NASTAVENÍ ============================== */

function applyTheme(t) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  Array.prototype.forEach.call($("themeSeg").children, function (x) {
    x.setAttribute("aria-pressed", String(x.dataset.theme === t));
  });
}
$("themeSeg").addEventListener("click", function (e) {
  var b = e.target.closest("button"); if (!b) return;
  S.settings.theme = b.dataset.theme;
  applyTheme(S.settings.theme); save();
});

$("btnExport").addEventListener("click", function () {
  var payload = JSON.stringify(S, null, 2);
  var stamp = new Date().toISOString().slice(0, 10);
  var fname = "metronom-zaloha-" + stamp + ".json";
  var blob = new Blob([payload], { type: "application/json" });
  var file = null;
  try { file = new File([blob], fname, { type: "application/json" }); } catch (e) {}
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: "Záloha metronomu" }).catch(function () {});
    return;
  }
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  toast("Záloha stažena");
});

$("btnImport").addEventListener("click", function () { $("fileImport").click(); });
$("fileImport").addEventListener("change", function (e) {
  var f = e.target.files && e.target.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function () {
    try {
      var data = JSON.parse(String(r.result));
      if (!data || typeof data !== "object" || !data.settings) throw new Error("bad");
      var before = JSON.parse(JSON.stringify(S));
      var fresh = defaults();
      deepMerge(fresh, data);
      if (!Array.isArray(fresh.sessions)) fresh.sessions = [];
      S = fresh; MS = S.settings.music; GS = S.settings.golf;
      S.schema = SCHEMA;
      save(); syncUI();
      toast("Záloha načtena", "Zpět", function () {
        S = before; MS = S.settings.music; GS = S.settings.golf;
        save(); syncUI(); toast("Obnoveno");
      });
    } catch (err) {
      toast("Soubor se nepodařilo načíst.");
    }
    e.target.value = "";
  };
  r.onerror = function () { toast("Soubor se nepodařilo přečíst."); e.target.value = ""; };
  r.readAsText(f);
});

var confirmDlg = $("confirmDlg");
$("btnWipe").addEventListener("click", function () {
  if (confirmDlg.showModal) confirmDlg.showModal();
  else if (window.confirm("Smazat všechna data?")) wipe();
});
$("confirmNo").addEventListener("click", function () { confirmDlg.close(); });
$("confirmYes").addEventListener("click", function () { confirmDlg.close(); wipe(); });

function wipe() {
  if (running) stop();
  try { localStorage.removeItem(DB_KEY); } catch (e) {}
  S = defaults(); MS = S.settings.music; GS = S.settings.golf;
  save(); syncUI(); setView("music");
  toast("Všechna data smazána");
}

/* ============================== KLÁVESNICE ============================== */

document.addEventListener("keydown", function (e) {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (confirmDlg.open) return;
  var v = S.settings.view;
  if (e.code === "Space") {
    if (v === "music" || v === "golf") { e.preventDefault(); toggle(v); }
  } else if (v === "music" && e.key === "ArrowUp") { e.preventDefault(); setBpm(MS.bpm + 1); }
  else if (v === "music" && e.key === "ArrowDown") { e.preventDefault(); setBpm(MS.bpm - 1); }
  else if (v === "music" && e.key === "ArrowRight") { e.preventDefault(); setBpm(MS.bpm + 5); }
  else if (v === "music" && e.key === "ArrowLeft") { e.preventDefault(); setBpm(MS.bpm - 5); }
  else if (v === "golf" && e.key === "ArrowUp") { e.preventDefault(); setBack(GS.back + 1); }
  else if (v === "golf" && e.key === "ArrowDown") { e.preventDefault(); setBack(GS.back - 1); }
  else if (v === "music" && e.key.toLowerCase() === "t") { $("tapBtn").click(); }
  else if (e.key === "Escape") { hideToast(); }
});

document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && running) requestWake();
});

/* ============================== INICIALIZACE ============================== */

function syncUI() {
  applyTheme(S.settings.theme);

  $("bpmRange").value = MS.bpm;
  beatsSel.value = MS.beats;
  $("swing").value = MS.swing; $("swingVal").textContent = MS.swing + " %";
  Array.prototype.forEach.call($("subSeg").children, function (x) {
    x.setAttribute("aria-pressed", String(+x.dataset.sub === MS.sub));
  });
  $("accent").setAttribute("aria-pressed", String(MS.accent));
  $("trainerOn").setAttribute("aria-pressed", String(MS.trainerOn));
  $("trStep").value = MS.trStep; $("trStepVal").textContent = "+" + MS.trStep;
  $("trBars").value = MS.trBars; $("trBarsVal").textContent = MS.trBars;
  $("trMax").value = MS.trMax; $("trMaxVal").textContent = MS.trMax;
  $("silentOn").setAttribute("aria-pressed", String(MS.silentOn));
  $("silPlay").value = MS.silPlay; $("silPlayVal").textContent = MS.silPlay;
  $("silMute").value = MS.silMute; $("silMuteVal").textContent = MS.silMute;
  $("countIn").value = MS.countIn; $("countInVal").textContent = MS.countIn;

  $("gBack").value = GS.back; $("gBackVal").textContent = GS.back;
  $("gRatio").value = String(GS.ratio);
  $("gGap").value = Math.round(GS.gap * 10); $("gGapVal").textContent = fmt(GS.gap, 1) + " s";
  $("gJitter").value = Math.round(GS.jitter * 10);
  $("gJitterVal").textContent = GS.jitter === 0 ? "vypnuto" : "± " + fmt(GS.jitter, 1) + " s";
  $("gPrep").setAttribute("aria-pressed", String(GS.prep));
  $("gGoal").value = GS.goal; $("gGoalVal").textContent = GS.goal === 0 ? "bez cíle" : GS.goal;

  $("sound").value = S.settings.sound;
  $("vol").value = Math.round(S.settings.volume * 100);
  $("volVal").textContent = Math.round(S.settings.volume * 100) + " %";
  $("vibrate").setAttribute("aria-pressed", String(S.settings.vibrate));
  $("wake").setAttribute("aria-pressed", String(S.settings.wake));
  $("logOn").setAttribute("aria-pressed", String(S.settings.log));
  $("appVer").textContent = APP_VERSION;

  buildMusicDial();
  updateHints();
  refreshMusic();
  refreshGolf();
  renderGolfPresets();
  renderPresetList("musicPresets", "music");
  renderPresetList("golfUserPresets", "golf");
  setHand("mHand", 0);
  setHand("gHand", 180);
}

syncUI();
setView(VIEWS.indexOf(S.settings.view) >= 0 ? S.settings.view : "music");
