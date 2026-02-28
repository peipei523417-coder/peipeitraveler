import { useState, useEffect, useCallback } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProProvider } from "@/contexts/ProContext";
import { LoadingProvider, useLoading } from "@/contexts/LoadingContext";
import { ProjectCacheProvider } from "@/contexts/ProjectCacheContext";
import { AirplaneLoader } from "@/components/AirplaneLoader";
import Index from "./pages/Index";
import ProjectDetail from "./pages/ProjectDetail";
import SharePage from "./pages/SharePage";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import NotFound from "./pages/NotFound";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";

const queryClient = new QueryClient();

function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleDeepLink = (event: any) => {
      const url = event?.url || "";
      // Handle share deep links: https://peipeigotravel.lovable.app/share/:code
      const shareMatch = url.match(/\/share\/([^?#]+)/);
      if (shareMatch) {
        navigate(`/share/${shareMatch[1]}`);
        return;
      }
      // Handle OAuth callback (Capacitor handles session automatically)
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
    <BrowserRouter>
      <DeepLinkHandler />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
        <Route path="/share/:shareCode" element={<SharePage />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
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
