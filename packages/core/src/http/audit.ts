/**
 * edit_logs への追記（defineHandler の担保 7 / DATA_MODEL.md §10）。
 *
 * ハンドラは audit.record(...) を呼ぶだけで、INSERT は defineHandler が
 * トランザクション内でまとめて行う。ハンドラ側に INSERT を書かせない理由は、
 * 書き忘れが「動くけれど記録が残らない」形で本番まで通ってしまうからである。
 *
 * 変更系メソッド（GET / HEAD 以外）で 1 件も記録が無ければ defineHandler が
 * 500 で落とす。規約ではなく仕組みで守る。
 */
import type { TransactionSql } from "postgres";

export interface AuditEntry {
  /** 対象テーブル名（DATA_MODEL.md の表名） */
  entity: string;
  /** 対象行の id。表そのものへの操作（一括置換など）では null */
  entityId: string | null;
  matchId: string;
  before: unknown;
  after: unknown;
}

export class AuditRecorder {
  private readonly entries: AuditEntry[] = [];

  record(entry: AuditEntry): void {
    this.entries.push(entry);
  }

  get size(): number {
    return this.entries.length;
  }

  async flush(tx: TransactionSql, actorId: string): Promise<void> {
    for (const e of this.entries) {
      await tx`
        INSERT INTO edit_logs (match_id, entity, entity_id, before, after, actor)
        VALUES (${e.matchId}, ${e.entity}, ${e.entityId},
                ${e.before === undefined ? null : tx.json(e.before as never)},
                ${e.after === undefined ? null : tx.json(e.after as never)},
                ${actorId})`;
    }
  }
}
