import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionBoot } from "@/auth/SessionBoot";
import { DoorTransition } from "@/world/doorway";

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
  // browser extensions (e.g. screen recorders) add attributes to <html>/<body> before React hydrates
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-dvh antialiased">
        <SessionBoot />
        {children}
        <DoorTransition />
      </body>
    </html>
  );
}
