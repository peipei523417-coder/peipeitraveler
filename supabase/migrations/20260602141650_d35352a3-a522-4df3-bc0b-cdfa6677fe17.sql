
CREATE TABLE IF NOT EXISTS public.app_config (
  id text PRIMARY KEY DEFAULT 'global',
  min_ios_version text NOT NULL DEFAULT '0.0.0',
  min_ios_build integer NOT NULL DEFAULT 0,
  latest_ios_version text NOT NULL DEFAULT '0.0.0',
  min_android_version text NOT NULL DEFAULT '0.0.0',
  min_android_version_code integer NOT NULL DEFAULT 0,
  latest_android_version text NOT NULL DEFAULT '0.0.0',
  app_store_url text NOT NULL DEFAULT 'https://apps.apple.com/app/id0',
  play_store_url text NOT NULL DEFAULT 'https://play.google.com/store/apps/details?id=com.peitravel.smartplanner',
  force_update_message text NOT NULL DEFAULT '目前版本需要更新，請更新至最新版後繼續使用。',
  force_update_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_config TO anon;
GRANT SELECT ON public.app_config TO authenticated;
GRANT ALL ON public.app_config TO service_role;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read app_config" ON public.app_config;
CREATE POLICY "Anyone can read app_config"
ON public.app_config
FOR SELECT
TO anon, authenticated
USING (true);

INSERT INTO public.app_config (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;
