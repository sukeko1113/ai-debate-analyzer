"use client";

/**
 * 画面A: 試合登録（BASIC_DESIGN_v05 §15）。
 *
 * Motion / Round / 両チーム / 出場者（A1〜N4）/ ruleset選択 / 許諾記録。
 *
 * この画面は氏名（display_name）を扱ってよい数少ない場所である。
 * 解析・観戦画面は座席ラベルを主表示にする（CLAUDE.md / §9.9）。
 *
 * 送信は 3 本の API を順に呼ぶ。1 本にまとめないのは、
 * 許諾の記録（POST /consent）と出場者の登録（PUT /members）が
 * それぞれ別の権限・別の版で守られているためである（API_SPEC.md §1）。
 */
import { useMemo, useState } from "react";
import { henda20 } from "@core/ruleset";
import { rosterFor, seatsFor } from "@core/ruleset/roster";
import type { TeamSize } from "@core/ruleset";
import { RosterTable } from "./roster-table";

const CONSENT_SCOPES = [
  { value: "practice_only", label: "練習のみ" },
  { value: "training_material", label: "指導教材として利用" },
  { value: "research", label: "研究利用" },
  { value: "public", label: "公開" },
] as const;

const CONSENT_SOURCES = [
  { value: "student", label: "本人（生徒）" },
  { value: "guardian", label: "保護者" },
  { value: "school", label: "学校" },
  { value: "organizer", label: "大会主催" },
] as const;

const ROUNDS = ["予選1", "予選2", "予選3", "予選4", "予選5", "予選6", "Q-F", "S-F", "Final"];

interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

async function post<T>(
  path: string,
  method: string,
  body: unknown,
  token: string,
  idempotencyKey?: string,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = (payload as ApiError).error?.message ?? "不明なエラー";
    throw new Error(`${(payload as ApiError).error?.code ?? response.status}: ${message}`);
  }
  return (payload as { data: T }).data;
}

export function MatchForm({ token }: { token: string }) {
  const [motion, setMotion] = useState("");
  const [heldOn, setHeldOn] = useState("");
  const [round, setRound] = useState("");
  const [affTeam, setAffTeam] = useState("");
  const [negTeam, setNegTeam] = useState("");
  const [teamSize, setTeamSize] = useState<TeamSize>(4);
  const [names, setNames] = useState<Record<string, string>>({});

  const [consentScope, setConsentScope] =
    useState<(typeof CONSENT_SCOPES)[number]["value"]>("practice_only");
  const [consentSources, setConsentSources] = useState<string[]>([]);
  const [consentExpiresOn, setConsentExpiresOn] = useState("");
  const [consentNote, setConsentNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roster = useMemo(() => rosterFor(henda20, teamSize), [teamSize]);
  const seats = useMemo(() => seatsFor(teamSize), [teamSize]);

  // チーム人数を 4 → 3 に減らしたとき、A4 / N4 に入っていた氏名は送らない。
  // 残したまま送ると 400 になる（サーバも DB も 3人チームの A4 を拒否する）
  const membersToSend = seats
    .filter((seat) => (names[seat] ?? "").trim() !== "")
    .map((seat) => ({
      side: seat.startsWith("A") ? ("AFF" as const) : ("NEG" as const),
      seat,
      displayName: names[seat]!.trim(),
    }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const idempotencyKey = crypto.randomUUID();
      const match = await post<{ id: string; lockVersion: number }>(
        "/api/v1/matches",
        "POST",
        {
          motion,
          heldOn: heldOn === "" ? null : heldOn,
          round: round === "" ? null : round,
          affTeam,
          negTeam,
          rulesetId: henda20.id,
          rulesetVersion: henda20.version,
        },
        token,
        idempotencyKey,
      );

      let version = match.lockVersion;

      if (consentSources.length > 0) {
        const consent = await post<{ version: number }>(
          `/api/v1/matches/${match.id}/consent`,
          "POST",
          {
            expectedVersion: version,
            scope: consentScope,
            obtainedFrom: consentSources,
            expiresOn: consentExpiresOn === "" ? null : consentExpiresOn,
            note: consentNote,
          },
          token,
        );
        version = consent.version;
      }

      if (membersToSend.length > 0) {
        const members = await post<{ version: number }>(
          `/api/v1/matches/${match.id}/members`,
          "PUT",
          { expectedVersion: version, teamSize, members: membersToSend },
          token,
        );
        version = members.version;
      }

      setMessage(`試合を登録しました（id: ${match.id}）`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-testid="match-form">
      <fieldset>
        <legend>試合</legend>

        <p>
          <label htmlFor="motion">Motion（論題）</label>
          <textarea
            id="motion"
            data-testid="motion"
            required
            maxLength={300}
            value={motion}
            onChange={(e) => setMotion(e.target.value)}
          />
        </p>

        <p>
          <label htmlFor="heldOn">実施日</label>
          <input
            id="heldOn"
            data-testid="held-on"
            type="date"
            value={heldOn}
            onChange={(e) => setHeldOn(e.target.value)}
          />
        </p>

        <p>
          <label htmlFor="round">Round</label>
          <select
            id="round"
            data-testid="round"
            value={round}
            onChange={(e) => setRound(e.target.value)}
          >
            <option value="">（未設定）</option>
            {ROUNDS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </p>

        <p>
          <label htmlFor="ruleset">ruleset</label>
          {/* 既知の ruleset は現状 1 つ。増えたら選択肢になる。
              版はサーバが持っているものと一致していなければ 400 になる */}
          <select id="ruleset" data-testid="ruleset" defaultValue={henda20.id}>
            <option value={henda20.id}>
              {henda20.id}（{henda20.version}）
            </option>
          </select>
        </p>
      </fieldset>

      <fieldset>
        <legend>チーム</legend>
        <p>
          <label htmlFor="affTeam">肯定側（AFF）</label>
          <input
            id="affTeam"
            data-testid="aff-team"
            required
            maxLength={100}
            value={affTeam}
            onChange={(e) => setAffTeam(e.target.value)}
          />
        </p>
        <p>
          <label htmlFor="negTeam">否定側（NEG）</label>
          <input
            id="negTeam"
            data-testid="neg-team"
            required
            maxLength={100}
            value={negTeam}
            onChange={(e) => setNegTeam(e.target.value)}
          />
        </p>
      </fieldset>

      <fieldset>
        <legend>出場者</legend>
        <p>
          チーム人数
          {/* 3人登録は病欠等の例外。既定は4人（条項 2.2） */}
          {([4, 3] as const).map((size) => (
            <label key={size}>
              <input
                type="radio"
                name="teamSize"
                data-testid={`team-size-${size}`}
                checked={teamSize === size}
                onChange={() => setTeamSize(size)}
              />
              {size}人
            </label>
          ))}
        </p>

        {seats.map((seat) => (
          <p key={seat}>
            <label htmlFor={`seat-${seat}`}>{seat}</label>
            <input
              id={`seat-${seat}`}
              data-testid={`seat-${seat}`}
              maxLength={60}
              value={names[seat] ?? ""}
              onChange={(e) => setNames((prev) => ({ ...prev, [seat]: e.target.value }))}
            />
          </p>
        ))}

        <RosterTable roster={roster} names={names} />
      </fieldset>

      <fieldset>
        <legend>許諾の記録</legend>
        <p>
          許諾が記録されていない試合では、解析を開始できません（API_SPEC.md §0.5
          CONSENT_REQUIRED）。あとから記録することもできます。
        </p>

        <p>
          <label htmlFor="consentScope">利用範囲</label>
          <select
            id="consentScope"
            data-testid="consent-scope"
            value={consentScope}
            onChange={(e) =>
              setConsentScope(e.target.value as (typeof CONSENT_SCOPES)[number]["value"])
            }
          >
            {CONSENT_SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </p>

        <fieldset>
          <legend>取得元（1つ以上で記録されます）</legend>
          {CONSENT_SOURCES.map((s) => (
            <label key={s.value}>
              <input
                type="checkbox"
                data-testid={`consent-source-${s.value}`}
                checked={consentSources.includes(s.value)}
                onChange={(e) =>
                  setConsentSources((prev) =>
                    e.target.checked ? [...prev, s.value] : prev.filter((v) => v !== s.value),
                  )
                }
              />
              {s.label}
            </label>
          ))}
        </fieldset>

        <p>
          <label htmlFor="consentExpiresOn">許諾の期限</label>
          <input
            id="consentExpiresOn"
            data-testid="consent-expires-on"
            type="date"
            value={consentExpiresOn}
            onChange={(e) => setConsentExpiresOn(e.target.value)}
          />
        </p>

        <p>
          <label htmlFor="consentNote">備考</label>
          <textarea
            id="consentNote"
            data-testid="consent-note"
            maxLength={1000}
            value={consentNote}
            onChange={(e) => setConsentNote(e.target.value)}
          />
        </p>
      </fieldset>

      <p>
        <button type="submit" data-testid="submit" disabled={busy}>
          {busy ? "登録中…" : "試合を登録する"}
        </button>
      </p>

      {message ? <p data-testid="result">{message}</p> : null}
      {error ? <p data-testid="error">{error}</p> : null}
    </form>
  );
}
