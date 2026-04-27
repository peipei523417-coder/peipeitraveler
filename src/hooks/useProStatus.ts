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

    // Default to FREE before any check completes — never trust cached state
    setIsPro(false);

    try {
      // Source of truth = DB. Verified native receipts can upgrade DB upward.
      const { data, error } = await supabase
        .from("user_profiles")
        .select("is_pro")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching pro status:", error);
      }

      const dbIsPro = data?.is_pro ?? false;

      if (!data) {
        // New user → create profile defaulting to FREE
        await supabase
          .from("user_profiles")
          .insert({ user_id: user.id, is_pro: false });
      }

      // Only check native store entitlement if DB says NOT pro
      // (avoids slowing every login with a store call)
      let hasEntitlement = false;
      if (!dbIsPro) {
        hasEntitlement = await checkEntitlements();
        if (hasEntitlement) {
          await supabase
            .from("user_profiles")
            .upsert({ user_id: user.id, is_pro: true }, { onConflict: "user_id" });
        }
      }

      const proStatus = dbIsPro || hasEntitlement;
      setIsPro(proStatus);
      setLocalProStatus(proStatus);
    } catch (error) {
      console.error("Error in fetchProStatus:", error);
      setIsPro(false);
      setLocalProStatus(false);
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
