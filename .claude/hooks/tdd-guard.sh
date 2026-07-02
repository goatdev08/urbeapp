#!/usr/bin/env bash
# TDD guard (PreToolUse) — versión PRAGMÁTICA para Urbea.
# Bloquea editar lógica CRÍTICA antes de que existan sus tests, SOLO cuando hay una
# subtarea crítica activa. Las rutas CRÍTICAS = regla determinista por path (CLAUDE.md §5):
# supabase/functions, supabase/migrations, y lógica móvil pura (lib/, hooks/, utils/, validation).
# Sentinel: .taskmaster/.current-red (lo crea /tm-tarea al abrir una subtarea CRÍTICA;
# se borra al cerrarla). La UI de presentación (components/**, pantallas, estilos) nunca se bloquea.

set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0   # sin jq: fail-open, no brickear el flujo

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

case "$TOOL_NAME" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac
[ -z "$FILE_PATH" ] && exit 0

# Solo guarda rutas CRÍTICAS (regla determinista por path = CLAUDE.md §5).
# Todo lo demás (mobile presentación, docs, wiki, config) pasa.
case "$FILE_PATH" in
  */supabase/functions/*|supabase/functions/*) ;;          # Edge Functions
  */supabase/migrations/*|supabase/migrations/*) ;;        # migraciones/RLS/constraints
  */mobile/*/lib/*|mobile/*/lib/*) ;;                       # lógica móvil pura
  */mobile/*/hooks/*|mobile/*/hooks/*) ;;
  */mobile/*/utils/*|mobile/*/utils/*) ;;
  */validation.ts|*/validation.tsx) ;;                     # validación (móvil o EF _shared)
  *) exit 0 ;;
esac

# Los archivos de test (y rollbacks) siempre se permiten.
case "$FILE_PATH" in
  *.test.ts|*.spec.ts|*.test.tsx|*.spec.tsx|*.test.js|*.spec.js|*.test.jsx|*.spec.jsx) exit 0 ;;
  */supabase/tests/*|*/rollbacks/*) exit 0 ;;
esac

SENTINEL=".taskmaster/.current-red"
[ ! -f "$SENTINEL" ] && exit 0           # sin subtarea crítica activa → no se aplica

CURRENT_SUBTASK=$(cat "$SENTINEL" 2>/dev/null || echo "")

# Si el último commit es el RED de esta subtarea, estamos en GREEN → permitir.
LAST_COMMIT_MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "")
if [ -n "$CURRENT_SUBTASK" ] && \
   echo "$LAST_COMMIT_MSG" | grep -qE "^test\(red\): *${CURRENT_SUBTASK//./\\.}([^0-9]|$)"; then
  exit 0
fi

# Si hay cambios de test sin commitear desde HEAD → permitir (RED en progreso).
TEST_CHANGES=$(git status --porcelain 2>/dev/null | \
  grep -E '\.(test|spec)\.(ts|js)$|supabase/tests/.*\.sql$' || true)
[ -n "$TEST_CHANGES" ] && exit 0

cat >&2 <<EOF
🚫 TDD: no puedes editar '$FILE_PATH' (lógica crítica) antes de escribir sus tests.

Subtarea crítica activa: ${CURRENT_SUBTASK:-?} (sentinel: .taskmaster/.current-red).
→ Deja que el subagente test-author escriba los tests (fase RED) primero.
→ O si abandonaste la subtarea:  rm .taskmaster/.current-red
EOF
exit 2
