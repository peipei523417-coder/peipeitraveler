import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "hasSeenFirstInstallOnboarding";
const IMAGES = [
  "/assets/onboarding/P001.jpg",
  "/assets/onboarding/P002.jpg",
  "/assets/onboarding/P003.jpg",
  "/assets/onboarding/P004.jpg",
];

/**
 * One-time onboarding shown after first login post-install.
 * Tap anywhere to advance; closes permanently after P004.
 */
export function FirstInstallOnboarding() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!user) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") return;
    } catch {
      return;
    }

    // Preload images (best effort, don't block)
    IMAGES.forEach((src) => {
      try {
        const img = new Image();
        img.src = src;
      } catch {
        /* ignore */
      }
    });

    setIndex(0);
    setVisible(true);
  }, [user]);

  if (!visible) return null;

  const handleTap = () => {
    if (index < IMAGES.length - 1) {
      setIndex((i) => i + 1);
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        /* ignore */
      }
      setVisible(false);
    }
  };

  return (
    <div
      onClick={handleTap}
      className="fixed inset-0 z-[9999] bg-black flex items-center justify-center cursor-pointer select-none"
      style={{ touchAction: "manipulation" }}
    >
      <img
        src={IMAGES[index]}
        alt=""
        draggable={false}
        onError={() => {
          // If image fails, advance so we don't get stuck
          handleTap();
        }}
        className="max-w-full max-h-full object-contain pointer-events-none"
      />
    </div>
  );
}
