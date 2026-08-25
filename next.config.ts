import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * `*.dev.tsx` を「ページとして扱う拡張子」に含めるのは開発サーバのときだけ。
 * これにより app/dev/media-probe/page.dev.tsx は production ビルドの
 * ルートに現れない（scripts/check-dev-routes.ts が実際に確かめる）。
 */
export default function config(phase: string): NextConfig {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    pageExtensions: isDev ? ["tsx", "ts", "dev.tsx"] : ["tsx", "ts"],
    typedRoutes: false,
    // next dev が CLAUDE.md へ自前の説明ブロックを追記するのを止める。
    // CLAUDE.md はこのプロジェクトの設計の正本であり、ツールに書き換えさせない。
    agentRules: false,
  };
}
