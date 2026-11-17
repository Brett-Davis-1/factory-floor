# Factory Floor

A dependency-free manufacturing simulation. Open `index.html` in a browser to play.

## Starting process

The game starts with **no stations** and an editable six-task process based on the supplied sketch:

| Task | Minutes per unit | Must follow |
| --- | ---: | --- |
| Cut | 4 | Raw goods |
| Drill | 5 | Raw goods |
| Glue | 6 | Cut and Drill |
| Fasten | 4 | Glue |
| Paint | 3 | Fasten |
| Package | 3 | Paint |

The times are starter values because the sketch does not specify durations. Open **Total process** to edit them. The Network view shows dependencies and the critical path. The Yamazumi view stacks assigned task time by station. Click a task and choose a station in either view, or drag tasks between Yamazumi columns. A task's predecessors must be at the same or an earlier station. Every task must be assigned before production can run.

## Line and economy

The player starts with $250 and three hired but unassigned workers. Build stations for $40 each and assign work and workers. A station's planned daily capacity uses a 40-minute shift divided by its total task time. Extra workers and $35 upgrades each add 2 units per day to that station's machine. The goal is to ship 30 units in ten days.

Workers cost $4 per day even when unassigned. Raw goods storage starts at 10 units; 5 extra spaces cost $2. Each queue between stations starts with 5 WIP spaces; each extra space costs $2. A full queue blocks upstream output. Every unit of inventory costs $1 per day. Finished goods sell for $10 per unit, up to daily demand.

Each day independently rolls a 15% chance for a machine breakdown, an employee absence, and bad parts. Breakdowns and absences pause before production so the player can adjust the plan. Bad parts are revealed after the shift and return everything due to ship that day to Raw goods for rework. If those returns exceed raw capacity, the game automatically adds storage at the normal $2 per 5 spaces and reports the cost.

Run `node simulation.test.js` to check process setup, task movement, capacity, costs, and events.

