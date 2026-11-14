import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Inter } from "next/font/google";
import "./globals.css";
import "./paper.css";
import { PAPER_THEME_SCRIPT } from "@/ui/paper-theme";
import { SessionBoot } from "@/auth/SessionBoot";
import { DoorTransition } from "@/world/doorway";
import { ConsoleLayer } from "@/console/ConsoleLayer";
import { SceneHost } from "@/world/SceneHost";

// UI type (docs/UI-DESIGN-SYSTEM.md, SIL OFL 1.1, self-hosted by next/font at build time): Chakra Petch for display
// (titles, chips, buttons, numerals), Inter for body text (chat, menus, descriptions).
const display = Chakra_Petch({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700"], variable: "--font-chakra", display: "swap" });
const ui = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Gukirana Playground",
  description: "Play skill games with real people in a 3D games world.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e0f11",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // browser extensions (e.g. screen recorders) add attributes to <html>/<body> before React hydrates
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${ui.variable}`}>
      <head>
        {/* window theme before first paint (no flash) */}
        <script dangerouslySetInnerHTML={{ __html: PAPER_THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning className="min-h-dvh antialiased">
        <SessionBoot />
        {/* one persistent 3D canvas for the whole session; pages only choose what it shows */}
        <SceneHost />
        {children}
        <DoorTransition />
        <ConsoleLayer />
      </body>
    </html>
  );
}
