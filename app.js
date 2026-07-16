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

function normalizePaceInput(value) {
  const raw = (value || "").trim().replace(",", ".").replace(/\s+/g, "");
  if (!raw) return null;

  let minutes;
  let seconds;

  if (/^\d{3}$/.test(raw)) {
    minutes = Number(raw.slice(0, 1));
    seconds = Number(raw.slice(1));
  } else if (/^\d{4}$/.test(raw)) {
    minutes = Number(raw.slice(0, 2));
    seconds = Number(raw.slice(2));
  } else {
    const match = raw.match(/^(\d{1,2})[:.](\d{1,2})$/);
    if (!match) return null;
    minutes = Number(match[1]);
    seconds = Number(match[2]);
  }

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (minutes < 2 || minutes > 15 || seconds < 0 || seconds > 59) return null;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parsePace(value) {
  const normalized = normalizePaceInput(value);
  if (!normalized) return null;

  const [minutes, seconds] = normalized.split(":").map(Number);
  return minutes * 60 + seconds;
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
    : `Schneller Lauf: ${fastRange()} · Easy Lauf: ${easyRange()}`;
}

function secondsLabel(seconds) {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} min`;
  }
  return `${seconds} sec`;
}

function mainSteps(workout) {
  return workout.steps.filter(step =>
    step.label !== "Warm-up" && step.label !== "Cool-down"
  );
}

function summaryFromSteps(workout) {
  const steps = mainSteps(workout);
  const quick = steps.filter(step => step.label === "Schneller Lauf");
  const easy = steps.filter(step => step.label === "Easy Lauf");
  const pauses = steps.filter(step => step.label === "Pause");
  const threshold = steps.filter(step => step.label === "Threshold");
  const activePauses = steps.filter(step => step.label === "Active pause");

  if (workout.week === 1 && quick.length && easy.length) {
    return `${quick.length} × ${quick[0].text} @ ${fastRange()} / ${easy[0].text}`;
  }

  if (workout.week === 2 && pauses.length === 1) {
    const pauseIndex = steps.findIndex(step => step.label === "Pause");
    const firstBlock = steps.slice(0, pauseIndex);
    const secondBlock = steps.slice(pauseIndex + 1);
    const firstCount = firstBlock.filter(step => step.label === "Schneller Lauf").length;
    const secondCount = secondBlock.filter(step => step.label === "Schneller Lauf").length;
    const quickText = quick[0]?.text || "600 m";
    const easyText = easy[0]?.text || "200 m";

    return `${firstCount} × ${quickText} Schneller Lauf @ ${fastRange()} + ${easyText} Easy Lauf · ${secondsLabel(pauses[0].seconds)} Pause · ${secondCount} × ${quickText} Schneller Lauf @ ${fastRange()} + ${easyText} Easy Lauf`;
  }

  if (workout.week === 3 && quick.length) {
    return `${quick.length} × ${quick[0].text} Schneller Lauf @ ${fastRange()} · ${secondsLabel(pauses[0]?.seconds || 0)} Pause`;
  }

  if (workout.week === 4 && quick.length) {
    const rounds = quick.map(step => {
      const match = step.text.match(/^(\d+)/);
      return match ? match[1] : step.text;
    }).join("–");
    const pauseText = pauses.map(step => (step.seconds || 0) / 60).join("/");
    return `${rounds} Runden Schneller Lauf @ ${fastRange()} · Pausen ${pauseText} min`;
  }

  if (workout.week === 5 && threshold.length) {
    const durations = threshold.map(step => Math.round((step.seconds || 0) / 60)).join("–");
    return `${durations} min @ ${thresholdRange()} · je ${secondsLabel(activePauses[0]?.seconds || 0)} Active Pause`;
  }

  if (workout.week === 6 && quick.length) {
    return `${quick.length} × ${quick[0].text} Schneller Lauf @ ${fastRange()} · ${secondsLabel(pauses[0]?.seconds || 0)} Pause`;
  }

  return steps.map(step => step.text).join(" · ");
}

function enhancedMain(workout) {
  return summaryFromSteps(workout);
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
  const fiveKInput = $("pace5k");
  const thresholdInput = $("paceThreshold");

  const normalizedFiveK = normalizePaceInput(fiveKInput.value);
  const normalizedThreshold = normalizePaceInput(thresholdInput.value);

  const errors = [];

  if (fiveKInput.value.trim() && !normalizedFiveK) {
    errors.push("5k-Pace");
    fiveKInput.value = userPaces.fiveK;
  }

  if (thresholdInput.value.trim() && !normalizedThreshold) {
    errors.push("Threshold-Pace");
    thresholdInput.value = userPaces.threshold;
  }

  if (errors.length) {
    $("paceResult").textContent = `Ungültige Eingabe: ${errors.join(" und ")}. Bitte z. B. 4:30, 4.30, 4,30 oder 430 eingeben.`;
    return;
  }

  userPaces.fiveK = normalizedFiveK || "";
  userPaces.threshold = normalizedThreshold || "";

  fiveKInput.value = userPaces.fiveK;
  thresholdInput.value = userPaces.threshold;

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
    if (step.label === "Schneller Lauf") pace = ` <span class="pace-tag">@ ${fastRange()}</span>`;
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
function updateControlButtons(step) {
  const startBtn = $("startBtn");
  const pauseBtn = $("pauseBtn");
  const nextBtn = $("nextBtn");

  nextBtn.textContent = "Nächster Schritt";

  if (!step) {
    startBtn.textContent = "Fertig";
    startBtn.disabled = true;
    pauseBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  if (step.type === "distance") {
    startBtn.textContent = trainingActive ? "Training aktiv" : "Training starten";
    startBtn.disabled = trainingActive;
    pauseBtn.disabled = true;
    nextBtn.disabled = false;
    return;
  }

  if (running) {
    startBtn.textContent = "Läuft";
    startBtn.disabled = true;
    pauseBtn.textContent = "Pause";
    pauseBtn.disabled = false;
  } else if (remaining < total && total > 0) {
    startBtn.textContent = "Pausiert";
    startBtn.disabled = true;
    pauseBtn.textContent = "Fortsetzen";
    pauseBtn.disabled = false;
  } else {
    startBtn.textContent = "Start";
    startBtn.disabled = false;
    pauseBtn.textContent = "Pause";
    pauseBtn.disabled = true;
  }
  nextBtn.disabled = false;
}

function updateTimer() {
  const step = timerSteps[timerIndex];
  updateControlButtons(step);

  if (!step) {
    $("timerLabel").textContent = "Fertig";
    $("timerTime").textContent = "00:00";
    $("timerInfo").textContent = "Workout beendet";
    $("progressFill").style.width = "100%";
    return;
  }

  let info = step.text;
  if (step.label === "Schneller Lauf") info += ` · Ziel: ${fastRange()}`;
  if (step.label === "Threshold") info += ` · Ziel: ${thresholdRange()}`;

  if (step.type === "distance" && trainingActive) {
    info += " · danach „Nächster Schritt“";
  }

  $("timerLabel").textContent = `${step.label} (${timerIndex + 1}/${timerSteps.length})`;
  $("timerTime").textContent = step.type === "time" ? formatTime(remaining) : "MANUELL";
  $("timerInfo").textContent = info;
  $("progressFill").style.width = step.type === "time" && total
    ? `${((total - remaining) / total) * 100}%`
    : "0%";
}

async function beginTraining(index = selected) {
  if (Number(index) !== selected) selectWeek(index);
  trainingActive = true;
  await enableWakeLock();
  $("timerSection").scrollIntoView({ behavior:"smooth" });
  updateTimer();
}
async function startTimer() {
  const step = timerSteps[timerIndex];
  if (!step || running) return;

  trainingActive = true;
  await enableWakeLock();

  if (step.type === "distance") {
    vibrate(100);
    speak(`Training gestartet. ${step.text}. Danach Nächster Schritt drücken.`);
    updateTimer();
    return;
  }

  running = true;
  vibrate(120);
  speak(`Los. ${step.label} startet`);
  updateTimer();

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
  if (timerSteps.length) updateTimer();
}
async function pauseTimer() {
  const step = timerSteps[timerIndex];
  if (!step || step.type !== "time") return;

  if (running) {
    stopTimer();
    await disableWakeLock();
    updateTimer();
    return;
  }

  if (remaining > 0 && remaining < total) {
    await startTimer();
  }
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

function formatPaceField(input, fallbackValue) {
  const value = input.value.trim();
  if (!value) return;

  const normalized = normalizePaceInput(value);
  if (normalized) {
    input.value = normalized;
    calculatePaces();
  } else {
    input.value = fallbackValue;
    $("paceResult").textContent = "Ungültige Pace. Bitte z. B. 4:30, 4.30, 4,30 oder 430 eingeben.";
  }
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
  $("pace5k").addEventListener("blur", () => formatPaceField($("pace5k"), userPaces.fiveK));
  $("paceThreshold").addEventListener("blur", () => formatPaceField($("paceThreshold"), userPaces.threshold));
  $("savePacesBtn").addEventListener("click", savePaces);
  $("startBtn").addEventListener("click", startTimer);
  $("pauseBtn").addEventListener("click", pauseTimer);
  $("nextBtn").addEventListener("click", () => {
    if (timerSteps[timerIndex]) {
      vibrate(120);
      speak("Nächster Abschnitt");
      advanceStep();
    }
  });
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
