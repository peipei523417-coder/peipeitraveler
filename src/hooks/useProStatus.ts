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
      // PRO 權限的真正來源 = RevenueCat entitlement。DB 只是鏡像。
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

      // 永遠以 RevenueCat entitlement 為準
      const hasEntitlement = await checkEntitlements(user.id);

      // 同步 DB
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
    return false;
  }, []);

  /** Execute purchase via RevenueCat — throws on failure so UI shows details */
  const completePurchase = useCallback(async (opts?: { onAlreadyOwned?: () => void }): Promise<boolean> => {
    let success = false;
    try {
      success = await purchasePro({ ...opts, authUserId: user?.id ?? null });
    } catch (error) {
      setIsPro(false);
      if (user) {
        await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, is_pro: false }, { onConflict: "user_id" });
      }
      throw error;
    }
    if (success) {
      setIsPro(true);
      if (user) {
        await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, is_pro: true }, { onConflict: "user_id" });
      }
    } else {
      setIsPro(false);
      if (user) {
        await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, is_pro: false }, { onConflict: "user_id" });
      }
    }
    return success;
  }, [user]);

  /** Restore purchases — throws on failure */
  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    let restored = false;
    try {
      restored = await restoreBilling();
    } catch (error) {
      setIsPro(false);
      await supabase
        .from("user_profiles")
        .upsert({ user_id: user.id, is_pro: false }, { onConflict: "user_id" });
      throw error;
    }
    if (restored) {
      setIsPro(true);
      await supabase
        .from("user_profiles")
        .upsert({ user_id: user.id, is_pro: true }, { onConflict: "user_id" });
    } else {
      setIsPro(false);
      await supabase
        .from("user_profiles")
        .upsert({ user_id: user.id, is_pro: false }, { onConflict: "user_id" });
    }
    return restored;
  }, [user]);

  return {
    isPro,
    loading,
    requestUpgrade,
    restorePurchases,
    completePurchase,
    refetch: fetchProStatus,
  };
}
