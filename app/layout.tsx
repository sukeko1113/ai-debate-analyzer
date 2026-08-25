import type { ReactNode } from "react";

export const metadata = {
  title: "ai-debate-analyzer",
  description: "HEnDA方式の英語ディベート試合を解析し、フローシートと判定資料を作る",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
