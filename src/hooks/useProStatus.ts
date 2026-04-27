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
  const [isPro, setIsPro] = useState(false);
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
      // Verified native entitlement (false on web, real receipt check on native)
      const hasEntitlement = await checkEntitlements();

      // DB flag — only source of truth besides verified native receipts
      const { data, error } = await supabase
        .from("user_profiles")
        .select("is_pro")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching pro status:", error);
      }

      const dbIsPro = data?.is_pro ?? false;
      const proStatus = hasEntitlement || dbIsPro;

      if (!data) {
        // Create profile defaulting to FREE — never seed is_pro from local cache
        await supabase
          .from("user_profiles")
          .insert({ user_id: user.id, is_pro: false });
      } else if (hasEntitlement && !dbIsPro) {
        // Only sync DB upward when a verified native receipt confirms PRO
        await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, is_pro: true }, { onConflict: "user_id" });
      }

      setIsPro(proStatus);
      setLocalProStatus(proStatus);
    } catch (error) {
      console.error("Error in fetchProStatus:", error);
      // On error, default to FREE — do not trust localStorage for entitlement
      setIsPro(false);
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
