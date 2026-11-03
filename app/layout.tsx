import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "linote · 保卫个人史",
  description: "保卫个人史，记下每一个想法。",
  icons: {icon:"/icon.png",apple:"/icon.png"},
  manifest: "/manifest.webmanifest",
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
