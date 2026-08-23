const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const els = {
  startScreen: $("#startScreen"),
  gameScreen: $("#gameScreen"),
  endScreen: $("#endScreen"),
  startBtn: $("#startBtn"),
  retryBtn: $("#retryBtn"),
  shareBtn: $("#shareBtn"),
  soundBtn: $("#soundBtn"),
  installBtn: $("#installBtn"),
  bestScore: $("#bestScore"),
  bestRound: $("#bestRound"),
  installStatus: $("#installStatus"),
  score: $("#score"),
  round: $("#round"),
  timer: $("#timer"),
  modifier: $("#modifier"),
  combo: $("#combo"),
  status: $("#status"),
  instruction: $("#instruction"),
  progressFill: $("#progressFill"),
  finalScore: $("#finalScore"),
  finalRound: $("#finalRound"),
  maxCombo: $("#maxCombo"),
  accuracy: $("#accuracy"),
  resultBadge: $("#resultBadge"),
  resultTitle: $("#resultTitle"),
  resultText: $("#resultText"),
};

const nodes = $$(".node");
const mirrorMap = [2, 1, 0, 5, 4, 3, 8, 7, 6];

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in some embedded/private browsing contexts.
  }
}

const storage = {
  bestScore: Number(readStorage("heist-best-score", "0")) || 0,
  bestRound: Number(readStorage("heist-best-round", "0")) || 0,
  sound: readStorage("heist-sound", "on") !== "off",
};

let deferredInstallPrompt = null;
let audioCtx = null;
let runToken = 0;
let timerFrame = null;
let state = createState();

function createState() {
  return {
    round: 1,
    score: 0,
    combo: 1,
    maxCombo: 1,
    sequence: [],
    target: [],
    inputIndex: 0,
    acceptingInput: false,
    totalTaps: 0,
    correctTaps: 0,
    deadline: 0,
    timeLimit: 12,
    modifier: "STANDARD",
  };
}

function showScreen(name) {
  [els.startScreen, els.gameScreen, els.endScreen].forEach((el) => el.classList.add("hidden"));
  els[name].classList.remove("hidden");
  window.scrollTo(0, 0);
}

function setNodesEnabled(enabled) {
  nodes.forEach((node) => {
    node.disabled = !enabled;
    node.setAttribute("aria-disabled", String(!enabled));
  });
}

function updateStartStats() {
  els.bestScore.textContent = storage.bestScore.toLocaleString();
  els.bestRound.textContent = storage.bestRound;
  els.soundBtn.textContent = storage.sound ? "SFX ON" : "SFX OFF";
}

function randomNode(previous = -1) {
  let value = Math.floor(Math.random() * 9);
  if (value === previous) value = (value + 1 + Math.floor(Math.random() * 8)) % 9;
  return value;
}

function randomNodeExcluding(exclusions = []) {
  const blocked = new Set(exclusions.filter((value) => Number.isInteger(value)));
  const available = Array.from({ length: 9 }, (_, index) => index).filter((index) => !blocked.has(index));
  return available[Math.floor(Math.random() * available.length)];
}

function getModifier(round) {
  if (round < 4) return "STANDARD";
  return ["REVERSE", "MIRROR", "DECOYS"][(round - 4) % 3];
}

function getSequenceLength(round) {
  return Math.min(3 + Math.floor((round - 1) / 2), 8);
}

function getTimeLimit(round) {
  return Math.max(5.5, 12 - (round - 1) * 0.35);
}

function makeSequence(length) {
  const sequence = [];
  for (let i = 0; i < length; i += 1) {
    sequence.push(randomNode(sequence[i - 1]));
  }
  return sequence;
}

function makeTarget(sequence, modifier) {
  if (modifier === "REVERSE") return [...sequence].reverse();
  if (modifier === "MIRROR") return sequence.map((index) => mirrorMap[index]);
  return [...sequence];
}

function protocolInstruction(modifier) {
  if (modifier === "REVERSE") return "Repeat it backwards.";
  if (modifier === "MIRROR") return "Tap the horizontally mirrored positions.";
  if (modifier === "DECOYS") return "Ignore the pink flashes. Repeat cyan only.";
  return "Repeat the sequence.";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    // Haptics are optional enhancement only.
  }
}

function ensureAudio() {
  if (!storage.sound) return;
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
}

function tone(frequency = 440, duration = 0.06, type = "sine", volume = 0.035) {
  if (!storage.sound) return;
  ensureAudio();
  if (!audioCtx || audioCtx.state === "closed") return;

  try {
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(audioCtx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  } catch {
    // Never let an audio implementation quirk break gameplay.
  }
}

function clearNodeClasses() {
  nodes.forEach((node) => node.classList.remove("active", "decoy", "good", "bad"));
}

async function flashNode(index, kind = "active", duration = 280, token = runToken) {
  if (token !== runToken) return;
  const node = nodes[index];
  node.classList.add(kind);
  tone(kind === "decoy" ? 230 : 460 + index * 32, kind === "decoy" ? 0.045 : 0.07, kind === "decoy" ? "sawtooth" : "sine");
  await delay(duration);
  node.classList.remove(kind);
  await delay(90);
}

async function playSequence(token) {
  els.status.textContent = "MEMORIZE";
  els.instruction.textContent = state.modifier === "DECOYS" ? "Pink is noise. Cyan is signal." : "Watch carefully.";
  clearNodeClasses();
  setNodesEnabled(false);
  await delay(450);

  for (let i = 0; i < state.sequence.length; i += 1) {
    if (token !== runToken) return;

    if (state.modifier === "DECOYS" && i > 0 && Math.random() < 0.65) {
      const decoy = randomNodeExcluding([state.sequence[i], state.sequence[i - 1]]);
      await flashNode(decoy, "decoy", 180, token);
    }

    await flashNode(state.sequence[i], "active", Math.max(180, 330 - state.round * 8), token);
  }

  if (token !== runToken) return;
  beginInput();
}

function updateHUD() {
  els.score.textContent = state.score.toLocaleString();
  els.round.textContent = state.round;
  els.modifier.textContent = state.modifier;
  els.combo.textContent = state.combo.toFixed(2);
  const progress = state.target.length ? (state.inputIndex / state.target.length) * 100 : 0;
  els.progressFill.style.width = `${progress}%`;
}

function beginInput() {
  state.acceptingInput = true;
  state.inputIndex = 0;
  state.deadline = performance.now() + state.timeLimit * 1000;
  els.status.textContent = "YOUR MOVE";
  els.instruction.textContent = protocolInstruction(state.modifier);
  els.progressFill.style.width = "0%";
  setNodesEnabled(true);
  tickTimer();
}

function tickTimer() {
  cancelAnimationFrame(timerFrame);

  const tick = () => {
    if (!state.acceptingInput) return;
    const remaining = Math.max(0, (state.deadline - performance.now()) / 1000);
    els.timer.textContent = remaining.toFixed(1);
    if (remaining <= 0) {
      failRun("TIMEOUT");
      return;
    }
    timerFrame = requestAnimationFrame(tick);
  };

  tick();
}

async function startRound() {
  const token = runToken;
  state.acceptingInput = false;
  setNodesEnabled(false);
  state.modifier = getModifier(state.round);
  state.timeLimit = getTimeLimit(state.round);
  state.sequence = makeSequence(getSequenceLength(state.round));
  state.target = makeTarget(state.sequence, state.modifier);
  state.inputIndex = 0;
  els.timer.textContent = state.timeLimit.toFixed(1);
  updateHUD();
  await playSequence(token);
}

async function handleNodePress(event) {
  if (!state.acceptingInput) return;
  const node = event.currentTarget;
  const index = Number(node.dataset.index);
  const expected = state.target[state.inputIndex];

  state.totalTaps += 1;

  if (index !== expected) {
    state.acceptingInput = false;
    setNodesEnabled(false);
    node.classList.add("bad");
    tone(120, 0.18, "sawtooth", 0.05);
    vibrate([55, 35, 90]);
    await delay(260);
    node.classList.remove("bad");
    failRun("WRONG NODE");
    return;
  }

  state.correctTaps += 1;
  state.inputIndex += 1;
  const tapPoints = Math.round(100 * state.combo);
  state.score += tapPoints;
  node.classList.add("good");
  tone(520 + state.inputIndex * 35, 0.055, "sine");
  vibrate(12);
  setTimeout(() => node.classList.remove("good"), 115);
  updateHUD();

  if (state.inputIndex >= state.target.length) {
    await completeRound();
  }
}

async function completeRound() {
  state.acceptingInput = false;
  setNodesEnabled(false);
  cancelAnimationFrame(timerFrame);
  const remaining = Math.max(0, (state.deadline - performance.now()) / 1000);
  const speedBonus = Math.round(remaining * 18 * state.combo);
  const roundBonus = Math.round(250 * state.combo);
  state.score += speedBonus + roundBonus;
  state.combo = Math.min(4, state.combo + 0.25);
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  updateHUD();

  els.status.textContent = "ACCESS GRANTED";
  els.instruction.textContent = `+${(speedBonus + roundBonus).toLocaleString()} speed bonus`;
  els.progressFill.style.width = "100%";
  tone(760, 0.09, "triangle", 0.045);
  setTimeout(() => tone(980, 0.1, "triangle", 0.035), 80);
  vibrate([20, 25, 20]);

  state.round += 1;
  await delay(780);
  if (els.gameScreen.classList.contains("hidden")) return;
  await startRound();
}

function failRun(reason) {
  if (els.gameScreen.classList.contains("hidden")) return;
  state.acceptingInput = false;
  setNodesEnabled(false);
  cancelAnimationFrame(timerFrame);
  runToken += 1;

  const clearedRounds = Math.max(0, state.round - 1);
  const accuracy = state.totalTaps ? Math.round((state.correctTaps / state.totalTaps) * 100) : 0;
  const isBest = state.score > storage.bestScore;

  if (isBest) {
    storage.bestScore = state.score;
    writeStorage("heist-best-score", String(storage.bestScore));
  }
  if (clearedRounds > storage.bestRound) {
    storage.bestRound = clearedRounds;
    writeStorage("heist-best-round", String(storage.bestRound));
  }

  els.resultBadge.textContent = isBest ? "NEW PERSONAL BEST" : reason;
  els.resultBadge.style.color = isBest ? "var(--lime)" : "var(--danger)";
  els.resultBadge.style.borderColor = isBest ? "rgba(189,255,79,.35)" : "rgba(255,94,109,.35)";
  els.resultTitle.textContent = isBest ? "Clean getaway." : reason === "TIMEOUT" ? "Trace locked on." : "The vault fought back.";
  els.resultText.textContent = clearedRounds === 0
    ? "The first lock got you. Run it back."
    : `You cracked ${clearedRounds} ${clearedRounds === 1 ? "round" : "rounds"} before the trace closed in.`;
  els.finalScore.textContent = state.score.toLocaleString();
  els.finalRound.textContent = clearedRounds;
  els.maxCombo.textContent = `${state.maxCombo.toFixed(2)}x`;
  els.accuracy.textContent = `${accuracy}%`;

  updateStartStats();
  showScreen("endScreen");
}

function startGame() {
  ensureAudio();
  runToken += 1;
  cancelAnimationFrame(timerFrame);
  state = createState();
  clearNodeClasses();
  setNodesEnabled(false);
  updateHUD();
  showScreen("gameScreen");
  startRound();
}

async function shareScore() {
  const clearedRounds = Math.max(0, state.round - 1);
  const text = `I scored ${state.score.toLocaleString()} in HEIST//SHIFT and cracked ${clearedRounds} rounds. Can you beat it?`;

  try {
    if (navigator.share) {
      await navigator.share({ title: "HEIST//SHIFT", text, url: location.href });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(`${text} ${location.href}`);
      els.shareBtn.textContent = "COPIED TO CLIPBOARD";
      setTimeout(() => { els.shareBtn.textContent = "SHARE SCORE"; }, 1600);
    }
  } catch (error) {
    if (error?.name !== "AbortError") console.warn("Share failed", error);
  }
}

function toggleSound() {
  storage.sound = !storage.sound;
  writeStorage("heist-sound", storage.sound ? "on" : "off");
  els.soundBtn.textContent = storage.sound ? "SFX ON" : "SFX OFF";
  if (storage.sound) {
    ensureAudio();
    tone(620, 0.06, "sine");
  }
}

nodes.forEach((node) => node.addEventListener("click", handleNodePress));
els.startBtn.addEventListener("click", startGame);
els.retryBtn.addEventListener("click", startGame);
els.shareBtn.addEventListener("click", shareScore);
els.soundBtn.addEventListener("click", toggleSound);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  els.installBtn.classList.remove("hidden");
  els.installStatus.textContent = "INSTALLABLE";
});

els.installBtn.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installBtn.classList.add("hidden");
});

window.addEventListener("appinstalled", () => {
  els.installStatus.textContent = "INSTALLED";
  els.installBtn.classList.add("hidden");
});

if (window.matchMedia("(display-mode: standalone)").matches) {
  els.installStatus.textContent = "INSTALLED";
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service worker registration failed", error));
  });
}

setNodesEnabled(false);
updateStartStats();
