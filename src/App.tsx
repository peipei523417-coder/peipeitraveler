import { useState, useEffect, useCallback, useRef } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProProvider } from "@/contexts/ProContext";
import { LoadingProvider, useLoading } from "@/contexts/LoadingContext";
import { ProjectCacheProvider } from "@/contexts/ProjectCacheContext";
import { AirplaneLoader } from "@/components/AirplaneLoader";
import { FirstInstallOnboarding } from "@/components/FirstInstallOnboarding";
import Index from "./pages/Index";
import ProjectDetail from "./pages/ProjectDetail";
import SharePage from "./pages/SharePage";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import NotFound from "./pages/NotFound";
import Download from "./pages/Download";
import { BillingDebugOverlay } from "@/components/BillingDebugOverlay";
import { ForceUpdateGate } from "@/components/ForceUpdateGate";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";

const queryClient = new QueryClient();

/**
 * DeepLinkHandler — handles OAuth callbacks and share links on native.
 *
 * v1.0.36: Simplified to only handle:
 * 1. OAuth tokens from deep link (access_token + refresh_token in query params)
 * 2. PKCE code from deep link (code in query params → exchangeCodeForSession)
 * 3. Share links (/share/:code)
 */
function DeepLinkHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const authDebugRef = useRef({ user, authLoading });
  const currentPathRef = useRef(location.pathname);
  const isHandlingRef = useRef(false);

  useEffect(() => {
    authDebugRef.current = { user, authLoading };
  }, [user, authLoading]);

  useEffect(() => {
    currentPathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    let listenerHandle: { remove: () => Promise<void> } | null = null;

    const handleDeepLink = async (event: { url?: string }) => {
      const url = event?.url || "";
      if (!url) return;

      console.log("[DeepLink] Received:", url);

      // ── Share links ──
      const shareMatch = url.match(/\/share\/([^?#\s]+)/);
      if (shareMatch) {
        const code = shareMatch[1].replace(/\/+$/, "");
        navigate(`/share/${code}`);
        return;
      }

      // ── OAuth callback ──
      const isOAuth =
        url.includes("/auth/callback") ||
        url.includes("oauth-callback") ||
        url.includes("access_token") ||
        url.includes("code=");
      if (!isOAuth) return;

      // Prevent duplicate handling
      if (isHandlingRef.current) {
        console.log("[DeepLink] Already handling, skip");
        return;
      }
      isHandlingRef.current = true;

      try {
        // Close external browser immediately
        try {
          const { Browser } = await import("@capacitor/browser");
          await Browser.close();
        } catch {
          // Not available or already closed
        }

        // Parse URL — normalize custom scheme to https for URL parsing
        const normalized = url.replace(/^[^:]+:\/\//, "https://");
        let accessToken: string | null = null;
        let refreshToken: string | null = null;
        let code: string | null = null;

        try {
          const urlObj = new URL(normalized);
          accessToken = urlObj.searchParams.get("access_token");
          refreshToken = urlObj.searchParams.get("refresh_token");
          code = urlObj.searchParams.get("code");
        } catch {
          // Manual regex fallback
          const atMatch = url.match(/access_token=([^&#]+)/);
          const rtMatch = url.match(/refresh_token=([^&#]+)/);
          const codeMatch = url.match(/[?&]code=([^&#]+)/);
          if (atMatch) accessToken = decodeURIComponent(atMatch[1]);
          if (rtMatch) refreshToken = decodeURIComponent(rtMatch[1]);
          if (codeMatch) code = decodeURIComponent(codeMatch[1]);
        }

        // METHOD 1: Direct tokens (implicit flow)
        if (accessToken && refreshToken) {
          console.log("[DeepLink] Setting session from tokens…");
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            console.error("[DeepLink] setSession error:", error);
          } else {
            console.log("[DeepLink] ✅ Session set successfully");
          }
        }
        // METHOD 2: PKCE code exchange
        else if (code) {
          console.log("[DeepLink] Exchanging PKCE code…");
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error("[DeepLink] exchangeCode error:", error);
          } else {
            console.log("[DeepLink] ✅ Code exchanged successfully");
          }
        } else {
          console.warn("[DeepLink] No tokens or code found in URL");
        }

        const currentPath = currentPathRef.current;

        // ── HARD GUARD: never redirect away from a project page ──
        if (currentPath.startsWith("/project")) {
          console.log("[DeepLink] skip redirect on project page", { currentPath });
          return;
        }
        // Also preserve share / other in-app routes
        if (currentPath.startsWith("/share")) {
          console.log("[DeepLink] skip redirect on share page", { currentPath });
          return;
        }

        // Only redirect home from root or explicit auth callback routes
        const shouldReturnHome =
          currentPath === "/" ||
          currentPath.startsWith("/~oauth") ||
          currentPath.startsWith("/auth/callback") ||
          currentPath.startsWith("/oauth-callback");

        if (!shouldReturnHome) {
          console.log("[DeepLink] OAuth handled; preserving current route", { currentPath });
          return;
        }

        const authDebug = authDebugRef.current;
        console.log("GLOBAL REDIRECT FINAL", {
          from: currentPath,
          reason: "DeepLinkHandler OAuth callback completed on root/auth route",
          authLoading: authDebug.authLoading,
          user: authDebug.user,
        });
        navigate("/", { replace: true });
      } catch (e) {
        console.error("[DeepLink] Error:", e);
      } finally {
        // Reset after a delay to allow for any intent re-delivery
        window.setTimeout(() => {
          isHandlingRef.current = false;
        }, 3000);
      }
    };

    const setup = async () => {
      try {
        const [{ App: CapApp }, { Capacitor }] = await Promise.all([
          import("@capacitor/app"),
          import("@capacitor/core"),
        ]);

        if (!Capacitor.isNativePlatform()) return;

        const handle = await CapApp.addListener("appUrlOpen", handleDeepLink);
        if (cancelled) {
          await handle.remove();
          return;
        }
        listenerHandle = handle;

        // Cold-start: check if app was opened via a deep link.
        // Guard against Capacitor returning the SAME launch URL on every
        // cold start (which would re-trap the user on /share/... forever).
        const launchUrl = await CapApp.getLaunchUrl();
        if (!cancelled && launchUrl?.url) {
          let lastHandled: string | null = null;
          try { lastHandled = sessionStorage.getItem("launch_url_handled"); } catch { /* ignore */ }
          if (lastHandled === launchUrl.url) {
            console.log("[DeepLink] Launch URL already handled this session, skip:", launchUrl.url);
          } else {
            try { sessionStorage.setItem("launch_url_handled", launchUrl.url); } catch { /* ignore */ }
            console.log("[DeepLink] Launch URL:", launchUrl.url);
            await handleDeepLink({ url: launchUrl.url });
          }
        }
      } catch {
        // Not native
      }
    };

    setup();

    return () => {
      cancelled = true;
      listenerHandle?.remove();
    };
  }, [navigate]);

  return null;
}

function AppContent() {
  const { hasInitiallyLoaded, markAsLoaded } = useLoading();
  const [showInitialLoader, setShowInitialLoader] = useState(!hasInitiallyLoaded);
  const [isReady, setIsReady] = useState(false);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if (hasInitiallyLoaded) {
      setShowInitialLoader(false);
      setIsReady(true);
      return;
    }

    const timer = setTimeout(() => {
      setIsReady(true);
    }, 100);

    return () => clearTimeout(timer);
  }, [hasInitiallyLoaded]);

  const handleLoaderComplete = () => {
    setShowInitialLoader(false);
    markAsLoaded();
  };

  if (showInitialLoader && !hasInitiallyLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <AirplaneLoader isComplete={isReady} onComplete={handleLoaderComplete} />
      </div>
    );
  }

  return (
    <HashRouter>
      <DeepLinkHandler />
      <FirstInstallOnboarding />
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center text-sm py-1.5 px-4">
          ✈️ 離線模式 — 顯示已快取的專案資料
        </div>
      )}
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
        <Route path="/share/:shareCode" element={<SharePage />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/download" element={<Download />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </HashRouter>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <ProProvider>
        <ProjectCacheProvider>
          <LoadingProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner position="top-center" />
              <BillingDebugOverlay />
              <ForceUpdateGate>
                <AppContent />
              </ForceUpdateGate>
            </TooltipProvider>
          </LoadingProvider>
        </ProjectCacheProvider>
      </ProProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
