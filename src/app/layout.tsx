import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "饭点 · 香槟今天吃什么",
  description: "香槟饭搭子的吃饭投票：自己选餐馆，或随机抽一家，一起决定这顿吃什么。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
