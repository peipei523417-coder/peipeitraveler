import { createContext, useContext, ReactNode } from "react";
import { useProStatus, ProUpgradeSource } from "@/hooks/useProStatus";

interface ProContextType {
  isPro: boolean;
  loading: boolean;
  // New IAP-compliant methods
  requestUpgrade: (source: ProUpgradeSource) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
  completePurchase: (transactionId?: string) => Promise<boolean>;
  // Legacy method - kept for compatibility
  toggleProStatus: () => Promise<void>;
}

const ProContext = createContext<ProContextType>({
  isPro: false,
  loading: true,
  requestUpgrade: async () => true,
  restorePurchases: async () => false,
  completePurchase: async () => false,
  toggleProStatus: async () => {},
});

export function ProProvider({ children }: { children: ReactNode }) {
  const { 
    isPro, 
    loading, 
    requestUpgrade,
    restorePurchases,
    completePurchase,
    toggleProStatus 
  } = useProStatus();

  return (
    <ProContext.Provider value={{ 
      isPro, 
      loading, 
      requestUpgrade,
      restorePurchases,
      completePurchase,
      toggleProStatus 
    }}>
      {children}
    </ProContext.Provider>
  );
}

export function usePro() {
  const context = useContext(ProContext);
  if (!context) {
    throw new Error("usePro must be used within a ProProvider");
  }
  return context;
}
