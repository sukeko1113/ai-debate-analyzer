/**
 * ジョブの冪等キーの一部（API_SPEC.md §3 / TRANSCRIPTION.md §6.2）。
 *
 * 冪等キー全体は `match_id` + `kind` + `target_stage_no` + `params_hash` であり、
 * DB の UNIQUE NULLS NOT DISTINCT が担保する。ここが作るのは最後の 1 つ。
 *
 * **サーバだけが決める。リクエストから受け取らない。**
 * 受け取ると、クライアントが冪等キーを選べる＝同じ内容の二重実行を自分で作れる。
 *
 * ハッシュに入れるものは「これが変わったら別のジョブとして走らせるべきもの」である。
 *   - ruleset のバージョンが変われば、ステージ推定の結果が変わりうる
 *   - provider / model が変われば、出力もコストも変わる
 * 逆に `match_id` / `kind` / `target_stage_no` は入れない。UNIQUE の他の 3 列だからである。
 * 二重に入れても間違いではないが、どこで効いているのかが読めなくなる。
 */
import { createHash } from "node:crypto";

export interface JobParams {
  kind: string;
  targetStageNo: number | null;
  rulesetVersion: string;
  providerId: string;
  model: string;
}

/**
 * 正規化してから SHA-256。
 *
 * **オブジェクトを JSON.stringify しない。** キーの順序が実装依存になり、
 * 「同じ内容なのにハッシュが違う」が起きる。順序を固定した配列にしてから文字列にする。
 *
 * 区切り文字での連結もしない。要素が区切り文字を含むと
 * ["a b", "c"] と ["a", "b c"] が同じ文字列になる。
 * providerId と model は設定から来る文字列であり、どんな文字も含みうる。
 * 配列を JSON にすれば各要素が引用符で囲まれ、この衝突が起きない。
 */
export function paramsHash(params: JobParams): string {
  const canonical = JSON.stringify([
    params.kind,
    params.targetStageNo,
    params.rulesetVersion,
    params.providerId,
    params.model,
  ]);

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
