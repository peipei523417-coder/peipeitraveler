import { createContext, useContext, ReactNode } from "react";
import { useProStatus, ProUpgradeSource } from "@/hooks/useProStatus";

interface ProContextType {
  isPro: boolean;
  loading: boolean;
  // New IAP-compliant methods
  requestUpgrade: (source: ProUpgradeSource) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
  completePurchase: (transactionId?: string) => Promise<boolean>;
}

const ProContext = createContext<ProContextType>({
  isPro: false,
  loading: true,
  requestUpgrade: async () => false,
  restorePurchases: async () => false,
  completePurchase: async () => false,
});

export function ProProvider({ children }: { children: ReactNode }) {
  const { 
    isPro, 
    loading, 
    requestUpgrade,
    restorePurchases,
    completePurchase 
  } = useProStatus();

  return (
    <ProContext.Provider value={{ 
      isPro, 
      loading, 
      requestUpgrade,
      restorePurchases,
      completePurchase 
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
