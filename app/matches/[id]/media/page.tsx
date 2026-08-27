/**
 * 画面B: メディア取り込み（TASKS.md P3）。
 *
 * 認証（Supabase Auth のログイン画面）はまだ無い。画面Aと同じく
 * トークンを貼り付けて操作する形にしてある（HANDOFF.md 件20）。
 * ログイン導線をどの PR で入れるかは未決である。
 */
import { MediaPanel } from "./media-panel";

export default async function MatchMediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main>
      <h1>メディア取り込み</h1>
      <p>
        試合 {id} の音声を取り込みます。ファイル本体はこのブラウザから Supabase Storage へ
        直接送られ、API サーバを通りません。
      </p>
      <MediaPanel matchId={id} />
    </main>
  );
}
