import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProProvider } from "@/contexts/ProContext";
import { LoadingProvider, useLoading } from "@/contexts/LoadingContext";
import { ProjectCacheProvider } from "@/contexts/ProjectCacheContext";
import { AirplaneLoader } from "@/components/AirplaneLoader";
import Index from "./pages/Index";
import ProjectDetail from "./pages/ProjectDetail";
import SharePage from "./pages/SharePage";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import NativeOAuth from "./pages/NativeOAuth";
import NotFound from "./pages/NotFound";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";

const queryClient = new QueryClient();

/**
 * Handles deep links from native app (Capacitor).
 * Specifically handles OAuth callback and share links.
 */
function DeepLinkHandler() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isHandlingOAuthRef = useRef(false);
  const lastHandledOAuthUrlRef = useRef<string | null>(null);

  // Clear oauth_returning flag once auth is confirmed
  useEffect(() => {
    if (user && localStorage.getItem("oauth_returning") === "1") {
      console.log("[DeepLink] Auth confirmed, clearing oauth_returning flag");
      localStorage.removeItem("oauth_returning");
    }
  }, [user]);

  // Safety timeout: clear flag after 10 seconds to prevent permanent blocking
  useEffect(() => {
    if (localStorage.getItem("oauth_returning") === "1") {
      const timeout = setTimeout(() => {
        console.log("[DeepLink] Safety timeout: clearing oauth_returning flag");
        localStorage.removeItem("oauth_returning");
      }, 10000);
      return () => clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    const handleDeepLink = async (event: { url?: string }) => {
      const url = event?.url || "";
      if (!url) return;

      console.log("[DeepLink] Received URL:", url);

      // Handle share deep links: https://peipeigotravel.lovable.app/share/:code
      const shareMatch = url.match(/\/share\/([^?#]+)/);
      if (shareMatch) {
        navigate(`/share/${shareMatch[1]}`);
        return;
      }

      // Handle OAuth callback — extract tokens and set session
      const isOAuthCallback = url.includes("oauth-callback") || url.includes("access_token");
      if (!isOAuthCallback) return;

      // Ignore duplicate callback events with same URL in a short window
      if (isHandlingOAuthRef.current && lastHandledOAuthUrlRef.current === url) {
        console.log("[DeepLink] Duplicate OAuth callback ignored");
        return;
      }
      isHandlingOAuthRef.current = true;
      lastHandledOAuthUrlRef.current = url;

      try {
        console.log("[DeepLink] OAuth callback detected");

        // Mark OAuth in progress — flag will be cleared by user-auth confirmation
        localStorage.setItem("oauth_returning", "1");

        // Close Chrome Custom Tabs IMMEDIATELY
        try {
          const { Browser } = await import("@capacitor/browser");
          await Browser.close();
          console.log("[DeepLink] Browser.close() succeeded");
        } catch (e) {
          console.warn("[DeepLink] Browser.close() failed:", e);
        }

        let accessToken: string | null = null;
        let refreshToken: string | null = null;

        // METHOD 1: Parse from query parameters (most reliable on Android)
        try {
          const normalizedUrl = url.replace(/^[^:]+:\/\//, "https://");
          const urlObj = new URL(normalizedUrl);
          accessToken = urlObj.searchParams.get("access_token");
          refreshToken = urlObj.searchParams.get("refresh_token");
          if (accessToken) {
            console.log("[DeepLink] Tokens found in query params");
          }
        } catch {
          console.log("[DeepLink] URL() parsing failed, trying manual parse");
        }

        // METHOD 2: Fallback — parse from fragment
        if (!accessToken || !refreshToken) {
          const hashIndex = url.indexOf("#");
          if (hashIndex !== -1) {
            const hashPart = url.substring(hashIndex + 1);
            const tokenPart = hashPart.split("#")[0];
            const params = new URLSearchParams(tokenPart);
            accessToken = accessToken || params.get("access_token");
            refreshToken = refreshToken || params.get("refresh_token");
            if (accessToken) {
              console.log("[DeepLink] Tokens found in fragment");
            }
          }
        }

        // METHOD 3: Fallback — manual regex extraction
        if (!accessToken || !refreshToken) {
          const atMatch = url.match(/access_token=([^&#]+)/);
          const rtMatch = url.match(/refresh_token=([^&#]+)/);
          if (atMatch) accessToken = decodeURIComponent(atMatch[1]);
          if (rtMatch) refreshToken = decodeURIComponent(rtMatch[1]);
          if (accessToken) {
            console.log("[DeepLink] Tokens found via regex");
          }
        }

        if (accessToken && refreshToken) {
          console.log("[DeepLink] Setting session from tokens...");
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            console.error("[DeepLink] setSession error:", error);
            localStorage.removeItem("oauth_returning");
          } else {
            console.log("[DeepLink] Session set successfully!");
          }
        } else {
          console.error("[DeepLink] No tokens found in URL:", url);
          localStorage.removeItem("oauth_returning");
        }
      } catch (e) {
        console.error("[DeepLink] OAuth deep link error:", e);
        localStorage.removeItem("oauth_returning");
      } finally {
        window.setTimeout(() => {
          isHandlingOAuthRef.current = false;
          lastHandledOAuthUrlRef.current = null;
        }, 1500);
      }

      // Navigate home
      navigate("/", { replace: true });
    };

    // Listen for Capacitor App URL open events
    let cancelled = false;
    let listenerHandle: { remove: () => Promise<void> } | null = null;

    const setupListener = async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        const handle = await CapApp.addListener("appUrlOpen", handleDeepLink);

        if (cancelled) {
          await handle.remove();
          return;
        }

        listenerHandle = handle;
      } catch {
        // Not on native platform, skip
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      if (listenerHandle) {
        void listenerHandle.remove();
      }
    };
  }, [navigate]);

  return null;
}

function AppContent() {
  const { hasInitiallyLoaded, markAsLoaded } = useLoading();
  const [showInitialLoader, setShowInitialLoader] = useState(!hasInitiallyLoaded);
  const [isReady, setIsReady] = useState(false);

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
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
        <Route path="/share/:shareCode" element={<SharePage />} />
        <Route path="/native-oauth" element={<NativeOAuth />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
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
              <AppContent />
            </TooltipProvider>
          </LoadingProvider>
        </ProjectCacheProvider>
      </ProProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
