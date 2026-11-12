import "@gukirana/ui/tokens.css";

export const metadata = { title: "Gukirana Admin", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "var(--bg)" }}>{children}</body>
    </html>
  );
}
