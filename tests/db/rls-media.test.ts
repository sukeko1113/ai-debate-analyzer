/**
 * 他人の media_sources が RLS レベルで見えないこと（ACCEPTANCE.md M32）。
 *
 * **アプリの分岐だけで守らない。**
 * `defineHandler` の `auth` と `matchIdFrom` は二重目の網である。
 * ここでは、その分岐を通らない経路（生の SQL・リポジトリ関数の直接呼び出し）でも
 * 他人の行が 1 件も見えないことを確かめる。rls-matches.test.ts と同じ構図。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { withActor } from "../../packages/core/src/db/client";
import { POST as createMatchRoute } from "../../app/api/v1/matches/route";
import { POST as registerMediaRoute } from "../../app/api/v1/matches/[id]/media/route";
import { findByFingerprint, findMediaById, listMedia } from "../../packages/core/src/db/repo/media";
import { storagePathFor } from "../../packages/core/src/schema/media";
import { henda20 } from "../../packages/core/src/ruleset";
import { call, newActorId } from "./helpers/api";
import { migratorClient, serverClient, truncateMatchTables } from "./helpers/probe";

let migrator: Sql;
let server: Sql;

const owner = newActorId();
const stranger = newActorId();

const SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
let matchId: string;
let mediaId: string;

beforeAll(async () => {
  migrator = migratorClient();
  server = serverClient();
  await truncateMatchTables(migrator);

  const created = await call<{ data: { id: string } }>(createMatchRoute, "POST", "/matches", {
    actorId: owner,
    idempotencyKey: randomUUID(),
    body: {
      motion: "The Japanese government should abolish the death penalty.",
      heldOn: "2026-03-21",
      round: "予選1",
      affTeam: "架空第一高校",
      negTeam: "架空第二高校",
      rulesetId: henda20.id,
      rulesetVersion: henda20.version,
    },
  });
  expect(created.status).toBe(201);
  matchId = created.body.data.id;

  const registered = await call<{ data: { mediaSourceId: string } }>(
    registerMediaRoute,
    "POST",
    `/matches/${matchId}/media`,
    {
      actorId: owner,
      params: { id: matchId },
      body: {
        storagePath: storagePathFor(matchId, SHA, "audio/mpeg"),
        sourceSha256: SHA,
        durationMs: 2_520_000,
        mime: "audio/mpeg",
        bitrate: 64_000,
        channels: 1,
        origin: "upload",
      },
    },
  );
  expect(registered.status).toBe(201);
  mediaId = registered.body.data.mediaSourceId;
});

afterAll(async () => {
  await truncateMatchTables(migrator);
  await migrator.end();
  await server.end();
});

describe("RLS（アプリの認可分岐を通らない経路）", () => {
  it("生の SELECT でも、他人のメディアは 0 行", async () => {
    const rows = await withActor(
      server,
      stranger,
      (tx) => tx`SELECT id FROM media_sources WHERE id = ${mediaId}`,
    );
    expect(rows).toHaveLength(0);
  });

  it("リポジトリ関数を直接呼んでも見えない（assertMatchAccess を経由しない）", async () => {
    const byId = await withActor(server, stranger, (tx) => findMediaById(tx, mediaId));
    expect(byId).toBeNull();

    const byFingerprint = await withActor(server, stranger, (tx) =>
      findByFingerprint(tx, matchId, SHA),
    );
    expect(byFingerprint).toBeNull();

    const list = await withActor(server, stranger, (tx) => listMedia(tx, matchId));
    expect(list).toEqual([]);
  });

  it("持ち主には見える（テストが「常に 0 行」で空回りしていないこと）", async () => {
    const mine = await withActor(server, owner, (tx) => findMediaById(tx, mediaId));
    expect(mine?.id).toBe(mediaId);
  });

  it("app.actor_id を設定しない経路では 1 行も見えない", async () => {
    // withActor を通らない生の接続。ポリシーは current_setting を見るので、
    // 設定が無ければ誰にも一致しない
    const rows = await server`SELECT id FROM media_sources`;
    expect(rows).toHaveLength(0);
  });

  it("他人の match へメディアを差し込めない（INSERT ポリシー）", async () => {
    await expect(
      withActor(
        server,
        stranger,
        (tx) => tx`
          INSERT INTO media_sources (match_id, storage_path, source_sha256, duration_ms,
                                     mime, origin, uploaded_by)
          VALUES (${matchId}, ${`${matchId}/${SHA}.wav`}, ${SHA}, 1000,
                  'audio/wav', 'upload', ${stranger})`,
      ),
    ).rejects.toThrow(/row-level security|violates/);
  });

  it("他人のメディアを UPDATE できない（0 行で静かに終わる）", async () => {
    // ここは例外ではなく 0 行になる。RLS の UPDATE は「見えない行を対象にしない」ためである。
    // 静かに成功したように見えるので、呼び出し側は必ず RETURNING の件数を見ること
    const updated = await withActor(
      server,
      stranger,
      (tx) => tx`
        UPDATE media_sources SET purged_at = now(), storage_path = NULL
         WHERE id = ${mediaId} RETURNING id`,
    );
    expect(updated).toHaveLength(0);

    const still = await withActor(server, owner, (tx) => findMediaById(tx, mediaId));
    expect(still?.purgedAt).toBeNull();
  });

  it("DELETE のポリシーが無いので、持ち主でも行を消せない", async () => {
    // A削除は storage_path を null にする操作であり、行を消す経路は設計に無い
    // （PRIVACY_RETENTION.md §4）
    const deleted = await withActor(
      server,
      owner,
      (tx) => tx`DELETE FROM media_sources WHERE id = ${mediaId} RETURNING id`,
    );
    expect(deleted).toHaveLength(0);
  });
});
