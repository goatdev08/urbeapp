// Repara el daño de `task-master update-subtask` / `update-task`:
// ambos re-tipan todos los task.id de string -> int (memoria: taskmaster_update_task_regenerates).
// Invariante que se repara: task.id = string.
// NO tocar subtask.dependencies: admite int (hermana) Y string ("5.9", "14.8" = cross-task).
// Normalizarlas destruye las referencias cruzadas y validate-dependencies NO lo detecta.
import fs from 'node:fs';

const PATH = '.taskmaster/tasks/tasks.json';
const data = JSON.parse(fs.readFileSync(PATH, 'utf8'));
const tasks = data.master.tasks;

let fixed_ids = 0;
let fixed_deps = 0;
let fixed_sub_ids = 0;

for (const t of tasks) {
  if (typeof t.id !== 'string') { t.id = String(t.id); fixed_ids++; }
  if (Array.isArray(t.dependencies)) {
    t.dependencies = t.dependencies.map((d) => {
      if (typeof d !== 'string') { fixed_deps++; return String(d); }
      return d;
    });
  }
  for (const s of t.subtasks ?? []) {
    if (!Number.isInteger(s.id) && /^\d+$/.test(String(s.id))) {
      s.id = Number(s.id);
      fixed_sub_ids++;
    }
  }
}

if (fixed_ids || fixed_deps || fixed_sub_ids) {
  fs.writeFileSync(PATH, `${JSON.stringify(data, null, 2)}\n`);
}
console.log(
  `reparados: task.id=${fixed_ids} task.deps=${fixed_deps} subtask.id=${fixed_sub_ids}` +
    ` | tasks=${tasks.length}`,
);
