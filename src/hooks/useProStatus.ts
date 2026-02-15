import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  getLocalProStatus,
  setLocalProStatus,
  checkEntitlements,
  purchasePro,
  restorePurchases as restoreBilling,
  initBilling,
} from "@/services/billingService";

export type ProUpgradeSource = 'project_limit' | 'day_limit' | 'settings' | 'restore';

export function useProStatus() {
  const { user } = useAuth();
  const [isPro, setIsPro] = useState(() => getLocalProStatus());
  const [loading, setLoading] = useState(true);

  // Initialize billing on mount
  useEffect(() => {
    initBilling();
  }, []);

  const fetchProStatus = useCallback(async () => {
    if (!user) {
      setIsPro(false);
      setLocalProStatus(false);
      setLoading(false);
      return;
    }

    try {
      // Check native entitlements first (will fall back to localStorage on web)
      const hasEntitlement = await checkEntitlements();
      
      // Also check database
      const { data, error } = await supabase
        .from("user_profiles")
        .select("is_pro")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching pro status:", error);
      }
      
      // PRO if either native entitlement OR database says so
      const proStatus = hasEntitlement || (data?.is_pro ?? false);
      
      if (!data) {
        // Create profile if not exists
        await supabase
          .from("user_profiles")
          .insert({ user_id: user.id, is_pro: proStatus });
      } else if (proStatus !== data.is_pro) {
        // Sync database with native status
        await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, is_pro: proStatus }, { onConflict: "user_id" });
      }

      setIsPro(proStatus);
      setLocalProStatus(proStatus);
    } catch (error) {
      console.error("Error in fetchProStatus:", error);
      // Fall back to localStorage
      setIsPro(getLocalProStatus());
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProStatus();
  }, [fetchProStatus]);

  /**
   * Request PRO upgrade — triggers native Apple/Google payment sheet
   */
  const requestUpgrade = useCallback(async (_source: ProUpgradeSource): Promise<boolean> => {
    return true; // Show upgrade dialog
  }, []);

  /**
   * Execute purchase via native IAP
   */
  const completePurchase = useCallback(async (): Promise<boolean> => {
    try {
      const success = await purchasePro();
      if (success) {
        setIsPro(true);
        setLocalProStatus(true);
        
        // Sync to database
        if (user) {
          await supabase
            .from("user_profiles")
            .upsert({ user_id: user.id, is_pro: true }, { onConflict: "user_id" });
        }
      }
      return success;
    } catch (error) {
      console.error("Error in completePurchase:", error);
      return false;
    }
  }, [user]);

  /**
   * Restore purchases — REQUIRED for iOS App Store review
   */
  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!user) return false;

    try {
      const restored = await restoreBilling();
      if (restored) {
        setIsPro(true);
        setLocalProStatus(true);
        await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, is_pro: true }, { onConflict: "user_id" });
      }
      return restored;
    } catch (error) {
      console.error("Error restoring purchases:", error);
      return false;
    }
  }, [user]);

  // Legacy toggle — kept for dev testing only
  const toggleProStatus = useCallback(async () => {
    if (!user) return;
    try {
      const newStatus = !isPro;
      const { error } = await supabase
        .from("user_profiles")
        .upsert({ user_id: user.id, is_pro: newStatus }, { onConflict: "user_id" });
      if (error) {
        console.error("Error toggling pro status:", error);
        return;
      }
      setIsPro(newStatus);
      setLocalProStatus(newStatus);
    } catch (error) {
      console.error("Error in toggleProStatus:", error);
    }
  }, [user, isPro]);

  return { 
    isPro, 
    loading, 
    requestUpgrade,
    restorePurchases,
    completePurchase,
    refetch: fetchProStatus,
    toggleProStatus,
  };
}
