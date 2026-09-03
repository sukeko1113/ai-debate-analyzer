/**
 * メディア取り込みの API（API_SPEC.md §2 / TASKS.md P3）。
 *
 * 実際の app/api/v1/... の route.ts をそのまま呼ぶ。DB も RLS も本物である。
 * Storage だけ stub に差し替える（クラウドセッションは実 Supabase に接続しない。
 * DEV_ENVIRONMENTS.md §4）。
 *
 * ここで確かめるのは M28・M29・M30・M31・M32 と、storagePath の照合である。
 * **実際にファイルが上がるか、署名がバケットのポリシーを迂回するかは確かめていない**
 * （ACCEPTANCE.md H9〜H11）。
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { POST as createMatchRoute } from "../../app/api/v1/matches/route";
import { POST as uploadIntentRoute } from "../../app/api/v1/matches/[id]/media/upload-intent/route";
import {
  GET as listMediaRoute,
  POST as registerMediaRoute,
} from "../../app/api/v1/matches/[id]/media/route";
import { GET as playbackUrlRoute } from "../../app/api/v1/media/[id]/playback-url/route";
import { henda20 } from "../../packages/core/src/ruleset";
import {
  resetStorageSignerForTests,
  setStorageSignerForTests,
} from "../../packages/core/src/storage";
import { StubStorageSigner } from "../../packages/core/src/storage/stub";
import { storagePathFor } from "../../packages/core/src/schema/media";
import { call, newActorId, readAsActor } from "./helpers/api";
import { migratorClient, truncateMatchTables } from "./helpers/probe";

let migrator: Sql;
let stub: StubStorageSigner;

const SHA_A = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA_B = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

beforeAll(async () => {
  migrator = migratorClient();
});

afterAll(async () => {
  await truncateMatchTables(migrator);
  await migrator.end();
});

beforeEach(() => {
  stub = new StubStorageSigner();
  setStorageSignerForTests(stub);
});

afterEach(async () => {
  resetStorageSignerForTests();
  await truncateMatchTables(migrator);
});

async function createMatch(actorId: string): Promise<string> {
  const res = await call<{ data: { id: string } }>(createMatchRoute, "POST", "/matches", {
    actorId,
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
  expect(res.status).toBe(201);
  return res.body.data.id;
}

function intent(actorId: string, matchId: string, sha = SHA_A, mime = "audio/mpeg") {
  return call<{ data: Record<string, unknown> }>(
    uploadIntentRoute,
    "POST",
    `/matches/${matchId}/media/upload-intent`,
    {
      actorId,
      params: { id: matchId },
      body: { filename: "gold-01.mp3", byteSize: 20 * 1024 * 1024, mime, sourceSha256: sha },
    },
  );
}

function register(
  actorId: string,
  matchId: string,
  overrides: Record<string, unknown> = {},
  sha = SHA_A,
) {
  return call<{ data: { status: string; mediaSourceId: string } }>(
    registerMediaRoute,
    "POST",
    `/matches/${matchId}/media`,
    {
      actorId,
      params: { id: matchId },
      body: {
        storagePath: storagePathFor(matchId, sha, "audio/mpeg"),
        sourceSha256: sha,
        durationMs: 2_520_000,
        mime: "audio/mpeg",
        bitrate: 64_000,
        channels: 1,
        origin: "upload",
        ...overrides,
      },
    },
  );
}

/**
 * A削除を模す。retention の経路は P19 なので、ここでは直接倒す。
 *
 * **所有者（app_migrator）接続では倒せない。** FORCE ROW LEVEL SECURITY があり、
 * ポリシーはすべて TO app_server なので、UPDATE が 0 行で静かに成功したように見える
 * （HANDOFF 件12）。実際にこれを踏んで 3 件落ちた。必ず app_server ＋ withActor で書く。
 */
async function purge(actorId: string, mediaId: string): Promise<void> {
  const updated = await readAsActor(
    actorId,
    (tx) =>
      tx<{ id: string }[]>`
      UPDATE media_sources SET storage_path = NULL, purged_at = now()
       WHERE id = ${mediaId} RETURNING id`,
  );
  // 0 行なら「消したつもりで消えていない」。ここで気づけるようにする
  expect(updated).toHaveLength(1);
}

describe("upload-intent", () => {
  it("未登録なら ready を返し、保存パスと直結ホストが載る", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);

    const res = await intent(actor, matchId);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ready");
    expect(res.body.data.storagePath).toBe(`${matchId}/${SHA_A}.mp3`);
    expect(res.body.data.bucket).toBe("media");
    expect(String(res.body.data.tusEndpoint)).toContain("/storage/v1/upload/resumable");
    expect(res.body.data.uploadToken).toBeTruthy();
  });

  it("M29 新規の署名は upsert: false で発行される", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);
    await intent(actor, matchId);

    expect(stub.uploadCalls).toEqual([{ storagePath: `${matchId}/${SHA_A}.mp3`, upsert: false }]);
  });

  it("登録済み（生きている）なら already_exists を返し、署名を発行しない", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);
    await intent(actor, matchId);
    const created = await register(actor, matchId);
    expect(created.status).toBe(201);

    stub.uploadCalls.length = 0;
    const res = await intent(actor, matchId);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("already_exists");
    expect(res.body.data.mediaSourceId).toBe(created.body.data.mediaSourceId);
    // 上げ直させない。アップロードそのものを省ける（決定 (a) の副次効果）
    expect(stub.uploadCalls).toEqual([]);
  });

  it("M29 purge 済みなら ready を返し、署名は upsert: true で発行される", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);
    await intent(actor, matchId);
    const created = await register(actor, matchId);
    await purge(actor, created.body.data.mediaSourceId);

    stub.uploadCalls.length = 0;
    const res = await intent(actor, matchId);

    expect(res.body.data.status).toBe("ready");
    expect(stub.uploadCalls).toEqual([{ storagePath: `${matchId}/${SHA_A}.mp3`, upsert: true }]);
  });

  it("M30 他人の match では 404（403 にしない。存在を漏らさない）", async () => {
    const owner = newActorId();
    const stranger = newActorId();
    const matchId = await createMatch(owner);

    const res = await intent(stranger, matchId);

    expect(res.status).toBe(404);
  });

  it("M33 50MB を超える intent は 400 で拒否される", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);

    const res = await call<{ error: { code: string } }>(
      uploadIntentRoute,
      "POST",
      `/matches/${matchId}/media/upload-intent`,
      {
        actorId: actor,
        params: { id: matchId },
        body: {
          filename: "too-big.mp3",
          byteSize: 50 * 1024 * 1024 + 1,
          mime: "audio/mpeg",
          sourceSha256: SHA_A,
        },
      },
    );

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
  });

  it("M33 mime が enum 外なら 400", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);
    const res = await intent(actor, matchId, SHA_A, "video/mp4");
    expect(res.status).toBe(400);
  });

  it("Idempotency-Key を要求しない（§0.4 のどちらの観点にも当たらない）", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);
    const res = await intent(actor, matchId);
    expect(res.status).toBe(200);
  });

  it("署名の発行が edit_logs に残る（本体が API を通らないため、ここにしか記録が無い）", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);
    await intent(actor, matchId);

    const logs = await readAsActor(
      actor,
      (tx) =>
        tx<{ entity: string; after: Record<string, unknown> }[]>`
        SELECT entity, after FROM edit_logs
         WHERE match_id = ${matchId} AND entity = 'media_sources'`,
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]!.after.uploadIntent).toBe("ready");
    expect(logs[0]!.after.upsert).toBe(false);
  });
});

describe("POST /media（M28 三分岐）", () => {
  it("新規は created / 201", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);

    const res = await register(actor, matchId);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("created");
  });

  it("同じ指紋を二度登録しても行は増えず already_exists / 200", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);

    const first = await register(actor, matchId);
    const second = await register(actor, matchId);

    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe("already_exists");
    expect(second.body.data.mediaSourceId).toBe(first.body.data.mediaSourceId);

    const rows = await readAsActor(
      actor,
      (tx) => tx<{ id: string }[]>`SELECT id FROM media_sources WHERE match_id = ${matchId}`,
    );
    expect(rows).toHaveLength(1);
  });

  it("purge 済みの行は再利用され restored / 200 になる（行は増えない）", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);
    const created = await register(actor, matchId);
    await purge(actor, created.body.data.mediaSourceId);

    const res = await register(actor, matchId);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("restored");
    expect(res.body.data.mediaSourceId).toBe(created.body.data.mediaSourceId);

    const rows = await readAsActor(
      actor,
      (tx) =>
        tx<{ id: string; storage_path: string | null; purged_at: Date | null }[]>`
        SELECT id, storage_path, purged_at FROM media_sources WHERE match_id = ${matchId}`,
    );
    expect(rows).toHaveLength(1);
    // 復活している。「一度消したら二度と入れられない」を作らない
    expect(rows[0]!.purged_at).toBeNull();
    expect(rows[0]!.storage_path).toBe(`${matchId}/${SHA_A}.mp3`);
  });

  it("別の指紋なら別の行になる", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);

    await register(actor, matchId, {}, SHA_A);
    const second = await register(
      actor,
      matchId,
      { storagePath: storagePathFor(matchId, SHA_B, "audio/mpeg"), sourceSha256: SHA_B },
      SHA_B,
    );

    expect(second.body.data.status).toBe("created");
    const rows = await readAsActor(
      actor,
      (tx) => tx<{ id: string }[]>`SELECT id FROM media_sources WHERE match_id = ${matchId}`,
    );
    expect(rows).toHaveLength(2);
  });

  it("storagePath がクライアントの申告どおりでも、規則と違えば 400", async () => {
    const actor = newActorId();
    const other = await createMatch(newActorId());
    const matchId = await createMatch(actor);

    // 他の match の領域を指したパスを申告する
    const res = await call<{ error: { code: string } }>(
      registerMediaRoute,
      "POST",
      `/matches/${matchId}/media`,
      {
        actorId: actor,
        params: { id: matchId },
        body: {
          storagePath: storagePathFor(other, SHA_A, "audio/mpeg"),
          sourceSha256: SHA_A,
          durationMs: 2_520_000,
          mime: "audio/mpeg",
          bitrate: null,
          channels: null,
          origin: "upload",
        },
      },
    );

    expect(res.status).toBe(400);
  });

  it("uploaded_by に呼び出した actor が入る", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);
    await register(actor, matchId);

    const rows = await readAsActor(
      actor,
      (tx) =>
        tx<{ uploaded_by: string }[]>`
        SELECT uploaded_by FROM media_sources WHERE match_id = ${matchId}`,
    );
    expect(rows[0]!.uploaded_by).toBe(actor);
  });

  it("M30 他人の match には登録できない（404）", async () => {
    const owner = newActorId();
    const stranger = newActorId();
    const matchId = await createMatch(owner);

    const res = await register(stranger, matchId);

    expect(res.status).toBe(404);
  });
});

describe("GET /media/{id}/playback-url（M31）", () => {
  async function createMedia(actor: string, matchId: string): Promise<string> {
    const res = await register(actor, matchId);
    return res.body.data.mediaSourceId;
  }

  it("短命な署名URLを返す（DBに保存しない）", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);
    const mediaId = await createMedia(actor, matchId);

    const res = await call<{ data: { url: string; expiresAt: string } }>(
      playbackUrlRoute,
      "GET",
      `/media/${mediaId}/playback-url`,
      { actorId: actor, params: { id: mediaId } },
    );

    expect(res.status).toBe(200);
    expect(res.body.data.url).toContain("/storage/v1/object/sign/media/");
    expect(res.body.data.expiresAt).toBeTruthy();

    // URL を保存する列が無いこと。持たせると期限切れのURLが残り続ける
    const columns = await migrator<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'media_sources'`;
    expect(columns.map((c) => c.column_name)).not.toContain("url");
  });

  it("M31 他人の match のメディアは 404（matchIdFrom が効いている）", async () => {
    const owner = newActorId();
    const stranger = newActorId();
    const matchId = await createMatch(owner);
    const mediaId = await createMedia(owner, matchId);

    const res = await call(playbackUrlRoute, "GET", `/media/${mediaId}/playback-url`, {
      actorId: stranger,
      params: { id: mediaId },
    });

    expect(res.status).toBe(404);
  });

  it("存在しない id も 404", async () => {
    const actor = newActorId();
    const res = await call(playbackUrlRoute, "GET", `/media/${randomUUID()}/playback-url`, {
      actorId: actor,
      params: { id: randomUUID() },
    });
    expect(res.status).toBe(404);
  });

  it("A削除済みは 410 RETENTION_PURGED（404 にしない）", async () => {
    const actor = newActorId();
    const matchId = await createMatch(actor);
    const mediaId = await createMedia(actor, matchId);
    await purge(actor, mediaId);

    const res = await call<{ error: { code: string } }>(
      playbackUrlRoute,
      "GET",
      `/media/${mediaId}/playback-url`,
      { actorId: actor, params: { id: mediaId } },
    );

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("RETENTION_PURGED");
  });
});

describe("GET /matches/{id}/media", () => {
  it("自分の match のメディアだけが見える", async () => {
    const actor = newActorId();
    const stranger = newActorId();
    const matchId = await createMatch(actor);
    await register(actor, matchId);

    const mine = await call<{ data: unknown[] }>(
      listMediaRoute,
      "GET",
      `/matches/${matchId}/media`,
      {
        actorId: actor,
        params: { id: matchId },
      },
    );
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);

    const theirs = await call(listMediaRoute, "GET", `/matches/${matchId}/media`, {
      actorId: stranger,
      params: { id: matchId },
    });
    expect(theirs.status).toBe(404);
  });
});
