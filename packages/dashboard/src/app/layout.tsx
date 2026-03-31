import type { Metadata } from "next";
import { getCharacters } from "@/lib/data";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Opencrush Dashboard",
  description: "Your AI companions — beautifully managed",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const characters = getCharacters();

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        <ThemeProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar characters={characters} />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
