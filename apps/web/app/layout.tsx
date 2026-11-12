import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionBoot } from "@/auth/SessionBoot";

export const metadata: Metadata = {
  title: "Gukirana Playground",
  description: "Play skill games with real people in a 3D games world.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#22266E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <SessionBoot />
        {children}
      </body>
    </html>
  );
}
