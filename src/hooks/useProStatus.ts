import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
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

  // Initialize billing on mount (best-effort; missing key won't crash)
  useEffect(() => {
    initBilling().catch((e) => console.warn("[useProStatus] initBilling:", e?.message || e));
  }, []);

  const fetchProStatus = useCallback(async () => {
    if (!user) {
      setIsPro(false);
      setLoading(false);
      return;
    }

    // Default to FREE before any check completes — never trust local cache
    setIsPro(false);

    try {
      // RevenueCat entitlement is the source of truth for PRO status. DB only mirrors it.
      const { data } = await supabase
        .from("user_profiles")
        .select("is_pro")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!data) {
        await supabase
          .from("user_profiles")
          .insert({ user_id: user.id, is_pro: false });
      }

      // Always use RevenueCat entitlement as source of truth
      const hasEntitlement = await checkEntitlements();

      // Sync DB
      if ((data?.is_pro ?? false) !== hasEntitlement) {
        await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, is_pro: hasEntitlement }, { onConflict: "user_id" });
      }

      setIsPro(hasEntitlement);
    } catch (error) {
      console.error("Error in fetchProStatus:", error);
      setIsPro(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProStatus();
  }, [fetchProStatus]);

  const requestUpgrade = useCallback(async (_source: ProUpgradeSource): Promise<boolean> => {
    return true;
  }, []);

  /** Execute purchase via RevenueCat — throws on failure so UI shows details */
  const completePurchase = useCallback(async (): Promise<boolean> => {
    const success = await purchasePro();
    if (success) {
      setIsPro(true);
      if (user) {
        await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, is_pro: true }, { onConflict: "user_id" });
      }
    }
    return success;
  }, [user]);

  /** Restore purchases — throws on failure */
  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    const restored = await restoreBilling();
    if (restored) {
      setIsPro(true);
      await supabase
        .from("user_profiles")
        .upsert({ user_id: user.id, is_pro: true }, { onConflict: "user_id" });
    }
    return restored;
  }, [user]);

  // Legacy toggle — dev only
  const toggleProStatus = useCallback(async () => {
    if (!user) return;
    try {
      const newStatus = !isPro;
      const { error } = await supabase
        .from("user_profiles")
        .upsert({ user_id: user.id, is_pro: newStatus }, { onConflict: "user_id" });
      if (error) return;
      setIsPro(newStatus);
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
