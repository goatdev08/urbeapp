#!/usr/bin/env node
/**
 * prepare-neighborhoods.mjs — GeoJSON DCAH (ya reproyectado a WGS84) → CSV de import.
 * Tarea #157.3. Se invoca desde import-neighborhoods.sh; también sirve suelto:
 *
 *   node prepare-neighborhoods.mjs <entrada.geojson> <salida.csv>
 *
 * Entrada: FeatureCollection producido por mapshaper a partir de la capa `as` de la
 * "Delimitación de Colonias y otros Asentamientos Humanos" (DCAH 2024, INEGI) con
 * atributos CVEGEO / CVE_ENT / CVE_MUN / NOM_ASEN / CP.
 *
 * Salida: CSV (source_key, municipality_id, name, postal_code, geojson) para el
 * COPY→staging→upsert de import-neighborhoods.sh. Reglas:
 *   - source_key = CVEGEO (clave oficial INEGI de 13 dígitos, estable entre ediciones).
 *   - municipality_id = CVE_ENT + CVE_MUN (= cvegeo de public.mx_municipalities).
 *   - name = NOM_ASEN pasado de MAYÚSCULAS a Title Case español (ver title_case_es).
 *   - postal_code = CP, vacío si '00000' (así viene TODO Jalisco; varía por estado).
 *   - geojson = la geometría tal cual (Polygon o MultiPolygon — el SQL la normaliza
 *     con ST_Multi + ST_MakeValid).
 *   - Features sin geometría o sin nombre → se saltan y se loguean (calidad del dataset).
 *
 * Sin dependencias: Node puro (los GeoJSON estatales pesan ~6-10 MB, caben en memoria).
 */

import { readFileSync, writeFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Title Case español
// ---------------------------------------------------------------------------

// Conectores que van en minúscula salvo al inicio del nombre.
const LOWER_WORDS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'a', 'al', 'en', 'con', 'por',
]);
const ROMAN_RE = /^[ivxlcdm]+$/;

/**
 * "PROVIDENCIA CUARTA SECCIÓN" -> "Providencia Cuarta Sección"
 * "SAN JOSÉ DEL CASTILLO" -> "San José del Castillo" · "SAN RAFAEL II" -> "San Rafael II"
 * ponytail: heurística, no diccionario — siglas CON vocales (Infonavit, Imss) quedan
 * capitalizadas como palabra normal; las sin vocales (CTM) y los números romanos se
 * conservan en mayúsculas. Suficiente para display; la búsqueda usa name_normalized.
 */
export function title_case_es(raw) {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (i > 0 && LOWER_WORDS.has(word)) return word;
      if (ROMAN_RE.test(word) || !/[aeiouáéíóúü]/.test(word)) return word.toUpperCase();
      // Capitaliza también tras '(' o '-': "atarjeas (san isidro)" -> "Atarjeas (San Isidro)"
      return word.replace(/(^|[(\-.])([a-záéíóúüñ])/g, (_, pre, ch) => pre + ch.toUpperCase());
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Mapeo feature DCAH → fila de import (compartido con upload-neighborhoods.mjs)
// ---------------------------------------------------------------------------

/** Feature DCAH → {source_key, municipality_id, name, postal_code, geojson} | null (inválida). */
export function feature_to_row(feature) {
  const p = feature.properties ?? {};
  const geom = feature.geometry;
  const cvegeo = p.CVEGEO ?? '';
  const name_raw = (p.NOM_ASEN ?? '').trim();

  if (!geom || !cvegeo || !name_raw) return null;

  return {
    source_key: cvegeo,
    municipality_id: `${p.CVE_ENT}${p.CVE_MUN}`,
    name: title_case_es(name_raw),
    postal_code: p.CP && p.CP !== '00000' ? p.CP : '',
    geojson: JSON.stringify(geom),
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csv_field(value) {
  const s = String(value ?? '');
  return `"${s.replaceAll('"', '""')}"`;
}

// ---------------------------------------------------------------------------
// Main (solo cuando se invoca directo, no al importarlo como módulo)
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , in_path, out_path] = process.argv;
  if (!in_path || !out_path) {
    console.error('Uso: node prepare-neighborhoods.mjs <entrada.geojson> <salida.csv>');
    process.exit(1);
  }

  const collection = JSON.parse(readFileSync(in_path, 'utf8'));
  const rows = ['source_key,municipality_id,name,postal_code,geojson'];
  let skipped = 0;

  for (const feature of collection.features) {
    const row = feature_to_row(feature);
    if (!row) {
      skipped += 1;
      const p = feature.properties ?? {};
      console.error(`skip: CVEGEO=${p.CVEGEO || '?'} name=${p.NOM_ASEN || '?'} geom=${feature.geometry ? 'ok' : 'null'}`);
      continue;
    }
    rows.push(
      [
        csv_field(row.source_key),
        csv_field(row.municipality_id),
        csv_field(row.name),
        csv_field(row.postal_code),
        csv_field(row.geojson),
      ].join(','),
    );
  }

  writeFileSync(out_path, rows.join('\n') + '\n');
  console.error(`prepare: ${rows.length - 1} filas escritas, ${skipped} saltadas -> ${out_path}`);
}
