import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeshSelfie",
  description: "셀카 기반 Photorealistic Human Mesh 생성 플랫폼",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
