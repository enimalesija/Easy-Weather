// apps/web/src/app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "EasyWeather",
  description: "Summon weather like a god",
  manifest: "/manifest.json",
  icons: [
    { rel: "icon", url: "/favicon.ico" },
    { rel: "apple-touch-icon", url: "/icon-192.png" },
    { rel: "apple-touch-icon", url: "/icon-512.png" }
  ]
};

export const viewport: Viewport = {
  themeColor: "#0f172a", // matches your brand
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* link manifest (fallback if Next.js skips it) */}
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        {children}
        {/* Register service worker */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ("serviceWorker" in navigator) {
                window.addEventListener("load", () => {
                  navigator.serviceWorker
                    .register("/service-worker.js")
                    .then(() => console.log("Service worker registered"))
                    .catch((err) => console.warn("SW registration failed", err));
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
