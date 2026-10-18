/**
 * The playground: every creature, mood, move and transit of @cofold/bood,
 * drawn by @cofold/bood/dom. Plain ES modules straight from `dist/`.
 */

import {
  BOOD_ACTIONS,
  BOOD_BODIES,
  BOOD_COLORS,
  BOOD_MOODS,
  BOOD_TRANSITS,
  BOOD_W,
  action,
  actionsOf,
  ambient,
  blink,
  creatures,
  glance,
  pop,
  pose,
  scene,
  swing,
  transit,
  walk,
} from "/dist/index.js";
import { mountBood } from "/dist/dom.js";

const $ = (id) => document.getElementById(id);
const between = (min, max) => min + Math.random() * (max - min);

const state = {
  body: "robot",
  mood: "idle",
  color: null,
  scheme: "dark",
  filled: true,
  brows: false,
  mouth: true,
  detail: true,
  mouthTone: true,
  background: "dark",
  eyes: "dots",
  facing: 0,
  lift: 0,
  tilt: 0,
  depth: 0,
  rate: 1,
  life: true,
  paused: false,
  gaze: { x: 0, y: 0 },
  x: 0,
};

const sceneOf = (body = state.body) =>
  scene(body, {
    mood: state.mood,
    scheme: state.scheme,
    ...(state.color === null ? {} : { color: state.color }),
    filled: state.filled,
    detail: state.detail ? "full" : "simple",
    eyes: state.eyes,
    brows: state.brows,
    mouth: state.mouth,
    mouthTone: state.mouthTone ? "body" : "ink",
  });
/** The colour the body is drawn in, as the scene resolves it. */
const color = () => sceneOf().color;

// The stage.

const view = mountBood($("figure"), sceneOf());
const run = (play, key) =>
  view.play(play, { ...(key === undefined ? {} : { key }), rate: state.rate });
let ambientKeys = [];

function restartAmbient() {
  for (const key of ambientKeys) view.stop(key);
  const plays = ambient(state.body, state.mood, {
    scheme: state.scheme,
    brows: state.brows && state.detail,
  });
  ambientKeys = plays.map((play, i) => {
    const key = `ambient${i}`;
    run(play, key);
    return key;
  });
}

function redraw({ popped = false } = {}) {
  view.setScene(sceneOf());
  restartAmbient();
  if (popped) run(pop());
  setPose(state.facing, state.lift, 0);
  caption();
  // The grid follows every change too, while it shows.
  if (!$("view-grid").hidden) refreshGrid();
}

/** Turns the head; the tilt and the depth are the controls', whatever the look. */
function setPose(facing, lift, ms = 260) {
  const tilt = state.tilt;
  const depth = state.depth;
  const from = {
    facing: state.posed?.facing ?? 0,
    lift: state.posed?.lift ?? 0,
    tilt: state.posed?.tilt ?? 0,
    depth: state.posed?.depth ?? 0,
  };
  state.posed = { facing, lift, tilt, depth };
  run(pose(state.body, state.mood, { facing, lift, tilt, depth }, from, ms), "pose");
}

function caption() {
  const creature = creatures[state.body];
  $("caption").textContent =
    `${state.body} · ${state.mood} · moves: ${creature.actions.join(", ") || "none"}` +
    (creature.released ? "" : " · not released");
}

// Life: blinks, glances and swings now and then.

const timers = [];
function every(min, max, fn) {
  const tick = () => {
    if (state.life && !state.paused) fn();
    timers.push(setTimeout(tick, between(min, max)));
  };
  timers.push(setTimeout(tick, between(min, max)));
}
every(3400, 7600, () => run(blink(state.body)));
every(900, 3300, () => {
  if (state.following) return;
  const next = { x: between(-0.4, 0.4), y: between(-0.4, 0.4) };
  run(glance(state.body, state.mood, next.x, next.y, state.gaze), "glance");
  state.gaze = next;
});
every(3200, 7400, () => {
  if (creatures[state.body].antenna !== undefined) run(swing(state.body));
});

// Controls.

function fillSelect(select, values, selected) {
  select.innerHTML = values
    .map(
      (value) =>
        `<option value="${value}"${value === selected ? " selected" : ""}>${value}</option>`,
    )
    .join("");
}

fillSelect($("body"), BOOD_BODIES, state.body);
fillSelect($("mood"), BOOD_MOODS, state.mood);
/**
 * Every move as a button; the body's own moves are blue. Any body can play
 * any move, so all of them stay one click away.
 */
function ownMoves() {
  const own = new Set(actionsOf(state.body));
  $("moves").innerHTML = BOOD_ACTIONS.map(
    (name) =>
      `<button data-action="${name}"${own.has(name) ? ' class="own"' : ""} title="${name}">${name}</button>`,
  ).join("");
}
$("moves").addEventListener("click", (event) => {
  const name = event.target.dataset?.action;
  if (name !== undefined)
    run(
      action(state.body, name, { color: color(), filled: state.filled }),
      "act",
    );
});
ownMoves();

/** Every transit as a button; the switch above says whether a click leaves and returns, hides or shows. */
let transitMode = "both";
$("transits").innerHTML = BOOD_TRANSITS.map(
  (kind) => `<button data-transit="${kind}" title="${kind}">${kind}</button>`,
).join("");
$("transits").addEventListener("click", async (event) => {
  const kind = event.target.dataset?.transit;
  if (kind === undefined) return;
  if (transitMode !== "both") {
    run(transit(kind, transitMode, { color: color() }), "transit");
    return;
  }
  await run(transit(kind, "hide", { color: color() }), "transit").finished;
  await new Promise((done) => setTimeout(done, 400 / state.rate));
  run(transit(kind, "show", { color: color() }), "transit");
});

/** `#rrggbb` for a hue in degrees, a saturation and a lightness in percent. */
function hsl(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * A wide test palette, not the one a person picks from: eleven greys from black
 * to white, then every 15 degrees of hue from dark to light.
 */
const TEST_COLORS = [
  ...Array.from({ length: 11 }, (_, i) => hsl(0, 0, i * 10)),
  ...[25, 40, 55, 70].flatMap((l) => Array.from({ length: 24 }, (_, i) => hsl(i * 15, 75, l))),
];

const swatch = (one) =>
  `<button style="background:${one}" data-color="${one}" aria-pressed="${state.color === one}" title="${one}"></button>`;

/** No colour picked keeps the base colour in every mood; "mood" takes the mood's. */
function swatches() {
  $("moreColors").innerHTML = TEST_COLORS.map(swatch).join("");
  $("colors").innerHTML =
    `<button class="mood-color" data-color="" aria-pressed="${state.color === null}">base</button>` +
    `<button class="mood-color" data-color="mood" aria-pressed="${state.color === "mood"}">mood</button>` +
    BOOD_COLORS.map(
      (one) =>
        `<button style="background:${one}" data-color="${one}" aria-pressed="${state.color === one}" title="${one}"></button>`,
    ).join("");
}
function pickColor(value) {
  state.color = value === "" ? null : value;
  swatches();
  redraw();
}
for (const id of ["colors", "moreColors"]) {
  $(id).addEventListener("click", (event) => {
    const value = event.target.dataset?.color;
    if (value !== undefined) pickColor(value);
  });
}
$("anyColor").addEventListener("input", (event) => pickColor(event.target.value));
swatches();

$("body").addEventListener("change", (event) => {
  state.body = event.target.value;
  ownMoves();
  redraw({ popped: true });
});
$("mood").addEventListener("change", (event) => {
  state.mood = event.target.value;
  redraw({ popped: true });
});
for (const id of ["filled", "brows", "mouth", "detail", "mouthTone"]) {
  $(id).addEventListener("change", (event) => {
    state[id] = event.target.checked;
    redraw();
  });
}

function segment(id, attr, apply) {
  $(id).addEventListener("click", (event) => {
    const value = event.target.dataset?.[attr];
    if (value === undefined) return;
    for (const button of $(id).querySelectorAll("button"))
      button.setAttribute("aria-pressed", String(button === event.target));
    apply(value);
  });
}
segment("eyes", "eyes", (value) => {
  state.eyes = value;
  redraw();
});
segment("scheme", "scheme", (value) => {
  state.scheme = value;
  redraw();
});

// The background behind the stage and the grid: plain dark or light, or a
// picture read from this computer, which is never sent anywhere.
let backgroundUrl = null;
function setBackground(kind) {
  state.background = kind;
  document.body.dataset.stage = kind;
  for (const button of $("background").querySelectorAll("button"))
    button.setAttribute("aria-pressed", String(button.dataset.background === kind));
  if (kind !== "image") {
    document.body.style.removeProperty("--stage-image");
    $("backgroundName").textContent = "An image is shown from your computer, never sent anywhere.";
  }
}
$("background").addEventListener("click", (event) => {
  const kind = event.target.dataset?.background;
  if (kind === "image") $("backgroundFile").click();
  else if (kind !== undefined) setBackground(kind);
});
$("backgroundFile").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file === undefined) return;
  if (backgroundUrl !== null) URL.revokeObjectURL(backgroundUrl);
  backgroundUrl = URL.createObjectURL(file);
  document.body.style.setProperty("--stage-image", `url("${backgroundUrl}")`);
  $("backgroundName").textContent = file.name;
  setBackground("image");
  // The same file can be picked again after another background.
  event.target.value = "";
});
segment("transitMode", "mode", (value) => {
  transitMode = value;
});
segment("rate", "rate", (value) => {
  state.rate = Number(value);
  for (const one of document.getAnimations()) one.playbackRate = state.rate;
});

// Head.

const facing = $("facing");
const lift = $("lift");
const tilt = $("tilt");
const showPose = () => {
  $("facingOut").textContent = Number(facing.value).toFixed(2);
  $("liftOut").textContent = Number(lift.value).toFixed(2);
  $("tiltOut").textContent = Number(tilt.value).toFixed(2);
};
for (const input of [facing, lift, tilt]) {
  input.addEventListener("input", () => {
    state.facing = Number(facing.value);
    state.lift = Number(lift.value);
    state.tilt = Number(tilt.value);
    showPose();
    setPose(state.facing, state.lift, 120);
  });
}

async function walkTo(direction) {
  state.facing = direction;
  facing.value = String(direction);
  showPose();
  setPose(direction, state.lift, 180);
  const { play, travel } = walk(direction, { steps: 4 });
  const walker = $("walker");
  const stage = $("stage");
  const px = (travel / BOOD_W) * walker.offsetWidth;
  const limit = (stage.offsetWidth - walker.offsetWidth) / 2;
  const target = Math.max(-limit, Math.min(limit, state.x + px));
  // The last walk's held position goes; this one starts from the same place.
  for (const old of walker.getAnimations()) old.cancel();
  const moving = walker.animate(
    [
      { transform: `translateX(${state.x}px)` },
      { transform: `translateX(${target}px)` },
    ],
    { duration: play.timeline.duration, easing: "linear", fill: "forwards" },
  );
  moving.playbackRate = state.rate;
  state.x = target;
  await run(play, "act").finished;
}
$("walkLeft").addEventListener("click", () => walkTo(-1));
$("walkRight").addEventListener("click", () => walkTo(1));

// The body follows the pointer anywhere on the page, not only over the stage,
// and each frame reads the latest point, not the one that scheduled it.
let frame = 0;
let latest = { x: 0, y: 0 };
const clamp = (value) => Math.max(-1, Math.min(1, value));
document.addEventListener("pointermove", (event) => {
  latest = { x: event.clientX, y: event.clientY };
  if (!$("follow").checked || frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const box = $("figure").getBoundingClientRect();
    const f = clamp((latest.x - (box.left + box.width / 2)) / (box.width / 2));
    const l = clamp(
      -(latest.y - (box.top + box.height / 2)) / (box.height / 2),
    );
    state.following = true;
    state.facing = f;
    state.lift = l;
    facing.value = String(f);
    lift.value = String(l);
    showPose();
    setPose(f, l, 120);
  });
});
/** The head back to the front: facing, lift and, with `level`, the tilt too. */
function faceFront({ level = false } = {}) {
  state.following = false;
  state.facing = 0;
  state.lift = 0;
  facing.value = "0";
  lift.value = "0";
  if (level) {
    state.tilt = 0;
    tilt.value = "0";
  }
  showPose();
  setPose(0, 0, 400);
}
document.documentElement.addEventListener("pointerleave", () => {
  if ($("follow").checked) faceFront();
});
// Turning the follow off sets the head straight, as it was before it looked anywhere.
$("follow").addEventListener("change", (event) => {
  if (!event.target.checked) faceFront({ level: true });
});
// How much bigger the near side is drawn and smaller the far one: 0 is a flat face.
const showDepth = () => ($("depthOut").textContent = `${Math.round(state.depth * 100)}%`);
$("depth").addEventListener("input", (event) => {
  state.depth = Number(event.target.value);
  showDepth();
  setPose(state.facing, state.lift, 120);
});

// Talk: the mouth opens with a voice, read every frame for how loud it is and
// how high it sounds. Louder opens it more; a high, bright tone more than a
// low one. The audio is read in this page and never sent anywhere.

/** How fast the mouth follows the voice: quick to open, a little slower to close. */
const ATTACK = 0.55;
const RELEASE = 0.25;
let talking = { stop() {} };
let opened = 0;

function setOpen(value) {
  $("open").value = String(value);
  $("openOut").textContent = value.toFixed(2);
  view.talk(value);
}
$("open").addEventListener("input", (event) => {
  // Read first: stopping the voice puts the slider back to 0.
  const value = Number(event.target.value);
  stopTalking();
  setOpen(value);
});

/** Each frame, `read` gives a target opening from 0 to 1; the mouth eases toward it. */
function drive(read, info) {
  let frame = 0;
  const tick = () => {
    const target = Math.max(0, Math.min(1, read()));
    opened += (target - opened) * (target > opened ? ATTACK : RELEASE);
    setOpen(opened < 0.01 ? 0 : opened);
    $("talkInfo").textContent = info();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

/** A voice's opening from an analyser: its loudness, opened further by a bright tone. */
function listen(analyser) {
  const wave = new Float32Array(analyser.fftSize);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
  let loud = 0;
  let tone = 0;
  const read = () => {
    analyser.getFloatTimeDomainData(wave);
    analyser.getFloatFrequencyData(spectrum);
    let sum = 0;
    for (const v of wave) sum += v * v;
    loud = Math.min(1, Math.sqrt(sum / wave.length) * 5);
    // The spectrum's centre of weight over the voice's range, 80 Hz to 3 kHz, as 0 (low) to 1 (high).
    // Weighed by magnitude, not decibels, or the quiet bins would pull every voice to the middle.
    let weight = 0;
    let at = 0;
    for (let i = 0; i < spectrum.length; i += 1) {
      const hz = i * hzPerBin;
      if (hz < 80 || hz > 3000) continue;
      const magnitude = 10 ** (spectrum[i] / 20);
      weight += magnitude;
      at += magnitude * hz;
    }
    tone = weight === 0 ? 0 : Math.max(0, Math.min(1, (at / weight - 300) / 1500));
    return loud < 0.04 ? 0 : loud * (0.55 + 0.45 * tone);
  };
  return { read, info: () => `loud ${loud.toFixed(2)} · tone ${tone.toFixed(2)}` };
}

/** Speech without a voice: syllables of random length, height and loudness, with pauses between words. */
function babble() {
  let syllable = { start: 0, ms: 0, peak: 0 };
  let next = performance.now();
  const read = () => {
    const now = performance.now();
    if (now >= next) {
      const pause = Math.random() < 0.18;
      const ms = pause ? 180 + Math.random() * 320 : 110 + Math.random() * 150;
      syllable = { start: now, ms, peak: pause ? 0 : 0.35 + Math.random() * 0.65 };
      next = now + ms;
    }
    const t = (now - syllable.start) / syllable.ms;
    return syllable.peak * Math.sin(Math.PI * Math.max(0, Math.min(1, t)));
  };
  return { read, info: () => "babbling: random syllables" };
}

function stopTalking() {
  talking.stop();
  talking = { stop() {} };
  opened = 0;
  setOpen(0);
  for (const button of $("talk").querySelectorAll("button"))
    button.setAttribute("aria-pressed", String(button.dataset.talk === "off"));
}

function pressTalk(kind) {
  for (const button of $("talk").querySelectorAll("button"))
    button.setAttribute("aria-pressed", String(button.dataset.talk === kind));
}

async function startTalking(kind, file) {
  stopTalking();
  if (kind === "off") return;
  pressTalk(kind);
  if (kind === "babble") {
    const voice = babble();
    talking = { stop: drive(voice.read, voice.info) };
    return;
  }
  const audio = new AudioContext();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.3;
  let source;
  let element;
  if (kind === "mic") {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      audio.close();
      stopTalking();
      $("talkInfo").textContent = `No microphone: ${error.message}`;
      return;
    }
    source = audio.createMediaStreamSource(stream);
    // Not to the speakers: it would feed back into the microphone.
    source.connect(analyser);
    element = { pause: () => stream.getTracks().forEach((track) => track.stop()) };
  } else {
    const url = URL.createObjectURL(file);
    const player = new Audio(url);
    source = audio.createMediaElementSource(player);
    source.connect(analyser);
    analyser.connect(audio.destination);
    player.addEventListener("ended", () => stopTalking());
    await player.play();
    element = { pause: () => { player.pause(); URL.revokeObjectURL(url); } };
  }
  const voice = listen(analyser);
  const stopDriving = drive(voice.read, voice.info);
  talking = {
    stop() {
      stopDriving();
      element.pause();
      audio.close();
    },
  };
}

$("talk").addEventListener("click", (event) => {
  const kind = event.target.dataset?.talk;
  if (kind === "file") $("talkFile").click();
  else if (kind !== undefined) startTalking(kind);
});
$("talkFile").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file !== undefined) startTalking("file", file);
  event.target.value = "";
});

// Moves.

$("blink").addEventListener("click", () => run(blink(state.body)));
$("glance").addEventListener("click", () => {
  const next = { x: between(-1, 1), y: between(-1, 1) };
  run(glance(state.body, state.mood, next.x, next.y, state.gaze), "glance");
  state.gaze = next;
});
$("swing").addEventListener("click", () => run(swing(state.body)));
$("pop").addEventListener("click", () => run(pop()));
$("life").addEventListener(
  "change",
  (event) => (state.life = event.target.checked),
);
$("pause").addEventListener("click", () => {
  state.paused = !state.paused;
  for (const one of document.getAnimations())
    state.paused ? one.pause() : one.play();
  $("pause").textContent = state.paused ? "Resume" : "Pause";
});

// Tabs: the stage, every creature, and the reference drawings.

/** Each creature in the grid, with its view and the keys of its loops. */
let gridViews = [];

/** Draws one grid creature in the current look, and restarts its loops. */
function drawCell(cell) {
  cell.view.setScene(sceneOf(cell.body));
  for (const key of cell.keys) cell.view.stop(key);
  cell.keys = ambient(cell.body, state.mood, {
    scheme: state.scheme,
    brows: state.brows && state.detail,
  }).map((play, i) => {
    const key = `ambient${i}`;
    cell.view.play(play, { key, rate: state.rate });
    return key;
  });
}

function refreshGrid() {
  for (const cell of gridViews) drawCell(cell);
}

function grid() {
  for (const one of gridViews) one.view.destroy();
  gridViews = [];
  $("grid").innerHTML = "";
  for (const body of BOOD_BODIES) {
    const cell = document.createElement("div");
    cell.className = "cell";
    const holder = document.createElement("div");
    cell.append(holder);
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = creatures[body].released
      ? body
      : `${body} (not released)`;
    cell.append(name);
    $("grid").append(cell);
    const one = { body, view: mountBood(holder, sceneOf(body)), keys: [] };
    drawCell(one);
    gridViews.push(one);
    cell.addEventListener("click", () => {
      state.body = body;
      $("body").value = body;
      ownMoves();
      redraw({ popped: true });
      selectTab("stage");
    });
  }
}

function refs() {
  $("refs").innerHTML = BOOD_BODIES.map(
    (body) =>
      `<div class="cell"><img src="/src/creatures/${body}/reference.svg" alt="${body}" /><div class="name">${body}</div></div>`,
  ).join("");
}

function selectTab(name) {
  for (const tab of document.querySelectorAll(".tab"))
    tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  for (const id of ["stage", "grid", "refs"])
    $(`view-${id}`).hidden = id !== name;
  if (name === "grid") grid();
  if (name === "refs") refs();
}
for (const tab of document.querySelectorAll(".tab"))
  tab.addEventListener("click", () => selectTab(tab.dataset.tab));

// Reload when the package rebuilds.
new EventSource("/events").addEventListener("message", () => location.reload());

/**
 * State from the address, so a look is a link: `?body=ghost&mood=happy&facing=1&tilt=-0.5&tab=grid`.
 * Read once at start; the controls take over after.
 */
function fromQuery() {
  const query = new URLSearchParams(location.search);
  const pick = (name, values) => {
    const value = query.get(name);
    return value !== null && values.includes(value) ? value : undefined;
  };
  const number = (name) => {
    const value = Number(query.get(name));
    return query.has(name) && Number.isFinite(value)
      ? Math.max(-1, Math.min(1, value))
      : undefined;
  };
  state.body = pick("body", BOOD_BODIES) ?? state.body;
  state.mood = pick("mood", BOOD_MOODS) ?? state.mood;
  state.eyes = pick("eyes", ["dots", "bood"]) ?? state.eyes;
  state.scheme = pick("scheme", ["dark", "light"]) ?? state.scheme;
  const color = query.get("color");
  if (color === "mood" || /^#[0-9a-f]{6}$/i.test(color ?? "")) state.color = color;
  state.facing = number("facing") ?? state.facing;
  state.lift = number("lift") ?? state.lift;
  state.tilt = number("tilt") ?? state.tilt;
  if (query.get("filled") === "0") state.filled = false;
  if (query.get("brows") === "1") state.brows = true;
  if (query.get("mouthTone") === "0") state.mouthTone = false;
  const depth = Number(query.get("depth"));
  if (query.has("depth") && Number.isFinite(depth)) state.depth = Math.max(0, Math.min(0.2, depth));
  if (query.get("life") === "0") state.life = false;
  $("body").value = state.body;
  $("mood").value = state.mood;
  $("filled").checked = state.filled;
  $("brows").checked = state.brows;
  $("mouthTone").checked = state.mouthTone;
  $("depth").value = String(state.depth);
  showDepth();
  $("life").checked = state.life;
  facing.value = String(state.facing);
  lift.value = String(state.lift);
  tilt.value = String(state.tilt);
  const background = pick("bg", ["dark", "light"]);
  if (background !== undefined) setBackground(background);
  for (const button of $("eyes").querySelectorAll("button"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.eyes === state.eyes),
    );
  for (const button of $("scheme").querySelectorAll("button"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.scheme === state.scheme),
    );
  ownMoves();
  swatches();
  const tab = pick("tab", ["stage", "grid", "refs"]);
  if (tab !== undefined && tab !== "stage") selectTab(tab);
}

fromQuery();
showPose();
redraw();
