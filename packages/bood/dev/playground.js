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
  bodyColor,
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
  brows: true,
  mouth: true,
  detail: true,
  eyes: "dots",
  facing: 0,
  lift: 0,
  tilt: 0,
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
  });
const color = () => state.color ?? bodyColor(state.mood, state.scheme);

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

/** Turns the head; the tilt is the slider's, whatever the look. */
function setPose(facing, lift, ms = 260) {
  const tilt = state.tilt;
  const from = {
    facing: state.posed?.facing ?? 0,
    lift: state.posed?.lift ?? 0,
    tilt: state.posed?.tilt ?? 0,
  };
  state.posed = { facing, lift, tilt };
  run(pose(state.body, state.mood, { facing, lift, tilt }, from, ms), "pose");
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

function swatches() {
  $("colors").innerHTML =
    `<button class="mood-color" data-color="" aria-pressed="${state.color === null}">mood</button>` +
    BOOD_COLORS.map(
      (one) =>
        `<button style="background:${one}" data-color="${one}" aria-pressed="${state.color === one}" title="${one}"></button>`,
    ).join("");
}
$("colors").addEventListener("click", (event) => {
  const value = event.target.dataset?.color;
  if (value === undefined) return;
  state.color = value === "" ? null : value;
  swatches();
  redraw();
});
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
for (const id of ["filled", "brows", "mouth", "detail"]) {
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
  document.body.dataset.scheme = value;
  redraw();
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
    facing.value = String(f);
    lift.value = String(l);
    showPose();
    setPose(f, l, 120);
  });
});
document.documentElement.addEventListener("pointerleave", () => {
  if (!$("follow").checked) return;
  state.following = false;
  facing.value = "0";
  lift.value = "0";
  showPose();
  setPose(0, 0, 400);
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
  state.color = pick("color", BOOD_COLORS) ?? state.color;
  state.facing = number("facing") ?? state.facing;
  state.lift = number("lift") ?? state.lift;
  state.tilt = number("tilt") ?? state.tilt;
  if (query.get("filled") === "0") state.filled = false;
  if (query.get("life") === "0") state.life = false;
  $("body").value = state.body;
  $("mood").value = state.mood;
  $("filled").checked = state.filled;
  $("life").checked = state.life;
  facing.value = String(state.facing);
  lift.value = String(state.lift);
  tilt.value = String(state.tilt);
  document.body.dataset.scheme = state.scheme;
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
