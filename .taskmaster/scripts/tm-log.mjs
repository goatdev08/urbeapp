#!/usr/bin/env node
// tm-log — reemplazo VERBATIM de `task-master update-subtask` / `update-task`.
//
// POR QUÉ EXISTE (decisión de Abraham, 2026-08-18):
//   `update-subtask` manda el texto a un modelo que lo PARAFRASEA antes de guardarlo.
//   El 2026-08-17 escribió "FASE RED COMPLETA ... FALLA (10/13 casos)" cuando el archivo
//   de test todavía no existía: inventó un resultado de verificación en la bitácora.
//   Además re-tipa todos los task.id de string -> int (memoria: taskmaster_update_task_regenerates),
//   lo que obligaba a correr repair-ids.mjs después de CADA llamada.
//   Este script escribe el texto tal cual, byte por byte, y no toca ningún id.
//
// FORMATO: idéntico al de update-subtask, para que `task-master show` lo renderice igual:
//   \n<info added on ISO>\n<texto>\n</info added on ISO>
//
// USO:
//   node .taskmaster/scripts/tm-log.mjs --id=170.2 --file=/ruta/nota.md
//   cat nota.md | node .taskmaster/scripts/tm-log.mjs --id=170
//   ... --dry-run   (no escribe; muestra qué haría)
//
// GARANTÍAS: respaldo .bak, verificación de round-trip verbatim (aborta si el texto
// guardado no es idéntico al de entrada) y validación de los invariantes del esquema.

import fs from 'node:fs';

const PATH = '.taskmaster/tasks/tasks.json';
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/s);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const target = args.id;
if (!target || target === true) {
  console.error('ERROR: falta --id=<tarea> o --id=<tarea>.<subtarea>');
  process.exit(1);
}

const text = (args.file ? fs.readFileSync(args.file, 'utf8') : fs.readFileSync(0, 'utf8')).replace(
  /\s+$/,
  '',
);
if (!text) {
  console.error('ERROR: texto vacío (usa --file=<ruta> o pásalo por stdin)');
  process.exit(1);
}
// Rechaza SOLO delimitadores reales (los que llevan timestamp), no la mención documental.
if (/<\/?info added on \d{4}-/.test(text)) {
  console.error('ERROR: el texto ya trae bloques <info added on YYYY-...>; pásalo limpio');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(PATH, 'utf8'));
const tasks = data.master.tasks;

const [task_id, sub_id] = String(target).split('.');
const task = tasks.find((t) => String(t.id) === task_id);
if (!task) {
  console.error(`ERROR: no existe la tarea #${task_id}`);
  process.exit(1);
}
let node = task;
if (sub_id !== undefined) {
  node = (task.subtasks ?? []).find((s) => String(s.id) === sub_id);
  if (!node) {
    console.error(`ERROR: no existe la subtarea ${task_id}.${sub_id}`);
    process.exit(1);
  }
}

const ts = new Date().toISOString();
const block = `\n<info added on ${ts}>\n${text}\n</info added on ${ts}>`;
const before = node.details ?? '';
const after = before + block;

if (args['dry-run']) {
  console.log(`[dry-run] ${target} · details ${before.length} -> ${after.length} (+${block.length})`);
  console.log(block);
  process.exit(0);
}

node.details = after;
node.updatedAt = ts;
if (node !== task) task.updatedAt = ts;

// Invariantes del esquema (CLAUDE.md §4): task.id string, subtask.id int.
// No se normalizan subtask.dependencies: admiten int (hermana) y string ("5.9" cross-task).
for (const t of tasks) {
  if (typeof t.id !== 'string') throw new Error(`invariante roto: task.id no es string (${t.id})`);
  for (const s of t.subtasks ?? []) {
    if (!Number.isInteger(s.id)) throw new Error(`invariante roto: subtask.id no es int (${t.id}.${s.id})`);
  }
}

fs.copyFileSync(PATH, `${PATH}.bak`);
fs.writeFileSync(PATH, `${JSON.stringify(data, null, 2)}\n`);

// Round-trip: releer del disco y comprobar que el texto quedó IDÉNTICO al de entrada.
const reread = JSON.parse(fs.readFileSync(PATH, 'utf8'));
const rt_task = reread.master.tasks.find((t) => String(t.id) === task_id);
const rt = sub_id === undefined ? rt_task : rt_task.subtasks.find((s) => String(s.id) === sub_id);
const saved = rt.details.slice(-block.length);
if (saved !== block) {
  fs.copyFileSync(`${PATH}.bak`, PATH);
  console.error('ERROR: el texto guardado NO es idéntico al de entrada. Revertido desde .bak.');
  process.exit(1);
}

console.log(`ok ${target} · +${text.length} chars verbatim · details ${before.length} -> ${rt.details.length} · ${ts}`);
