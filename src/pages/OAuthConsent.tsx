import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";

// Local typed wrapper for the beta supabase.auth.oauth namespace.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
};
const supabaseOAuth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Missing authorization_id");
      const { data: sess } = await supabase.auth.getSession();
      if (!active) return;
      if (!sess.session) {
        setSignedIn(false);
        return;
      }
      setSignedIn(true);
      setUserEmail(sess.session.user?.email ?? null);
      const { data, error } = await supabaseOAuth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function signInWithGoogle() {
    // Preserve the full consent URL (hash route) so we come back here after auth.
    const returnTo = window.location.href;
    try {
      sessionStorage.setItem("oauth_consent_return", returnTo);
    } catch { /* ignore */ }
    await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
  }

  async function decide(approve: boolean) {
    setBusy(true);
    const api = supabaseOAuth();
    const { data, error } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("No redirect returned by the authorization server.");
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-2">
          <h1 className="text-lg font-semibold">連線授權失敗</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </main>
    );
  }

  if (signedIn === false) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-4 text-center">
          <h1 className="text-lg font-semibold">請先登入 PeiTravel</h1>
          <p className="text-sm text-muted-foreground">
            登入後才能授權外部應用使用你的行程資料。
          </p>
          <Button onClick={signInWithGoogle} className="w-full">
            使用 Google 登入
          </Button>
        </div>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 text-sm text-muted-foreground">
        載入中…
      </main>
    );
  }

  const clientName = details.client?.name ?? "外部應用";
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-4">
        <h1 className="text-lg font-semibold">
          將 {clientName} 連接到你的 PeiTravel 帳號
        </h1>
        {userEmail && (
          <p className="text-xs text-muted-foreground">已登入：{userEmail}</p>
        )}
        <p className="text-sm">
          {clientName} 將可以在你登入期間呼叫此應用的 MCP 工具（讀取你的行程資料）。
          不會繞過此應用既有的權限或後端規則。
        </p>
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => decide(false)}
          >
            取消
          </Button>
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() => decide(true)}
          >
            同意授權
          </Button>
        </div>
      </div>
    </main>
  );
}
