import "@gukirana/ui/tokens.css";

export const metadata = { title: "Gukirana Admin", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // browser extensions (e.g. screen recorders) add attributes to <html>/<body> before React hydrates
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "var(--bg)" }}>{children}</body>
    </html>
  );
}
