const $ = id => document.getElementById(id);
const taskSeed = [
  { id: "cut", name: "Cut", minutes: 4, predecessors: [] },
  { id: "drill", name: "Drill", minutes: 5, predecessors: [] },
  { id: "glue", name: "Glue", minutes: 6, predecessors: ["cut", "drill"] },
  { id: "fasten", name: "Fasten", minutes: 4, predecessors: ["glue"] },
  { id: "paint", name: "Paint", minutes: 3, predecessors: ["fasten"] },
  { id: "package", name: "Package", minutes: 3, predecessors: ["paint"] }
];
const shiftMinutes = 40;
const target = 30;
const lastDay = 10;
const stationCost = 40;
const upgradeCost = 35;
const wagePerWorker = 4;
const storageUnitCost = 2;
const eventChance = 0.15;
let nextMachineId = 1;
let nextStageId = 1;
const newMachine = () => ({ id: nextMachineId++, workers: 0, upgrades: 0 });
const newStage = () => ({ id: nextStageId++, machines: [newMachine()] });
function freshState() {
  nextMachineId = 1;
  nextStageId = 1;
  return { day: 1, cash: 250, raw: 4, rawCap: 10, queues: [], storageCaps: [], finished: 0, shipped: 0,
    stages: [], tasks: taskSeed.map(t => ({ ...t, predecessors: [...t.predecessors], assignment: null })),
    totalWorkers: 3, pendingEvents: null, report: null, gameOver: false };
}
let state = freshState();
let selectedMachine = null;
let selectedQueue = null;
let selectedTask = "cut";
let processView = "network";

const money = n => `$${n}`;
const order = () => Math.max(0, Math.min(100, Math.floor(Number($("orderInput").value) || 0)));
const allMachines = () => state.stages.flatMap(s => s.machines);
const workersAssigned = () => allMachines().reduce((n, m) => n + m.workers, 0);
const availableWorkers = () => state.totalWorkers - (state.pendingEvents?.absentId != null ? 1 : 0);
const stageIndex = id => state.stages.findIndex(s => s.id === id);
const tasksAt = s => state.tasks.filter(t => t.assignment === s.id);
const stageMinutes = s => tasksAt(s).reduce((n, t) => n + t.minutes, 0);
const locationOf = id => {
  for (let si = 0; si < state.stages.length; si++) {
    const mi = state.stages[si].machines.findIndex(m => m.id === id);
    if (mi >= 0) return { si, mi, stage: state.stages[si], machine: state.stages[si].machines[mi] };
  }
  return null;
};
const machineLabel = id => {
  const loc = locationOf(id);
  return loc ? `Station ${loc.si + 1}${loc.stage.machines.length > 1 ? `, machine ${loc.mi + 1}` : ""}` : "a machine";
};
function machineCapacity(m, s) {
  const minutes = stageMinutes(s);
  return m.workers && minutes ? Math.max(0, Math.floor(shiftMinutes / minutes) + 2 * m.upgrades + 2 * (m.workers - 1)) : 0;
}
const dayCapacity = (m, s) => state.pendingEvents?.breakdownId === m.id ? 0 : machineCapacity(m, s);
const stageCapacity = s => s.machines.reduce((n, m) => n + dayCapacity(m, s), 0);
const bottleneckIndex = () => state.stages.reduce((best, s, i) => stageCapacity(s) < stageCapacity(state.stages[best]) ? i : best, 0);

function criticalPath() {
  const paths = new Map();
  state.tasks.forEach(t => {
    const parents = t.predecessors.map(id => paths.get(id)).filter(Boolean);
    const best = parents.reduce((a, b) => !a || b.total > a.total ? b : a, null);
    paths.set(t.id, { total: t.minutes + (best?.total || 0), ids: [...(best?.ids || []), t.id] });
  });
  return [...paths.values()].reduce((a, b) => !a || b.total > a.total ? b : a, null);
}

function setupIssues() {
  const issues = [];
  if (!state.stages.length) issues.push("Add your first station");
  const unassigned = state.tasks.filter(t => t.assignment === null);
  if (unassigned.length) issues.push(`Place ${unassigned.length} unassigned task${unassigned.length === 1 ? "" : "s"}`);
  state.stages.forEach((s, i) => { if (!tasksAt(s).length) issues.push(`Give Station ${i + 1} a task`); });
  state.tasks.forEach(t => {
    if (t.assignment === null) return;
    t.predecessors.forEach(id => {
      const before = state.tasks.find(p => p.id === id);
      if (before?.assignment != null && stageIndex(before.assignment) > stageIndex(t.assignment))
        issues.push(`${before.name} must be at or before ${t.name}`);
    });
  });
  return issues;
}

function runBlocker() {
  const issue = setupIssues()[0];
  if (issue) return { kind: "process", message: issue, label: "Open process" };
  const openSpaces = Math.max(0, state.rawCap - state.raw);
  if (order() > openSpaces) return { kind: "raw", message: `Raw order ${order()} exceeds ${openSpaces} open spaces. Add storage or order less.`, label: "Fix raw storage" };
  if (order() * 2 > Math.max(0, state.cash)) return { kind: "raw", message: `Purchase ${money(order() * 2)} exceeds available cash ${money(state.cash)}.`, label: "Adjust purchase" };
  return null;
}

function rollEvents() {
  const breakdown = Math.random() < eventChance;
  const absence = Math.random() < eventChance;
  const badParts = Math.random() < eventChance;
  const staffed = allMachines().filter(m => m.workers > 0);
  const workerSlots = staffed.flatMap(m => Array(m.workers).fill(m.id));
  return {
    breakdownId: breakdown && staffed.length ? staffed[Math.floor(Math.random() * staffed.length)].id : null,
    absentId: absence && workerSlots.length ? workerSlots[Math.floor(Math.random() * workerSlots.length)] : null,
    badParts, reworked: 0
  };
}

function render() {
  $("dayValue").innerHTML = `${Math.min(state.day, lastDay)} <em>/ ${lastDay}</em>`;
  $("cashValue").textContent = money(state.cash);
  $("shippedValue").innerHTML = `${state.shipped} <em>/ ${target}</em>`;
  $("rawValue").textContent = state.raw;
  $("finishedValue").textContent = state.finished;
  $("workersValue").innerHTML = `${state.totalWorkers} <em>· ${money(state.totalWorkers * wagePerWorker)}/day</em>`;
  const blocker = runBlocker();
  const unassigned = state.tasks.filter(t => t.assignment === null).length;
  $("processWidgetTitle").textContent = unassigned ? `${unassigned} tasks to place` : `${state.stages.length} stations · ${criticalPath().total} min path`;
  $("canvasLabel").innerHTML = state.stages.length ? "MATERIAL FLOW <span>→</span>" : "BUILD YOUR LINE <span>→</span>";
  $("line").innerHTML = renderLine();
  $("bottleneckNote").textContent = state.stages.length ? `Station ${bottleneckIndex() + 1} · ${stageCapacity(state.stages[bottleneckIndex()])}/day` : "No stations yet";
  $("insightText").textContent = state.stages.length ? `The planned bottleneck is Station ${bottleneckIndex() + 1} at ${stageCapacity(state.stages[bottleneckIndex()])} units/day. Station time is the sum of its assigned task times; one worker can process roughly ${shiftMinutes} minutes of work per day. The process critical path is ${criticalPath().total} minutes: ${criticalPath().ids.map(id => state.tasks.find(t => t.id === id).name).join(" → ")}.` : "Start with the total process. Use Network and Yamazumi to place tasks, then build stations on the canvas.";
  const free = availableWorkers() - workersAssigned();
  $("workerSummary").textContent = blocker ? blocker.message : `${state.totalWorkers} hired · ${money(state.totalWorkers * wagePerWorker)}/day${state.pendingEvents?.absentId != null ? " · 1 absent" : free ? ` · ${free} free` : ""}`;
  $("runWidget").className = blocker ? "run-widget blocked" : "run-widget";
  $("orderCost").textContent = `Purchase: ${money(order() * 2)} · ${state.raw + order()} / ${state.rawCap} raw spaces${state.raw + order() > state.rawCap ? " · Add storage or reduce order" : ""}`;
  $("orderCost").className = state.raw + order() > state.rawCap ? "hint cost error" : "hint cost";
  $("rawStorageValue").textContent = `${state.raw} / ${state.rawCap}`;
  $("rawStorageNote").textContent = `${Math.max(0, state.rawCap - state.raw)} spaces available before purchases`;
  $("buyRawStorage").disabled = state.gameOver || state.cash < storageUnitCost;
  $("orderInput").max = Math.max(0, state.rawCap - state.raw);
  $("runBtn").disabled = state.gameOver;
  $("runBtn").innerHTML = state.gameOver ? "Game finished" : `${blocker ? blocker.label : `${state.pendingEvents ? "Complete" : "Run"} day ${state.day}`} <span>→</span>`;
  $("finishShift").disabled = state.gameOver || Boolean(blocker);
  $("reportWidgetTitle").textContent = state.report ? (state.gameOver ? (state.shipped >= target ? "Goal reached!" : "Game complete") : `Day ${state.report.day} complete`) : "Build your line";
  $("reportWidgetSub").textContent = state.report ? `${state.report.sold} shipped · open report →` : "Open report →";
  renderEvents(); renderReport(); renderWorkerDetails();
  if ($("processDialog").open) renderProcess();
  if (selectedMachine !== null && $("stationDialog").open) renderStationDetails();
  if (selectedQueue !== null && $("storageDialog").open) renderStorageDetails();
}

function renderLine() {
  const rawOverflow = Math.max(0, state.raw + order() - state.rawCap);
  const parts = [`<button class="node source ${rawOverflow ? "over-cap" : ""}" data-raw aria-label="Open raw goods purchasing"><span class="node-icon">◫</span><h3>Raw goods</h3><p>BUY MATERIAL</p><div class="number">${state.raw} / ${state.rawCap}</div><div class="sub">${rawOverflow ? `Order needs ${rawOverflow} more spaces` : `on hand · order ${order()}`}</div></button><div class="connector"></div>`];
  if (!state.stages.length) parts.push(`<button class="empty-station" data-add-stage="0" ${state.cash < stationCost ? "disabled" : ""}><span>＋</span><strong>Add first station</strong><small>${money(stationCost)} one time</small></button>`);
  state.stages.forEach((s, si) => {
    parts.push(`<div class="stage-column"><div class="stage-label">STATION ${si + 1} · ${stageMinutes(s)} MIN/UNIT</div><div class="machine-stack">${s.machines.map((m, mi) => renderMachine(m, s, si, mi)).join("")}</div></div>`);
    if (si < state.stages.length - 1) parts.push(renderQueue(si));
  });
  if (state.stages.length) parts.push(`<div class="connector"></div><button class="end-add" data-add-stage="${state.stages.length}" ${state.cash < stationCost ? "disabled" : ""} title="Add station for ${money(stationCost)}">＋<small>station</small></button>`);
  parts.push(`<div class="connector"></div><div class="node sink"><span class="node-icon">↗</span><h3>Shipping</h3><p>FINISHED GOODS</p><div class="number">${state.finished}</div><div class="sub">ready to sell</div></div>`);
  return parts.join("");
}

function renderMachine(m, s, si, mi) {
  const selected = selectedMachine === m.id;
  const plan = dayCapacity(m, s);
  const last = state.report?.machines[m.id];
  const taskNames = tasksAt(s).map(t => t.name);
  return `<div class="machine-wrap ${selected ? "selected" : ""}">
    ${selected && !state.gameOver ? `<button class="add-icon add-up" data-add="above" data-id="${m.id}" title="Duplicate above · ${money(stationCost)}" ${state.cash < stationCost ? "disabled" : ""}>+</button><button class="add-icon add-down" data-add="below" data-id="${m.id}" title="Duplicate below · ${money(stationCost)}" ${state.cash < stationCost ? "disabled" : ""}>+</button><button class="add-icon add-left" data-add="left" data-id="${m.id}" title="Add station left · ${money(stationCost)}" ${state.cash < stationCost ? "disabled" : ""}>+</button><button class="add-icon add-right" data-add="right" data-id="${m.id}" title="Add station right · ${money(stationCost)}" ${state.cash < stationCost ? "disabled" : ""}>+</button><span class="build-cost">New station ${money(stationCost)}</span>` : ""}
    <button class="node station ${si === bottleneckIndex() ? "bottleneck" : ""}" data-select="${m.id}" aria-pressed="${selected}" aria-label="Select Station ${si + 1}"><div class="node-head"><span class="node-icon">▦</span>${si === bottleneckIndex() ? '<span class="node-tag">SLOWEST STEP</span>' : ""}</div><h3>Station ${si + 1}${s.machines.length > 1 ? ` · ${mi + 1}` : ""}</h3><p>${taskNames.length ? taskNames.join(" · ") : "NO TASKS YET"}</p><div class="number">${plan}/day</div><div class="sub">${state.pendingEvents?.breakdownId === m.id ? "BROKEN TODAY" : `${m.workers} worker${m.workers === 1 ? "" : "s"} · range ${m.workers && taskNames.length ? Math.max(1, plan - 2) : 0}–${m.workers && taskNames.length ? plan + 2 : 0}`}</div>${last ? `<div class="last-shift">Last: ${last.capacity}/day · made ${last.processed}</div>` : ""}</button>
    ${selected ? `<button class="manage-icon" data-manage="${m.id}" aria-label="Manage Station ${si + 1}" title="Workers and upgrade">⚙</button>` : ""}
  </div>`;
}

function renderQueue(i) {
  const count = state.queues[i], cap = state.storageCaps[i];
  const tokens = Array.from({ length: Math.min(count, 8) }, () => '<span class="wip-unit"></span>').join("");
  return `<div class="queue-link"><div class="queue-arrow">→</div><button class="queue-box ${count ? "has-wip" : ""} ${count >= cap ? "full" : ""}" data-queue="${i}" aria-label="Open WIP storage after Station ${i + 1}, ${count} of ${cap} units"><span>${count >= cap ? "FULL" : "WAITING"}</span><div class="queue-units">${tokens || '<i class="queue-empty">empty</i>'}</div><strong>${count} / ${cap} WIP</strong><small>+ storage</small></button></div>`;
}

function renderStationDetails() {
  const loc = locationOf(selectedMachine);
  if (!loc) return;
  const { machine: m, stage: s, si } = loc;
  const free = availableWorkers() - workersAssigned();
  const plan = dayCapacity(m, s);
  const last = state.report?.machines[m.id];
  $("stationTitle").textContent = `Station ${si + 1}`;
  $("stationDetails").innerHTML = `<div class="station-summary"><span>ASSIGNED WORK</span><strong>${stageMinutes(s)} min/unit</strong><small>${tasksAt(s).map(t => t.name).join(" → ") || "No tasks assigned. Open Total process to place some."}</small></div><p class="hint">40-minute shift · planned capacity ${plan}/day${state.pendingEvents?.breakdownId === m.id ? " · BROKEN TODAY" : ""}</p>${last ? `<p class="station-last">Last shift: capacity <strong>${last.capacity}/day</strong>; processed <strong>${last.processed}</strong> units.</p>` : ""}<div class="worker-row"><div><label>Workers assigned</label><small>Each extra worker adds 2/day</small></div><div class="stepper"><button data-worker="${m.id}" data-delta="-1" ${m.workers === 0 || state.gameOver ? "disabled" : ""}>−</button><span>${m.workers}</span><button data-worker="${m.id}" data-delta="1" ${free === 0 || state.gameOver ? "disabled" : ""}>+</button></div></div><p class="hint">${free} available today. Hire more through Workers at ${money(wagePerWorker)} per day each.</p><div class="divider"></div><div class="upgrade-row"><div class="upgrade-name">Machine level ${m.upgrades}<small>+2/day per upgrade</small></div><button data-upgrade="${m.id}" ${state.cash < upgradeCost || state.gameOver ? "disabled" : ""}>Upgrade · ${money(upgradeCost)}</button></div><button class="storage-upgrade" data-edit-tasks>Edit tasks in Network / Yamazumi</button>`;
}

function renderStorageDetails() {
  const i = selectedQueue;
  if (i === null || i >= state.queues.length) return;
  $("storageTitle").textContent = `Station ${i + 1} → ${i + 2}`;
  $("storageDetails").innerHTML = `<div class="station-summary"><span>QUEUE CAPACITY</span><strong>${state.queues[i]} / ${state.storageCaps[i]}</strong><small>${state.queues[i] >= state.storageCaps[i] ? "Full: upstream output is blocked until space opens." : `${state.storageCaps[i] - state.queues[i]} spaces open for new WIP.`}</small></div><p>Each extra unit of storage costs <strong>${money(storageUnitCost)} once</strong>. Stored WIP still costs $1 per unit each day.</p><button class="primary" id="buyStorage" ${state.cash < storageUnitCost || state.gameOver ? "disabled" : ""}>Add 1 WIP space · ${money(storageUnitCost)} <span>+</span></button>`;
}

function renderWorkerDetails() {
  const free = availableWorkers() - workersAssigned();
  $("workerDetails").innerHTML = `<div class="station-summary"><span>HIRED WORKERS</span><strong>${state.totalWorkers}</strong><small>${workersAssigned()} working · ${free} available${state.pendingEvents?.absentId != null ? " · 1 absent today" : ""}</small></div><p>Each hired worker costs <strong>${money(wagePerWorker)} every day</strong>, even when unassigned or absent. Payroll is deducted after each shift.</p><p>Hiring is free upfront. Assign workers by opening a station's gear.</p><div class="workforce-actions"><button data-hire ${state.gameOver ? "disabled" : ""}>Hire 1 worker</button><button data-release ${free === 0 || state.gameOver ? "disabled" : ""}>Release 1 unassigned worker</button></div><p class="payroll-note">Next shift payroll: <strong>${money(state.totalWorkers * wagePerWorker)}</strong></p>`;
}

function taskButton(t, style = "") {
  const assigned = t.assignment == null ? "Unassigned" : `Station ${stageIndex(t.assignment) + 1}`;
  return `<button class="process-task ${selectedTask === t.id ? "active" : ""}" data-task="${t.id}" draggable="true" ${style}><strong>${t.name}</strong><small>${t.minutes} min · ${assigned}</small></button>`;
}

function renderProcess() {
  $("networkTab").className = processView === "network" ? "active" : "";
  $("yamazumiTab").className = processView === "yamazumi" ? "active" : "";
  const cp = criticalPath();
  if (processView === "network") {
    const task = id => taskButton(state.tasks.find(t => t.id === id));
    $("processView").innerHTML = `<div class="process-facts"><span>Critical path <strong>${cp.total} min</strong></span><span>${cp.ids.map(id => state.tasks.find(t => t.id === id).name).join(" → ")}</span></div><div class="network-flow"><div class="network-start">Raw goods</div><div class="network-arrow">→</div><div class="network-branch">${task("cut")}${task("drill")}</div><div class="network-join">↘<br>↗</div>${["glue", "fasten", "paint", "package"].map(id => `${task(id)}${id === "package" ? "" : '<div class="network-arrow">→</div>'}`).join("")}<div class="network-arrow">→</div><div class="network-start">Ship</div></div><p class="process-hint">Cut and Drill can occur in either order. Both must finish before Glue.</p>`;
  } else {
    const columns = [{ id: "unassigned", name: "Unassigned", tasks: state.tasks.filter(t => t.assignment == null), minutes: 0 }, ...state.stages.map((s, i) => ({ id: String(s.id), name: `Station ${i + 1}`, tasks: tasksAt(s), minutes: stageMinutes(s), capacity: stageCapacity(s) }))];
    $("processView").innerHTML = `<div class="process-facts"><span>Yamazumi · minutes of work per unit</span><span>40-minute shift · critical path <strong>${cp.total} min</strong></span></div><div class="yamazumi-board">${columns.map(c => `<div class="yama-column" data-dest="${c.id}"><div class="yama-title"><strong>${c.name}</strong><small>${c.id === "unassigned" ? `${c.tasks.length} tasks` : `${c.minutes} min · ${c.capacity}/day`}</small></div><div class="yama-stack">${c.tasks.map(t => taskButton(t, `style="min-height:${Math.max(34, t.minutes * 12)}px"`)).join("") || '<div class="yama-empty">Drop tasks here</div>'}</div></div>`).join("")}</div>`;
  }
  const t = state.tasks.find(x => x.id === selectedTask) || state.tasks[0];
  const invalid = setupIssues().filter(x => x.includes("must be at or before"));
  $("taskEditor").innerHTML = `<div class="task-editor-head"><div><span class="eyebrow">SELECTED TASK</span><h3>${t.name}</h3><small>After ${t.predecessors.map(id => state.tasks.find(p => p.id === id).name).join(" + ") || "Raw goods"}</small></div><label>Minutes / unit<input id="taskMinutes" type="number" min="1" max="40" value="${t.minutes}"></label></div><div class="assignment-row"><span>Place at</span><button data-assign="unassigned" ${t.assignment == null ? 'aria-pressed="true"' : ""}>Unassigned</button>${state.stages.map((s, i) => `<button data-assign="${s.id}" ${t.assignment === s.id ? 'aria-pressed="true"' : ""}>Station ${i + 1}</button>`).join("")}<button data-add-stage="${state.stages.length}" ${state.cash < stationCost || state.gameOver ? "disabled" : ""}>+ Station ${money(stationCost)}</button></div>${invalid.length ? `<p class="process-error">${invalid[0]}</p>` : ""}`;
}

function renderEvents() {
  if (state.pendingEvents) {
    const list = pendingEventDescriptions(state.pendingEvents);
    $("eventTitle").textContent = `${list.length} event${list.length === 1 ? "" : "s"} today · plan paused`;
    $("eventList").innerHTML = `<ul>${list.map(item => `<li>${item}</li>`).join("")}</ul>`;
    $("eventWidget").className = "event-widget active";
    return;
  }
  const r = state.report;
  if (!r) {
    $("eventTitle").textContent = "No shift run yet";
    $("eventList").textContent = "Each event has a 15% chance every day.";
    $("eventWidget").className = "event-widget";
    return;
  }
  const list = r.eventDescriptions;
  $("eventTitle").textContent = list.length ? `${list.length} event${list.length === 1 ? "" : "s"} on day ${r.day}` : `Day ${r.day}: no event`;
  $("eventList").innerHTML = list.length ? `<ul>${list.map(item => `<li>${item}</li>`).join("")}</ul>` : "The shift ran without a random event.";
  $("eventWidget").className = list.length ? "event-widget active" : "event-widget";
}
function pendingEventDescriptions(events) {
  const list = [];
  if (events.breakdownId !== null) list.push(`${machineLabel(events.breakdownId)} is broken for this shift.`);
  if (events.absentId !== null) list.push(`One ${machineLabel(events.absentId)} worker is absent. Reassign the remaining workers if useful.`);
  return list;
}
function showEventNotice() {
  $("eventNotice").innerHTML = `<p>Production is paused. Adjust workers, tasks, purchases, machines, or storage if useful; today's breakdown and absence will stay the same.</p><ul>${pendingEventDescriptions(state.pendingEvents).map(item => `<li>${item}</li>`).join("")}</ul>`;
  $("eventDialog").showModal();
}
function renderReport() {
  if (!state.report) {
    $("reportTitle").textContent = "Build your line";
    $("reportText").textContent = "Add stations and place all six tasks to begin.";
    $("reportStats").innerHTML = "";
    $("reportEvents").textContent = "No events yet. Each type has a 15% chance per day.";
    return;
  }
  const r = state.report;
  $("reportTitle").textContent = state.gameOver ? (state.shipped >= target ? "Goal reached!" : "Ten days complete") : `Day ${r.day} complete`;
  $("reportText").textContent = state.gameOver ? `You shipped ${state.shipped} units in 10 days. ${state.shipped >= target ? "Your factory met the target." : "Try balancing task times across stations."}` : `${r.sold} units shipped. Inventory cost ${money(r.holding)}; payroll ${money(r.wages)}. ${r.blockedQueues.length ? `${r.blockedQueues.length} full WIP queue blocked upstream work.` : r.variation}`;
  $("reportEvents").innerHTML = r.eventDescriptions.length ? `<ul>${r.eventDescriptions.map(item => `<li>${item}</li>`).join("")}</ul>` : "No random event this shift.";
  $("reportStats").innerHTML = [["Bought", r.bought], ["Made", r.made], ["Shipped", r.sold], ["Demand", r.demand], ["Payroll", money(r.wages)], ["Net cash", `${r.net >= 0 ? "+" : ""}${money(r.net)}`]].map(([label, value]) => `<div class="report-stat">${label}<strong>${value}</strong></div>`).join("");
}

function runDay() {
  if (state.gameOver || setupIssues().length || order() * 2 > Math.max(0, state.cash) || state.raw + order() > state.rawCap) return;
  if (!state.pendingEvents) {
    const events = rollEvents();
    state.pendingEvents = events;
    if (events.absentId !== null) locationOf(events.absentId).machine.workers--;
    if (events.breakdownId !== null || events.absentId !== null) { render(); showEventNotice(); return; }
  }
  completeDay();
}
function completeDay() {
  const oldCash = state.cash, bought = order(), events = state.pendingEvents;
  state.cash -= bought * 2;
  state.raw += bought;
  const outcomes = {}, blockedQueues = new Set();
  let made = 0, belowPlan = false;
  state.stages.forEach((s, si) => s.machines.forEach(m => {
    const plan = machineCapacity(m, s);
    const actual = events.breakdownId === m.id || !m.workers || !tasksAt(s).length ? 0 : Math.max(1, plan + Math.floor(Math.random() * 5) - 2);
    if (actual < plan) belowPlan = true;
    const available = si === 0 ? state.raw : state.queues[si - 1];
    const outputRoom = si === state.stages.length - 1 ? Infinity : state.storageCaps[si] - state.queues[si];
    const processed = Math.min(available, actual, outputRoom);
    if (outputRoom < Math.min(available, actual)) blockedQueues.add(si);
    if (si === 0) state.raw -= processed; else state.queues[si - 1] -= processed;
    if (si === state.stages.length - 1) { state.finished += processed; made += processed; }
    else state.queues[si] += processed;
    outcomes[m.id] = { capacity: actual, processed };
  }));
  const demand = 5 + (state.day * 3) % 5;
  const dueToShip = Math.min(state.finished, demand);
  const sold = events.badParts ? 0 : dueToShip;
  state.finished -= dueToShip;
  let emergencyStorageCost = 0;
  if (events.badParts) {
    state.raw += dueToShip; events.reworked = dueToShip;
    while (state.raw > state.rawCap) { state.rawCap += 5; emergencyStorageCost += storageUnitCost; }
    state.cash -= emergencyStorageCost;
  }
  state.shipped += sold;
  state.cash += sold * 10;
  const holding = state.raw + state.queues.reduce((a, b) => a + b, 0) + state.finished;
  state.cash -= holding;
  const wages = state.totalWorkers * wagePerWorker;
  state.cash -= wages;
  const eventDescriptions = [];
  if (events.breakdownId !== null) eventDescriptions.push(`Breakdown: ${machineLabel(events.breakdownId)} could not run today.`);
  if (events.absentId !== null) eventDescriptions.push(`Absent employee: ${machineLabel(events.absentId)} lost one worker today.`);
  if (events.badParts) eventDescriptions.push(`Bad parts: ${events.reworked} unit${events.reworked === 1 ? "" : "s"} due to ship went back to Raw goods for rework.`);
  if (emergencyStorageCost) eventDescriptions.push(`Returns required ${money(emergencyStorageCost)} of extra Raw goods storage.`);
  state.report = { day: state.day, bought, made, sold, demand, holding, wages, emergencyStorageCost, blockedQueues: [...blockedQueues], net: state.cash - oldCash, machines: outcomes, events, eventDescriptions, variation: belowPlan ? "At least one machine ran below plan." : "All staffed machines met or beat plan." };
  state.pendingEvents = null;
  if (events.absentId !== null) locationOf(events.absentId).machine.workers++;
  state.day++;
  state.gameOver = state.day > lastDay;
  if ($("eventDialog").open) $("eventDialog").close();
  render();
  if (events.badParts) {
    $("reworkNotice").textContent = events.reworked
      ? `${events.reworked} unit${events.reworked === 1 ? " was" : "s were"} due to ship, but failed inspection. They returned to Raw goods for rework. Nothing shipped from those units today.`
      : "Bad parts were found, but no units were due to ship today. No units needed rework.";
    $("reworkDialog").showModal();
  }
}

function addStage(index) {
  if (state.gameOver || state.cash < stationCost) return;
  const previousCount = state.stages.length;
  state.cash -= stationCost;
  state.stages.splice(index, 0, newStage());
  if (previousCount) { state.queues.splice(index, 0, 0); state.storageCaps.splice(index, 0, 5); }
  selectedMachine = null;
  render();
}
function addParallel(id, direction) {
  const loc = locationOf(id);
  if (!loc || state.gameOver || state.cash < stationCost) return;
  state.cash -= stationCost;
  loc.stage.machines.splice(loc.mi + (direction === "below" ? 1 : 0), 0, newMachine());
  selectedMachine = null;
  render();
}
function assignTask(id, destination) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || state.gameOver) return;
  t.assignment = destination === "unassigned" ? null : Number(destination);
  selectedTask = id;
  render();
}

$("line").addEventListener("click", e => {
  const stageButton = e.target.closest("[data-add-stage]");
  if (stageButton) { addStage(Number(stageButton.dataset.addStage)); return; }
  const add = e.target.closest("[data-add]");
  if (add) {
    const loc = locationOf(Number(add.dataset.id));
    if (!loc) return;
    if (["above", "below"].includes(add.dataset.add)) addParallel(loc.machine.id, add.dataset.add);
    else addStage(loc.si + (add.dataset.add === "right" ? 1 : 0));
    return;
  }
  const manage = e.target.closest("[data-manage]");
  if (manage) { selectedMachine = Number(manage.dataset.manage); renderStationDetails(); $("stationDialog").showModal(); return; }
  const queue = e.target.closest("[data-queue]");
  if (queue) { selectedQueue = Number(queue.dataset.queue); renderStorageDetails(); $("storageDialog").showModal(); return; }
  if (e.target.closest("[data-raw]")) { $("rawDialog").showModal(); return; }
  const select = e.target.closest("[data-select]");
  if (select) { selectedMachine = selectedMachine === Number(select.dataset.select) ? null : Number(select.dataset.select); render(); }
});
$("stationDetails").addEventListener("click", e => {
  if (e.target.closest("[data-edit-tasks]")) { $("stationDialog").close(); renderProcess(); $("processDialog").showModal(); return; }
  const worker = e.target.closest("[data-worker]");
  if (worker && !state.gameOver) {
    const loc = locationOf(Number(worker.dataset.worker)), delta = Number(worker.dataset.delta);
    if (loc && (delta < 0 ? loc.machine.workers > 0 : workersAssigned() < availableWorkers())) { loc.machine.workers += delta; render(); }
  }
  const upgrade = e.target.closest("[data-upgrade]");
  if (upgrade && !state.gameOver && state.cash >= upgradeCost) {
    const loc = locationOf(Number(upgrade.dataset.upgrade));
    if (loc) { state.cash -= upgradeCost; loc.machine.upgrades++; render(); }
  }
});
$("workerDetails").addEventListener("click", e => {
  if (state.gameOver) return;
  if (e.target.closest("[data-hire]")) { state.totalWorkers++; render(); }
  if (e.target.closest("[data-release]") && availableWorkers() > workersAssigned()) { state.totalWorkers--; render(); }
});
$("buyRawStorage").addEventListener("click", () => { if (state.gameOver || state.cash < storageUnitCost) return; state.cash -= storageUnitCost; state.rawCap += 5; render(); });
$("storageDetails").addEventListener("click", e => { if (!e.target.closest("#buyStorage") || selectedQueue === null || state.gameOver || state.cash < storageUnitCost) return; state.cash -= storageUnitCost; state.storageCaps[selectedQueue]++; render(); });
$("processView").addEventListener("click", e => { const task = e.target.closest("[data-task]"); if (task) { selectedTask = task.dataset.task; renderProcess(); } });
$("processView").addEventListener("dragstart", e => { const task = e.target.closest("[data-task]"); if (task) e.dataTransfer.setData("text/plain", task.dataset.task); });
$("processView").addEventListener("dragover", e => { if (e.target.closest("[data-dest]")) e.preventDefault(); });
$("processView").addEventListener("drop", e => { const dest = e.target.closest("[data-dest]"); if (dest) { e.preventDefault(); assignTask(e.dataTransfer.getData("text/plain"), dest.dataset.dest); } });
$("taskEditor").addEventListener("click", e => {
  const assign = e.target.closest("[data-assign]"); if (assign) { assignTask(selectedTask, assign.dataset.assign); return; }
  const add = e.target.closest("[data-add-stage]"); if (add) addStage(Number(add.dataset.addStage));
});
$("taskEditor").addEventListener("change", e => { if (e.target.id === "taskMinutes") { const t = state.tasks.find(x => x.id === selectedTask); t.minutes = Math.max(1, Math.min(40, Math.floor(Number(e.target.value) || 1))); render(); } });
$("networkTab").addEventListener("click", () => { processView = "network"; renderProcess(); });
$("yamazumiTab").addEventListener("click", () => { processView = "yamazumi"; renderProcess(); });
$("orderInput").addEventListener("input", render);
$("runBtn").addEventListener("click", () => {
  if (state.gameOver) return;
  const blocker = runBlocker();
  if (blocker?.kind === "raw") { $("rawDialog").showModal(); return; }
  if (blocker?.kind === "process") { renderProcess(); $("processDialog").showModal(); return; }
  runDay();
});
$("adjustPlan").addEventListener("click", () => $("eventDialog").close());
$("finishShift").addEventListener("click", runDay);
$("resetBtn").addEventListener("click", () => { state = freshState(); selectedMachine = null; selectedQueue = null; selectedTask = "cut"; processView = "network"; ["stationDialog", "workerDialog", "storageDialog", "rawDialog", "reportDialog", "insightDialog", "helpDialog", "processDialog", "eventDialog", "reworkDialog"].forEach(id => $(id).close()); $("orderInput").value = 6; $("line").style.left = ""; $("line").style.top = ""; render(); });
[["helpBtn", "helpDialog"], ["reportBtn", "reportDialog"], ["insightBtn", "insightDialog"], ["workersBtn", "workerDialog"], ["processBtn", "processDialog"]].forEach(([button, dialog]) => $(button).addEventListener("click", () => { if (dialog === "processDialog") renderProcess(); $(dialog).showModal(); }));
[["closeHelp", "helpDialog"], ["closeRaw", "rawDialog"], ["closeStation", "stationDialog"], ["closeWorkers", "workerDialog"], ["closeStorage", "storageDialog"], ["closeReport", "reportDialog"], ["closeInsight", "insightDialog"], ["closeProcess", "processDialog"], ["closeRework", "reworkDialog"]].forEach(([button, dialog]) => $(button).addEventListener("click", () => $(dialog).close()));

let pointer = null;
$("board").addEventListener("pointerdown", e => { if (e.target.closest("button,dialog,input,.workspace-top,.workspace-stats,.workspace-bottom")) return; pointer = { x: e.clientX, y: e.clientY, left: $("line").offsetLeft, top: $("line").offsetTop }; $("board").setPointerCapture(e.pointerId); });
$("board").addEventListener("pointermove", e => { if (!pointer) return; $("line").style.left = `${Math.max(-3000, Math.min(3000, pointer.left + e.clientX - pointer.x))}px`; $("line").style.top = `${Math.max(-2000, Math.min(2000, pointer.top + e.clientY - pointer.y))}px`; });
$("board").addEventListener("pointerup", () => { pointer = null; });
$("board").addEventListener("pointercancel", () => { pointer = null; });
render();
