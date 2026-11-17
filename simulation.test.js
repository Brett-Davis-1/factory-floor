const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {
    value: id === "orderInput" ? "6" : "", style: {}, open: false, offsetLeft: 500, offsetTop: 300,
    listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; },
    showModal() { this.open = true; }, close() { this.open = false; }, setPointerCapture() {}
  });
  return elements.get(id);
};
const mockMath = { random: () => 0.5 };
Object.setPrototypeOf(mockMath, Math);
const context = vm.createContext({ document: { getElementById: element }, Math: mockMath });
vm.runInContext(fs.readFileSync(__dirname + "/app.js", "utf8"), context);
const read = expression => vm.runInContext(expression, context);
const rolls = [];
context.Math.random = () => rolls.length ? rolls.shift() : 0.5;
const reset = values => { read("state = freshState()"); element("orderInput").value = "6"; rolls.splice(0, rolls.length, ...values); };
const buildLine = () => read(`
  addStage(0); addStage(1); addStage(2);
  assignTask("cut", 1); assignTask("drill", 1);
  assignTask("glue", 2); assignTask("fasten", 2);
  assignTask("paint", 3); assignTask("package", 3);
  state.stages.forEach(s => s.machines[0].workers = 1);
  render();
`);

assert.equal(read("state.stages.length"), 0, "The game starts with no stations");
assert.equal(read("state.tasks.length"), 6);
assert.equal(read("criticalPath().total"), 21);
read("runDay()");
assert.equal(read("state.day"), 1, "Production waits until the process is placed");

buildLine();
assert.equal(read("state.cash"), 130, "Three stations cost $40 each");
assert.equal(read("setupIssues().length"), 0);
assert.equal(read("stageMinutes(state.stages[0])"), 9);
assert.equal(read("stageCapacity(state.stages[0])"), 4);
assert.equal(read("stageCapacity(state.stages[1])"), 4);
assert.equal(read("stageCapacity(state.stages[2])"), 6);
read("runDay()");
assert.equal(read("state.day"), 2);
assert.equal(read("state.shipped"), 4);
assert.equal(read("state.report.wages"), 12);

element("processView").listeners.click({ target: { closest: selector => selector === "[data-task]" ? { dataset: { task: "glue" } } : null } });
element("taskEditor").listeners.click({ target: { closest: selector => selector === "[data-assign]" ? { dataset: { assign: "1" } } : null } });
assert.equal(read('state.tasks.find(t => t.id === "glue").assignment'), 1, "Network task selection can move a task");
let dragged = "";
element("processView").listeners.dragstart({ target: { closest: () => ({ dataset: { task: "glue" } }) }, dataTransfer: { setData: (_, id) => { dragged = id; } } });
element("processView").listeners.drop({ target: { closest: () => ({ dataset: { dest: "2" } }) }, dataTransfer: { getData: () => dragged }, preventDefault() {} });
assert.equal(read('state.tasks.find(t => t.id === "glue").assignment'), 2, "Yamazumi drop can move a task");

read('assignTask("cut", 3)');
assert.equal(read("setupIssues().some(x => x.includes('must be at or before'))"), true, "Dependencies constrain station order");
read("runDay()");
assert.equal(read("state.day"), 2, "Invalid process order cannot run");
read('assignTask("cut", 1)');
element("processView").listeners.click({ target: { closest: selector => selector === "[data-task]" ? { dataset: { task: "drill" } } : null } });
element("taskEditor").listeners.change({ target: { id: "taskMinutes", value: "7" } });
assert.equal(read("criticalPath().total"), 23, "Edited task time updates the critical path");

reset([0.1, 0.9, 0.9, 0.4]);
buildLine();
read("runDay()");
assert.equal(read("state.day"), 1, "An event pauses production");
assert.equal(element("eventDialog").open, true);
assert.equal(read("state.pendingEvents.breakdownId"), 2);
read("state.stages[1].machines[0].workers--; state.stages[2].machines[0].workers++; render()");
assert.equal(read("state.stages[2].machines[0].workers"), 2, "A worker can move away from a broken machine before production");
read("runDay()");
assert.equal(read("state.report.machines[2].capacity"), 0);
assert.equal(read("state.report.machines[3].capacity"), 8);
assert.equal(read("state.queues[0]"), 4);

reset([0.9, 0.1, 0.9, 0.8]);
buildLine();
read("runDay()");
assert.equal(read("state.stages[2].machines[0].workers"), 0);
element("workerDetails").listeners.click({ target: { closest: selector => selector === "[data-hire]" ? {} : null } });
element("stationDetails").listeners.click({ target: { closest: selector => selector === "[data-worker]" ? { dataset: { worker: "3", delta: "1" } } : null } });
read("runDay()");
assert.equal(read("state.report.events.absentId"), 3);
assert.equal(read("state.report.machines[3].processed"), 4, "A replacement can cover the absent worker");
assert.equal(read("state.stages[2].machines[0].workers"), 2, "The absent worker returns tomorrow");

reset([0.9, 0.9, 0.1]);
buildLine();
read("runDay()");
assert.equal(read("state.day"), 2, "Bad parts alone do not pause the shift");
assert.equal(element("eventDialog").open, false, "No advance warning appears for bad parts");
assert.equal(element("reworkDialog").open, true, "Rework is announced after production");
assert.equal(read("state.report.sold"), 0);
assert.equal(read("state.report.events.reworked"), 4);
assert.equal(read("state.raw"), 10, "Bad parts return to Raw goods");
element("closeRework").listeners.click();
assert.equal(element("reworkDialog").open, false);

reset([0.1, 0.9, 0.1, 0.4]);
buildLine();
read("runDay()");
assert.equal(read("state.day"), 1, "A breakdown still pauses a shift with bad parts");
assert.doesNotMatch(element("eventNotice").innerHTML, /Bad parts|rework/i, "Rework stays unknown during replanning");
assert.doesNotMatch(element("eventList").innerHTML, /Bad parts|rework/i);
read("runDay()");
assert.equal(element("reworkDialog").open, true, "Rework is announced after the combined-event shift");
element("closeRework").listeners.click();

reset([]);
buildLine();
element("orderInput").value = "7";
read("runDay()");
assert.equal(read("state.day"), 1, "Raw purchases respect the 10-unit cap");
element("buyRawStorage").listeners.click();
assert.equal(read("state.rawCap"), 15);
assert.equal(read("state.cash"), 128);

reset([]);
buildLine();
read('addParallel(1, "below"); addParallel(2, "below")');
read("state.totalWorkers = 5; state.stages[0].machines[1].workers = 1; state.stages[1].machines[1].workers = 1");
element("orderInput").value = "10";
read("render()");
assert.equal(read("state.cash"), 50);
assert.equal(read("runBlocker().kind"), "raw");
assert.match(element("workerSummary").textContent, /Raw order 10 exceeds 6 open spaces/);
assert.match(element("runBtn").innerHTML, /Fix raw storage/);
assert.match(element("line").innerHTML, /Order needs 4 more spaces/);
assert.equal(element("runBtn").disabled, false, "The action remains clickable and explains the blocker");
element("runBtn").listeners.click();
assert.equal(element("rawDialog").open, true);
element("buyRawStorage").listeners.click();
assert.equal(read("runBlocker()"), null, "Buying five spaces clears this block");
console.log("Simulation checks passed");
