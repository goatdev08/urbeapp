#!/usr/bin/env bash
# Stop hook: si una subtarea CRÍTICA sigue activa (sentinel presente) al terminar el turno,
# recuerda cerrarla. No bloquea — exit 0 siempre.

SENTINEL=".taskmaster/.current-red"
if [ -f "$SENTINEL" ]; then
  SUBTASK_ID=$(cat "$SENTINEL" 2>/dev/null || echo "?")
  echo "" >&2
  echo "⚠️  Subtarea crítica $SUBTASK_ID sigue activa (.taskmaster/.current-red existe)." >&2
  echo "   Termina su ciclo TDD (GREEN + guardian) y márcala done, o limpia el sentinel:" >&2
  echo "   rm .taskmaster/.current-red" >&2
fi
exit 0
