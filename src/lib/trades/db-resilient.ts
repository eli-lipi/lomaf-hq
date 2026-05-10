import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any, any, any>;

type Row = Record<string, unknown>;
interface PgError {
  message?: string;
  code?: string;
}

const MAX_STRIP_ATTEMPTS = 12;

function parseMissingColumn(msg: string | undefined): string | null {
  if (!msg) return null;
  // Postgres errors arrive as: column "foo" does not exist
  // or:                       column trade_players.foo does not exist
  const m = msg.match(/column\s+(?:[a-z_][a-z0-9_]*\.)?"?([a-z_][a-z0-9_]*)"?\s+does not exist/i);
  return m ? m[1] : null;
}

function stripCols(row: Row, cols: Set<string>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (!cols.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Insert rows, iteratively stripping any column the DB reports as missing.
 *
 * Replaces the legacy all-or-nothing fallback that nuked an entire bundle of
 * v11/v12 columns whenever any one of them was missing — that's how user
 * edits to expected_games_remaining were silently dropped when only
 * draft_pick was missing in production.
 *
 * Now: parse the missing column from each error, strip exactly that column
 * from every row, retry. Any non-"column does not exist" error throws
 * immediately. Caps at MAX_STRIP_ATTEMPTS to avoid loops on pathological
 * schemas. Logs each strip so missing migrations are visible in server logs.
 */
export async function insertResilient(
  supabase: SB,
  table: string,
  rows: Row[],
  logPrefix: string
): Promise<{ stripped: string[] }> {
  const stripped = new Set<string>();
  for (let attempt = 0; attempt < MAX_STRIP_ATTEMPTS; attempt++) {
    const filtered = rows.map((r) => stripCols(r, stripped));
    const { error } = (await supabase.from(table).insert(filtered)) as { error: PgError | null };
    if (!error) return { stripped: [...stripped] };
    const missing = parseMissingColumn(error.message);
    if (!missing || stripped.has(missing)) {
      throw new Error(error.message ?? `${table} insert failed`);
    }
    console.warn(
      `${logPrefix} schema missing column "${missing}" — stripping and retrying. Run the matching migration.`
    );
    stripped.add(missing);
  }
  throw new Error(`${logPrefix} ${table} insert: stripped ${MAX_STRIP_ATTEMPTS} columns and still failing`);
}

/**
 * Update rows by `where` equality clauses, stripping any missing column from
 * the payload and retrying. Same iterative-strip semantics as
 * insertResilient — see that function's notes for the rationale.
 */
export async function updateResilient(
  supabase: SB,
  table: string,
  payload: Row,
  where: Row,
  logPrefix: string
): Promise<{ stripped: string[] }> {
  const stripped = new Set<string>();
  for (let attempt = 0; attempt < MAX_STRIP_ATTEMPTS; attempt++) {
    const filtered = stripCols(payload, stripped);
    let q = supabase.from(table).update(filtered);
    for (const [k, v] of Object.entries(where)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      q = (q as any).eq(k, v);
    }
    const { error } = (await q) as { error: PgError | null };
    if (!error) return { stripped: [...stripped] };
    const missing = parseMissingColumn(error.message);
    if (!missing || stripped.has(missing)) {
      throw new Error(error.message ?? `${table} update failed`);
    }
    console.warn(
      `${logPrefix} schema missing column "${missing}" — stripping from update payload and retrying. Run the matching migration.`
    );
    stripped.add(missing);
  }
  throw new Error(`${logPrefix} ${table} update: stripped ${MAX_STRIP_ATTEMPTS} columns and still failing`);
}
