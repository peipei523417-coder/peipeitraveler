import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ProUpgradeSource = 'project_limit' | 'day_limit' | 'settings' | 'restore';

export function useProStatus() {
  const { user } = useAuth();
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchProStatus = useCallback(async () => {
    if (!user) {
      setIsPro(false);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("is_pro")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching pro status:", error);
        setIsPro(false);
      } else if (data) {
        setIsPro(data.is_pro);
      } else {
        // Create profile if not exists - new users start as FREE
        const { error: insertError } = await supabase
          .from("user_profiles")
          .insert({ user_id: user.id, is_pro: false });

        if (insertError) {
          console.error("Error creating profile:", insertError);
        }
        setIsPro(false);
      }
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

  /**
   * Request PRO upgrade - This is the IAP-compliant upgrade flow
   * This function should be called when user wants to upgrade to PRO.
   * 
   * For Apple/Google Store compliance:
   * - Do NOT implement external payment links here
   * - This will be replaced with native IAP when packaging for app stores
   * - For web version, can implement Stripe/other payment later
   * 
   * @param source - Where the upgrade request came from (for analytics)
   * @returns Promise<boolean> - True if upgrade dialog should be shown
   */
  const requestUpgrade = useCallback(async (_source: ProUpgradeSource): Promise<boolean> => {
    // Return true to show the upgrade dialog
    // The actual payment flow will be implemented:
    // - For mobile apps: Apple/Google In-App Purchase
    // - For web: Stripe or other payment processor
    return true;
  }, []);

  /**
   * Restore purchases - For App Store compliance
   * This allows users to restore their PRO status on a new device
   * 
   * In production, this will:
   * 1. Query Apple/Google for active subscriptions
   * 2. Verify the subscription status
   * 3. Update the local database if valid
   */
  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!user) return false;

    try {
      // Re-fetch the current status from database
      // In production with IAP, this would:
      // 1. Call native IAP restore API
      // 2. Verify receipt with Apple/Google
      // 3. Update database based on verification result
      await fetchProStatus();
      return isPro;
    } catch (error) {
      console.error("Error restoring purchases:", error);
      return false;
    }
  }, [user, fetchProStatus, isPro]);

  /**
   * Complete PRO upgrade - Called after successful IAP transaction
   * This function should ONLY be called after payment is verified
   * 
   * In production:
   * - For mobile: Called after IAP verification from native layer
   * - For web: Called after Stripe webhook confirms payment
   * 
   * @param transactionId - The IAP transaction ID for record keeping
   */
  const completePurchase = useCallback(async (transactionId?: string): Promise<boolean> => {
    if (!user) return false;

    try {
      // In production, this would also store the transaction ID
      // for future reference and subscription management
      const { error } = await supabase
        .from("user_profiles")
        .upsert({ 
          user_id: user.id, 
          is_pro: true,
          // In production: store transaction_id, purchase_date, etc.
        }, { 
          onConflict: "user_id" 
        });

      if (error) {
        console.error("Error completing purchase:", error);
        return false;
      }

      setIsPro(true);
      return true;
    } catch (error) {
      console.error("Error in completePurchase:", error);
      return false;
    }
  }, [user]);

  // Legacy toggle function - DEPRECATED
  // This is kept for backwards compatibility but should NOT be used
  // for production IAP flows. Use requestUpgrade + completePurchase instead.
  const toggleProStatus = useCallback(async () => {
    console.warn("toggleProStatus is deprecated. Use requestUpgrade() for upgrade flow.");
    
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
    } catch (error) {
      console.error("Error in toggleProStatus:", error);
    }
  }, [user, isPro]);

  return { 
    isPro, 
    loading, 
    // New IAP-compliant methods
    requestUpgrade,
    restorePurchases,
    completePurchase,
    refetch: fetchProStatus,
    // Legacy method - kept for compatibility
    toggleProStatus,
  };
}
