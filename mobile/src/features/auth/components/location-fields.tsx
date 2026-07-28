/**
 * LocationFields — Estado + Municipio del registro libre (§5.1).
 *
 * Datos: catálogo INEGI sembrado en 72.1 (public.mx_states, 32 filas;
 * public.mx_municipalities, 2478 filas). `anon` tiene SELECT en ambas, así
 * que se leen antes de autenticarse.
 *
 * - Los 32 estados se cargan UNA vez al montar.
 * - Los municipios se cargan FILTRADOS por `state_id` cada vez que cambia —
 *   nunca los 2478 de golpe.
 * - Cambiar de estado limpia el municipio ya elegido: sin esto queda un
 *   municipio de OTRO estado seleccionado y el CHECK users_municipio_del_estado
 *   de la DB rechaza el registro.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { supabase } from '@/lib/supabase/client';
import { SelectField, type SelectOption } from './select-field';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface LocationFieldsProps {
  state_id: string;
  municipality_id: string;
  on_change_state: (id: string) => void;
  on_change_municipality: (id: string) => void;
  state_error?: string | undefined;
  municipality_error?: string | undefined;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Homónimos — el cvegeo INEGI tiene municipios con el MISMO nombre dentro del
// mismo estado (p.ej. Oaxaca 20208/20209 "San Juan Mixtepec", 20318/20319
// "San Pedro Mixtepec" — INEGI los distingue por distrito). En una lista se
// ven idénticos e indistinguibles; se añade la clave entre paréntesis SOLO
// cuando el nombre se repite, para no ensuciar la mayoría de los casos.
// ---------------------------------------------------------------------------

function build_municipality_options(rows: { id: string; name: string }[]): SelectOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  }
  return rows.map((row) => ({
    id: row.id,
    label: (counts.get(row.name) ?? 0) > 1 ? `${row.name} (${row.id})` : row.name,
  }));
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function LocationFields({
  state_id,
  municipality_id,
  on_change_state,
  on_change_municipality,
  state_error,
  municipality_error,
  disabled = false,
}: LocationFieldsProps): React.JSX.Element {
  const [states, set_states] = useState<SelectOption[]>([]);
  const [states_loading, set_states_loading] = useState(true);
  const [municipalities, set_municipalities] = useState<SelectOption[]>([]);
  const [municipalities_loading, set_municipalities_loading] = useState(false);

  // Estados — una sola carga al montar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('mx_states').select('id, name').order('name');
      if (cancelled) return;
      if (error) {
        console.warn('[LocationFields] Error al cargar estados:', error.message);
      }
      set_states((data ?? []).map((row) => ({ id: row.id, label: row.name })));
      set_states_loading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Municipios — filtrados por state_id; se recargan cada vez que cambia.
  // Sin estado elegido no hay nada que traer: el estado inicial de
  // `municipalities` ya es [] y el SelectField de municipio llega deshabilitado
  // (ver `disabled` abajo), así que no hace falta un setState síncrono aquí
  // (handle_select_state es la ÚNICA forma de llegar a un state_id no vacío,
  // y siempre limpia municipality_id al cambiar de estado).
  useEffect(() => {
    if (state_id === '') return;
    let cancelled = false;
    (async () => {
      set_municipalities_loading(true);
      const { data, error } = await supabase
        .from('mx_municipalities')
        .select('id, name')
        .eq('state_id', state_id)
        .order('name');
      if (cancelled) return;
      if (error) {
        console.warn('[LocationFields] Error al cargar municipios:', error.message);
      }
      set_municipalities(build_municipality_options(data ?? []));
      set_municipalities_loading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [state_id]);

  const handle_select_state = (id: string): void => {
    on_change_state(id);
    if (municipality_id !== '') on_change_municipality('');
  };

  return (
    <View>
      <SelectField
        testID="signup-state"
        label="Estado"
        placeholder="Selecciona tu estado"
        value={state_id}
        options={states}
        onSelect={handle_select_state}
        error={state_error}
        loading={states_loading}
        disabled={disabled}
      />
      <SelectField
        testID="signup-municipality"
        label="Municipio"
        placeholder={state_id === '' ? 'Primero elige un estado' : 'Selecciona tu municipio'}
        value={municipality_id}
        options={municipalities}
        onSelect={on_change_municipality}
        error={municipality_error}
        loading={municipalities_loading}
        disabled={disabled || state_id === ''}
      />
    </View>
  );
}
