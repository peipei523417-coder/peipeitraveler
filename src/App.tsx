import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, useNavigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
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

function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleDeepLink = async (event: any) => {
      const url = event?.url || "";

      // Handle share deep links: https://peipeigotravel.lovable.app/share/:code
      const shareMatch = url.match(/\/share\/([^?#]+)/);
      if (shareMatch) {
        navigate(`/share/${shareMatch[1]}`);
        return;
      }

      // Handle OAuth callback — extract tokens from URL fragment and set session
      if (url.includes("oauth-callback") || url.includes("access_token")) {
        console.log("[DeepLink] OAuth callback received:", url.substring(0, 80));

        // Mark OAuth in progress so Index doesn't flash login screen
        sessionStorage.setItem("oauth_returning", "1");

        // Close Chrome Custom Tabs IMMEDIATELY with await
        try {
          const { Browser } = await import("@capacitor/browser");
          await Browser.close();
          console.log("[DeepLink] Browser.close() succeeded");
        } catch (e) {
          console.warn("[DeepLink] Browser.close() failed:", e);
        }

        try {
          // Parse tokens from URL - handle both hash fragment and intent:// format
          let accessToken: string | null = null;
          let refreshToken: string | null = null;
          
          // Try to extract from URL hash/fragment
          const hashIndex = url.indexOf("#");
          if (hashIndex !== -1) {
            const hashPart = url.substring(hashIndex + 1);
            // Handle intent:// format which may have multiple # characters
            const tokenPart = hashPart.split("#")[0]; // Get first fragment (tokens)
            const params = new URLSearchParams(tokenPart);
            accessToken = params.get("access_token");
            refreshToken = params.get("refresh_token");
          }
          
          if (accessToken && refreshToken) {
            console.log("[DeepLink] Setting session from tokens...");
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            
            if (error) {
              console.error("[DeepLink] setSession error:", error);
            } else {
              console.log("[DeepLink] Session set successfully!");
              // Wait for onAuthStateChange to propagate to React state
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        } catch (e) {
          console.error("[DeepLink] OAuth deep link error:", e);
        }

        // Clear the flag and navigate home
        sessionStorage.removeItem("oauth_returning");
        navigate("/", { replace: true });
        return;
      }
    };

    // Listen for Capacitor App URL open events
    const setupListener = async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        CapApp.addListener("appUrlOpen", handleDeepLink);
      } catch {
        // Not on native platform, skip
      }
    };
    setupListener();
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

  // Show initial loader only on first app load
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
