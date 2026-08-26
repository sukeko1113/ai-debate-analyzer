/**
 * 画面A: 試合登録（BASIC_DESIGN_v05 §15 / TASKS.md P2）。
 *
 * 認証（Supabase Auth のログイン画面）は P2 の範囲外である。
 * ここではトークンを貼り付けて操作する形にしてある。
 * ログイン導線は Auth を実際に触る PR で入れること。
 */
"use client";

import { useState } from "react";
import { MatchForm } from "./match-form";

export default function NewMatchPage() {
  const [token, setToken] = useState("");

  return (
    <main>
      <h1>試合登録</h1>
      <p>
        HEnDA方式の試合を登録します。座席（A1〜N4）と担当ステージは条項 2.2
        の担当者表に従い、チーム人数（3人 / 4人）で切り替わります。
      </p>

      <p>
        <label htmlFor="token">アクセストークン（Supabase Auth の JWT）</label>
        <input
          id="token"
          data-testid="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </p>

      <MatchForm token={token} />
    </main>
  );
}
