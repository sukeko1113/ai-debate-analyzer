"use client";

/**
 * 担当者表（条項 2.2）。team_size で切り替わる。
 *
 * 表そのものは ruleset から導く（rosterFor）。画面側で組み立て直さない。
 * API の応答と同じ関数を使っているので、画面と API がずれない。
 */
import type { RosterEntry } from "@core/ruleset/roster";

const STAGE_LABEL: Record<number, string> = {
  1: "①肯定立論",
  2: "②否定質疑",
  3: "③否定立論",
  4: "④肯定質疑",
  5: "⑤否定質疑",
  6: "⑥肯定質疑",
  7: "⑦否定攻撃",
  8: "⑧肯定攻撃",
  9: "⑨肯定防御",
  10: "⑩否定防御",
  11: "⑪肯定総括",
  12: "⑫否定総括",
};

export function RosterTable({
  roster,
  names,
}: {
  roster: RosterEntry[];
  names: Record<string, string>;
}) {
  return (
    <table data-testid="roster-table">
      <caption>担当者表（条項 2.2）。チーム人数を変えると担当が切り替わります。</caption>
      <thead>
        <tr>
          <th scope="col">ステージ</th>
          <th scope="col">側</th>
          <th scope="col">担当</th>
          <th scope="col">時間</th>
        </tr>
      </thead>
      <tbody>
        {roster.map((entry) => (
          <tr key={entry.stageNo} data-testid={`roster-row-${entry.stageNo}`}>
            <td>{STAGE_LABEL[entry.stageNo] ?? entry.stageNo}</td>
            <td>{entry.side}</td>
            <td data-testid={`roster-seat-${entry.stageNo}`}>
              {/* 主表示は座席ラベル。氏名は補助（BASIC_DESIGN_v05 §9.9）。
                  解析・観戦画面では氏名を出さないが、登録画面は例外である */}
              <strong>{entry.seat}</strong>
              {names[entry.seat] ? <span>（{names[entry.seat]}）</span> : null}
            </td>
            <td>{Math.round(entry.durationSec / 60)}分</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
