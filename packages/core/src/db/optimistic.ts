/**
 * 楽観ロック（API_SPEC.md §0.3 / DATA_MODEL.md §1.1）。
 *
 * 更新は `WHERE id = $1 AND lock_version = $2` の条件付き UPDATE で行う。
 * 0 行だったときに 409 を返すだけでは足りない。RLS で見えていないのか、
 * version がずれているのかで返すべきものが違う（404 と 409）。
 * ここで一度だけ切り分ける。全テーブルが同じ扱いになるよう、route に書かせない。
 */
import type { TransactionSql } from "postgres";
import { ApiError } from "../http/errors";

/** 表名を SQL へ埋め込む。呼び出しはすべてサーバのコードからで、外部入力は来ない */
const TABLE_RE = /^[a-z_][a-z0-9_]*$/;

export interface UpdateWithVersionArgs {
  table: string;
  id: string;
  expectedVersion: number;
  /** 列名 → 値。lock_version はここに入れない（自動で +1 する） */
  set: Record<string, unknown>;
}

export async function updateWithVersion<T extends Record<string, unknown>>(
  tx: TransactionSql,
  { table, id, expectedVersion, set }: UpdateWithVersionArgs,
): Promise<T> {
  if (!TABLE_RE.test(table)) throw new Error(`表名が不正です: ${table}`);

  const rows = await tx<T[]>`
    UPDATE ${tx(table)}
       SET ${tx(set)}, lock_version = lock_version + 1
     WHERE id = ${id} AND lock_version = ${expectedVersion}
    RETURNING *`;

  const updated = rows[0];
  if (updated) return updated;

  // 0 行。RLS で見えていないのか、version がずれているのかを切り分ける。
  const current = await tx<{ lock_version: number }[]>`
    SELECT lock_version FROM ${tx(table)} WHERE id = ${id}`;

  const row = current[0];
  if (!row) {
    // RLS が隠しているか、そもそも存在しない。どちらかを外へ漏らさない
    throw new ApiError("NOT_FOUND", "対象が見つかりません");
  }

  throw new ApiError(
    "VERSION_CONFLICT",
    `他の変更と競合しました（expectedVersion=${expectedVersion} / 現在=${row.lock_version}）`,
    { currentVersion: row.lock_version },
  );
}

/**
 * 列を変えずに版だけ進める。
 *
 * 子テーブルの一括置換（PUT /members のような操作）で使う。
 * 行ごとの lock_version では「置換全体」の競合を表せないため、
 * 親の版で守る。updateWithVersion に空の set を渡す形にしないのは、
 * 「更新対象が無い更新」を一般の経路として許したくないからである。
 */
export async function bumpVersion(
  tx: TransactionSql,
  table: string,
  id: string,
  expectedVersion: number,
): Promise<number> {
  if (!TABLE_RE.test(table)) throw new Error(`表名が不正です: ${table}`);

  const rows = await tx<{ lock_version: number }[]>`
    UPDATE ${tx(table)}
       SET lock_version = lock_version + 1
     WHERE id = ${id} AND lock_version = ${expectedVersion}
    RETURNING lock_version`;

  const updated = rows[0];
  if (updated) return updated.lock_version;

  const current = await tx<{ lock_version: number }[]>`
    SELECT lock_version FROM ${tx(table)} WHERE id = ${id}`;
  const row = current[0];
  if (!row) throw new ApiError("NOT_FOUND", "対象が見つかりません");

  throw new ApiError(
    "VERSION_CONFLICT",
    `他の変更と競合しました（expectedVersion=${expectedVersion} / 現在=${row.lock_version}）`,
    { currentVersion: row.lock_version },
  );
}
