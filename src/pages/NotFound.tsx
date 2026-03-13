import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  const isOAuthTransitionRoute =
    location.pathname.startsWith("/~oauth") ||
    location.pathname.startsWith("/auth/callback") ||
    location.pathname.startsWith("/oauth-callback") ||
    location.search.includes("native_callback=1") ||
    location.search.includes("code=") ||
    location.search.includes("state=native_oauth_");

  useEffect(() => {
    if (!isOAuthTransitionRoute) {
      console.error("404 Error: User attempted to access non-existent route:", location.pathname);
    }
  }, [isOAuthTransitionRoute, location.pathname]);

  if (isOAuthTransitionRoute) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <p className="text-muted-foreground">正在返回 App⋯</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
