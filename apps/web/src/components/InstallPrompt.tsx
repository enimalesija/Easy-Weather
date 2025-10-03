"use client";
import { useEffect, useState } from "react";

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    });
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-black/80 text-white p-4 rounded-xl shadow-lg">
      <p className="mb-2">📲 Install EasyWeather on your device?</p>
      <button
        className="bg-yellow-500 text-black px-3 py-1 rounded-md"
        onClick={async () => {
          setVisible(false);
          if (deferredPrompt) {
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            console.log("User choice:", choice);
          }
        }}
      >
        Install
      </button>
    </div>
  );
}
