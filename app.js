"use strict";

const CONFIG_URL = "data/berlin.json";

let config = null;
let workouts = [];
let selected = 0;
let timerSteps = [];
let timerIndex = 0;
let remaining = 0;
let total = 0;
let intervalId = null;
let running = false;
let trainingActive = false;
let expandedDetails = null;
let openCards = new Set();
let wakeLock = null;

const userPaces = {
  fiveK: localStorage.getItem("rs_5k_pace") || "",
  threshold: localStorage.getItem("rs_threshold_pace") || ""
};

const $ = id => document.getElementById(id);

function parsePace(value) {
  const match = (value || "").trim().match(/^(\d+):(\d{1,2})$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 ? seconds : null;
}
function paceString(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}/km`;
}
function paceRange(base, add = 10) {
  return base ? `${paceString(base)}–${paceString(base + add)}` : "Pace eintragen";
}
function fastRange() { return paceRange(parsePace(userPaces.fiveK), 10); }
function thresholdRange() { return paceRange(parsePace(userPaces.threshold), 10); }
function easyRange() {
  const pace = parsePace(userPaces.fiveK);
  return pace ? `${paceString(pace + 70)} oder lockerer` : "locker / RPE 2–3";
}
function dynamicPace(workout) {
  return workout.paceMode === "threshold"
    ? `Threshold: ${thresholdRange()} · Active Pause: locker traben`
    : `Fast: ${fastRange()} · Easy: ${easyRange()}`;
}
function enhancedMain(workout) {
  switch (workout.week) {
    case 1: return `15 × 1 min @ ${fastRange()} / 1 min easy`;
    case 2: return `8 × 600 m @ ${fastRange()} + 200 m easy + 1 min Pause`;
    case 3: return `5 × 1 km @ ${fastRange()} · 90 sec Pause`;
    case 4: return `1–2–3–2–1 Runden schnell @ ${fastRange()} · Pausen 1/2/3/2 min`;
    case 5: return `6–5–4–3–2–1 min @ ${thresholdRange()} · je 90 sec active pause`;
    case 6: return `12 × 500 m @ ${fastRange()} · 45 sec Pause`;
    default: return workout.main;
  }
}
function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function currentCycleWeek() {
  const start = new Date(`${config.cycleStart}T00:00:00`);
  const now = new Date();
  const diff = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000));
  return ((diff % workouts.length) + workouts.length) % workouts.length + 1;
}
function speak(text) {
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "de-DE";
    speechSynthesis.speak(utterance);
  } catch (_) {}
}
function vibrate(pattern = 160) {
  try { if ("vibrate" in navigator) navigator.vibrate(pattern); } catch (_) {}
}
async function enableWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    if (!wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch (_) { wakeLock = null; }
}
async function disableWakeLock() {
  try {
    if (wakeLock) await wakeLock.release();
  } catch (_) {}
  wakeLock = null;
}

function initPaces() {
  $("pace5k").value = userPaces.fiveK;
  $("paceThreshold").value = userPaces.threshold;
  calculatePaces();
}
function calculatePaces() {
  const p5 = parsePace($("pace5k").value);
  const threshold = parsePace($("paceThreshold").value);
  const parts = [];
  if (p5) {
    parts.push(`Fast: ${paceString(p5)} bis ${paceString(p5 + 10)}`);
    parts.push(`Easy: ${paceString(p5 + 70)} oder lockerer`);
  }
  if (threshold) parts.push(`Threshold: ${paceString(threshold)} bis ${paceString(threshold + 10)}`);
  $("paceResult").textContent = parts.length ? parts.join(" · ") : "Trage eine Pace ein.";
}
function savePaces() {
  userPaces.fiveK = $("pace5k").value.trim();
  userPaces.threshold = $("paceThreshold").value.trim();
  localStorage.setItem("rs_5k_pace", userPaces.fiveK);
  localStorage.setItem("rs_threshold_pace", userPaces.threshold);
  calculatePaces();
  renderAll();
}

function renderWeekButtons() {
  $("weekButtons").innerHTML = workouts.map((workout, index) =>
    `<button type="button" class="${index === selected ? "active" : ""}" data-week="${index}">Woche ${workout.week}</button>`
  ).join("");
}
function stepsHtml(workout) {
  return workout.steps.map(step => {
    let pace = "";
    if (step.label === "Fast") pace = ` <span class="pace-tag">@ ${fastRange()}</span>`;
    if (step.label === "Threshold") pace = ` <span class="pace-tag">@ ${thresholdRange()}</span>`;
    return `<li><strong>${step.label}</strong> – ${step.text}${pace}</li>`;
  }).join("");
}
function renderCards() {
  $("cards").innerHTML = workouts.map((workout, index) => {
    const open = openCards.has(index);
    return `
      <article class="card ${open ? "" : "collapsed"}">
        <div class="card-header" data-toggle-card="${index}">
          <div>
            <div class="week">Woche ${workout.week}</div>
            <h2>${workout.title}</h2>
            <div class="focus">${workout.goal}</div>
            <div class="compact-main">${enhancedMain(workout)}</div>
          </div>
          <div class="chevron">⌄</div>
        </div>
        <div class="card-body">
          <img class="route-img" src="${workout.image}" alt="Strecke ${workout.title}">
          <a class="map-btn" href="${config.meetingPointUrl}" target="_blank" rel="noopener">📍 ${config.meetingPointName} öffnen</a>
          <div class="row"><div class="label">Ziel</div><div class="value">${workout.goal}</div></div>
          <div class="row"><div class="label">Warm-up</div><div class="value">${workout.warmup}</div></div>
          <div class="row"><div class="label">Main Set</div><div class="value">${enhancedMain(workout)}</div></div>
          <div class="row"><div class="label">Cool-down</div><div class="value">${workout.cooldown}</div></div>
          <div class="row"><div class="label">Deine Pace</div><div class="value">${dynamicPace(workout)}</div></div>
          <div class="bar">
            <button type="button" data-details="${index}">${expandedDetails === index ? "Details ausblenden" : "Details"}</button>
            <button type="button" data-start-week="${index}">Training starten</button>
            <button type="button" data-share-week="${index}">Training teilen</button>
          </div>
          <div class="details ${expandedDetails === index ? "show" : ""}"><ol>${stepsHtml(workout)}</ol></div>
        </div>
      </article>`;
  }).join("");
}
function updateCurrentPanel() {
  const workout = workouts[selected];
  $("currentBadge").textContent = selected === currentCycleWeek() - 1
    ? `Diese Woche: Woche ${workout.week}`
    : `Ausgewählt: Woche ${workout.week}`;
  $("currentTitle").textContent = workout.title;
  $("currentSummary").textContent = `${workout.goal} · ${enhancedMain(workout)} · ${dynamicPace(workout)}`;
}
function renderAll() {
  renderWeekButtons();
  renderCards();
  updateCurrentPanel();
  updateTimer();
  updateStravaText();
}

function selectWeek(index) {
  selected = Number(index);
  stopTimer();
  timerSteps = workouts[selected].steps;
  timerIndex = 0;
  setCurrentStepTime();
  renderAll();
}
function setCurrentStepTime() {
  const step = timerSteps[timerIndex];
  remaining = step?.seconds || 0;
  total = remaining;
}
function manualButtonLabel() {
  const step = timerSteps[timerIndex];
  if (!step) return "Nächster Schritt";
  const label = step.label.toLowerCase();
  const text = step.text.toLowerCase();
  if (label.includes("warm-up")) return "Warm-up beendet";
  if (label.includes("cool-down")) return "Cool-down beendet";
  if (text.includes("600 m")) return "600 m beendet";
  if (text.includes("200 m")) return "200 m beendet";
  if (text.includes("1 km")) return "1 km beendet";
  if (text.includes("500 m")) return "500 m beendet";
  if (text.includes("1 runde")) return "1 Runde beendet";
  if (text.includes("2 runden")) return "2 Runden beendet";
  if (text.includes("3 runden")) return "3 Runden beendet";
  return "Nächster Schritt";
}
function updateTimer() {
  const step = timerSteps[timerIndex];
  const nextBtn = $("nextBtn");
  nextBtn.textContent = step?.type === "distance" ? manualButtonLabel() : "Nächster Schritt";
  nextBtn.disabled = !step || step.type === "time";

  if (!step) {
    $("timerLabel").textContent = "Fertig";
    $("timerTime").textContent = "00:00";
    $("timerInfo").textContent = "Workout beendet";
    $("progressFill").style.width = "100%";
    return;
  }

  let info = step.text;
  if (step.label === "Fast") info += ` · Ziel: ${fastRange()}`;
  if (step.label === "Threshold") info += ` · Ziel: ${thresholdRange()}`;

  $("timerLabel").textContent = `${step.label} (${timerIndex + 1}/${timerSteps.length})`;
  $("timerTime").textContent = step.type === "time" ? formatTime(remaining) : "MANUELL";
  $("timerInfo").textContent = info;
  $("progressFill").style.width = step.type === "time" && total ? `${((total - remaining) / total) * 100}%` : "0%";
}
async function beginTraining(index = selected) {
  if (Number(index) !== selected) selectWeek(index);
  trainingActive = true;
  await enableWakeLock();
  $("timerSection").scrollIntoView({ behavior:"smooth" });
  updateTimer();
}
function startTimer() {
  const step = timerSteps[timerIndex];
  if (!step || step.type !== "time" || running) return;
  trainingActive = true;
  enableWakeLock();
  running = true;
  vibrate(120);
  speak(`Los. ${step.label} startet`);

  intervalId = window.setInterval(() => {
    remaining -= 1;
    if (remaining === 3) speak("3");
    if (remaining === 2) speak("2");
    if (remaining === 1) speak("1");

    if (remaining <= 0) {
      stopTimer();
      vibrate([180,80,180]);
      advanceStep();
      return;
    }
    updateTimer();
  }, 1000);
}
function stopTimer() {
  running = false;
  if (intervalId) window.clearInterval(intervalId);
  intervalId = null;
}
function pauseTimer() {
  stopTimer();
  disableWakeLock();
}
function advanceStep() {
  stopTimer();
  timerIndex += 1;
  setCurrentStepTime();
  updateTimer();

  const step = timerSteps[timerIndex];
  if (!step) {
    trainingActive = false;
    disableWakeLock();
    speak("Workout fertig");
    return;
  }

  vibrate(140);
  if (step.type === "time") {
    speak(`${step.label}. ${step.text}`);
    startTimer();
  } else {
    speak(`${step.label}. ${step.text}. Danach den passenden Beendet-Button drücken.`);
  }
}
function resetTimer() {
  stopTimer();
  trainingActive = false;
  disableWakeLock();
  timerIndex = 0;
  setCurrentStepTime();
  updateTimer();
}
function finishTraining() {
  stopTimer();
  trainingActive = false;
  disableWakeLock();
  vibrate([200,100,200]);
  updateStravaText();
  $("stravaBox").scrollIntoView({ behavior:"smooth", block:"center" });
  speak("Training beendet. Strava Text ist bereit.");
}

function workoutText(workout) {
  return `🏃 Running Society ${config.city}

Woche ${workout.week} – ${workout.title}

Ziel: ${workout.goal}
Warm-up: ${workout.warmup}
Main: ${enhancedMain(workout)}
Cool-down: ${workout.cooldown}

Pace: ${dynamicPace(workout)}`;
}
function stravaText() {
  const workout = workouts[selected];
  return `🏃 Running Society ${config.city}

Woche ${workout.week} – ${workout.title}

🎯 ${workout.goal}
Main: ${enhancedMain(workout)}
Pace: ${dynamicPace(workout)}

#RunningSociety #${config.city}Intervals`;
}
function updateStravaText() { $("stravaBox").value = stravaText(); }
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const field = document.createElement("textarea");
    field.value = text;
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
}
function toggleTheme() {
  document.documentElement.classList.toggle("light");
  localStorage.setItem("rs_theme", document.documentElement.classList.contains("light") ? "light" : "dark");
}

function bindEvents() {
  $("weekButtons").addEventListener("click", event => {
    const btn = event.target.closest("[data-week]");
    if (btn) selectWeek(btn.dataset.week);
  });
  $("cards").addEventListener("click", event => {
    const toggle = event.target.closest("[data-toggle-card]");
    if (toggle) {
      const index = Number(toggle.dataset.toggleCard);
      openCards.has(index) ? openCards.delete(index) : openCards.add(index);
      renderCards();
      return;
    }
    const details = event.target.closest("[data-details]");
    if (details) {
      const index = Number(details.dataset.details);
      expandedDetails = expandedDetails === index ? null : index;
      renderCards();
      return;
    }
    const start = event.target.closest("[data-start-week]");
    if (start) beginTraining(Number(start.dataset.startWeek));
    const share = event.target.closest("[data-share-week]");
    if (share) copyText(workoutText(workouts[Number(share.dataset.shareWeek)]));
  });

  $("heroStartBtn").addEventListener("click", () => beginTraining(selected));
  $("shareBtn").addEventListener("click", () => copyText(workoutText(workouts[selected])));
  $("themeBtn").addEventListener("click", toggleTheme);
  $("pace5k").addEventListener("input", calculatePaces);
  $("paceThreshold").addEventListener("input", calculatePaces);
  $("savePacesBtn").addEventListener("click", savePaces);
  $("startBtn").addEventListener("click", startTimer);
  $("pauseBtn").addEventListener("click", pauseTimer);
  $("nextBtn").addEventListener("click", advanceStep);
  $("resetBtn").addEventListener("click", resetTimer);
  $("finishBtn").addEventListener("click", finishTraining);
  $("copyStravaBtn").addEventListener("click", () => copyText(stravaText()));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && trainingActive) enableWakeLock();
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("sw.js");
    await registration.update();
    if (registration.waiting) registration.waiting.postMessage("SKIP_WAITING");

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage("SKIP_WAITING");
        }
      });
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  } catch (error) {
    console.warn("Service Worker konnte nicht registriert werden.", error);
  }
}

async function init() {
  try {
    const response = await fetch(CONFIG_URL, { cache:"no-store" });
    if (!response.ok) throw new Error(`Konfiguration konnte nicht geladen werden (${response.status}).`);
    config = await response.json();
    workouts = config.workouts;

    $("appTitle").textContent = config.appTitle;
    document.title = `Running Society – ${config.appTitle}`;

    const current = currentCycleWeek();
    selected = Math.max(0, workouts.findIndex(workout => workout.week === current));
    timerSteps = workouts[selected].steps;
    setCurrentStepTime();

    if (localStorage.getItem("rs_theme") === "light") document.documentElement.classList.add("light");

    initPaces();
    bindEvents();
    renderAll();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    $("cards").innerHTML = `<article class="panel"><h2>App konnte nicht geladen werden</h2><p>${error.message}</p></article>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
