import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface LoadingContextType {
  hasInitiallyLoaded: boolean;
  markAsLoaded: () => void;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);

  const markAsLoaded = useCallback(() => {
    setHasInitiallyLoaded(true);
  }, []);

  return (
    <LoadingContext.Provider value={{ hasInitiallyLoaded, markAsLoaded }}>
      {children}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error("useLoading must be used within a LoadingProvider");
  }
  return context;
}
