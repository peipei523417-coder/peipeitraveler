# PeiPeiGoTravel - 強大旅行行程規劃 APP

一款專為旅行愛好者設計的行程規劃工具，讓您輕鬆建立、管理和分享您的旅行計畫。

---

## 📱 App Identity

| 項目 | 值 |
|------|-----|
| App Name | `PeiPeiGoTravel` |
| Package ID (Android) | `com.peipeigo.travel` |
| Bundle ID (iOS) | `com.peipeigo.travel` |
| Version | `1.0.0` |
| Version Code | `1` |
| Production URL | `https://peipeigotravel.lovable.app` |
| Privacy Policy | `https://peipeigotravel.lovable.app/privacy-policy` |

---

## 🗄️ 1. Complete Database Schema (Lovable Cloud)

### 1.1 `travel_projects` — 旅行專案

```sql
CREATE TABLE public.travel_projects (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT        NOT NULL,
  start_date      DATE        NOT NULL,
  end_date        DATE        NOT NULL,
  cover_image_url TEXT,
  user_id         UUID,                        -- owner (auth.users.id), NULL = legacy
  is_public       BOOLEAN     NOT NULL DEFAULT false,
  is_shared       BOOLEAN     NOT NULL DEFAULT false,
  visibility      TEXT        NOT NULL DEFAULT 'private',
  edit_password_hash TEXT,                     -- bcrypt hash for edit protection
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 1.2 `itinerary_items` — 行程項目

```sql
CREATE TABLE public.itinerary_items (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id      UUID        NOT NULL REFERENCES travel_projects(id),
  day_number      INTEGER     NOT NULL,
  start_time      TEXT,                        -- HH:mm (24h)
  end_time        TEXT,                        -- HH:mm (24h)
  description     TEXT        NOT NULL,
  google_maps_url TEXT,
  image_url       TEXT,                        -- path in storage bucket
  highlight_color TEXT,                        -- none|yellow|green|blue|pink|purple|orange
  icon_type       TEXT        DEFAULT 'default', -- default|heart|utensils|house|star|alert|question|car
  price           INTEGER,                     -- budget in local currency
  persons         INTEGER     DEFAULT 1,
  user_id         UUID,                        -- creator
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 1.3 `user_profiles` — 使用者資料

```sql
CREATE TABLE public.user_profiles (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL UNIQUE,      -- auth.users.id
  is_pro     BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 1.4 `project_collaborators` — 專案協作者

```sql
CREATE TABLE public.project_collaborators (
  id         UUID              NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID              NOT NULL REFERENCES travel_projects(id),
  email      TEXT              NOT NULL,
  role       collaborator_role NOT NULL DEFAULT 'viewer', -- owner|editor|viewer
  invited_by UUID,
  created_at TIMESTAMPTZ       NOT NULL DEFAULT now()
);
```

### 1.5 `share_links` — 分享連結

```sql
CREATE TABLE public.share_links (
  id            UUID              NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    UUID              NOT NULL REFERENCES travel_projects(id),
  share_code    TEXT              NOT NULL,
  password_hash TEXT,                          -- bcrypt hash (optional)
  default_role  collaborator_role NOT NULL DEFAULT 'viewer',
  expires_at    TIMESTAMPTZ,
  created_by    UUID,
  created_at    TIMESTAMPTZ       NOT NULL DEFAULT now()
);
```

### 1.6 `password_attempts` — 密碼嘗試紀錄

```sql
CREATE TABLE public.password_attempts (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID        NOT NULL REFERENCES travel_projects(id),
  ip_address TEXT        NOT NULL,
  successful BOOLEAN     DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 1.7 `frequent_collaborators` — 常用協作者

```sql
CREATE TABLE public.frequent_collaborators (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID        NOT NULL,
  collaborator_email  TEXT        NOT NULL,
  collaborator_name   TEXT,
  use_count           INTEGER     NOT NULL DEFAULT 1,
  last_used_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 1.8 `travel_groups` & `travel_group_members`

```sql
CREATE TABLE public.travel_groups (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT        NOT NULL,
  user_id    UUID        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.travel_group_members (
  id           UUID              NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id     UUID              NOT NULL REFERENCES travel_groups(id),
  email        TEXT              NOT NULL,
  name         TEXT,
  default_role collaborator_role NOT NULL DEFAULT 'viewer',
  created_at   TIMESTAMPTZ       NOT NULL DEFAULT now()
);
```

### 1.9 Enum

```sql
CREATE TYPE public.collaborator_role AS ENUM ('owner', 'editor', 'viewer');
```

### 1.10 Views (Security Invoker)

```sql
-- public_travel_projects: exposes projects where is_public=true, excludes user_id & edit_password_hash
-- public_itinerary_items: exposes items of public projects, excludes user_id, price, persons
```

### 1.11 Table Relationships (Foreign Keys)

```
travel_projects (1) ──── (N) itinerary_items      via project_id
travel_projects (1) ──── (N) project_collaborators via project_id
travel_projects (1) ──── (N) share_links           via project_id
travel_projects (1) ──── (N) password_attempts     via project_id
travel_groups   (1) ──── (N) travel_group_members  via group_id
```

---

## 🔒 2. RLS Security Policies

### 2.1 `travel_projects`

```sql
ALTER TABLE public.travel_projects ENABLE ROW LEVEL SECURITY;

-- Owners see their own projects
CREATE POLICY "Owners can view their projects directly"
  ON public.travel_projects FOR SELECT
  USING (user_id = auth.uid() OR (user_id IS NULL AND auth.uid() IS NULL));

-- Authenticated users see public projects
CREATE POLICY "Authenticated users can view public projects"
  ON public.travel_projects FOR SELECT
  USING (is_public = true AND auth.uid() IS NOT NULL);

-- Authenticated users create projects
CREATE POLICY "Authenticated users can create projects"
  ON public.travel_projects FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- Anonymous legacy insert
CREATE POLICY "Anonymous users can create legacy projects"
  ON public.travel_projects FOR INSERT
  WITH CHECK (auth.uid() IS NULL AND user_id IS NULL);

-- Owner update/delete
CREATE POLICY "Owners can update their projects"
  ON public.travel_projects FOR UPDATE
  USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Owners can delete their projects"
  ON public.travel_projects FOR DELETE
  USING (user_id = auth.uid() OR user_id IS NULL);
```

### 2.2 `itinerary_items`

```sql
ALTER TABLE public.itinerary_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view items of accessible projects"
  ON public.itinerary_items FOR SELECT
  USING (can_access_project(project_id) OR EXISTS (
    SELECT 1 FROM travel_projects p WHERE p.id = project_id AND p.is_public = true
  ));

CREATE POLICY "Users can create items in their projects"
  ON public.itinerary_items FOR INSERT
  WITH CHECK (can_modify_project(project_id));

CREATE POLICY "Users can update items in their projects"
  ON public.itinerary_items FOR UPDATE
  USING (can_modify_project(project_id));

CREATE POLICY "Users can delete items in their projects"
  ON public.itinerary_items FOR DELETE
  USING (can_modify_project(project_id));
```

### 2.3 `user_profiles`

```sql
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.user_profiles FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
  ON public.user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.user_profiles FOR UPDATE USING (auth.uid() = user_id);
-- No DELETE policy (intentional)
```

### 2.4 `project_collaborators`

```sql
ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;

-- All CRUD restricted to project owner only
CREATE POLICY "Users can view collaborators of their projects"
  ON public.project_collaborators FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = project_collaborators.project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "Users can add collaborators to their projects"
  ON public.project_collaborators FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = project_collaborators.project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "Users can update collaborators in their projects"
  ON public.project_collaborators FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = project_collaborators.project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "Users can remove collaborators from their projects"
  ON public.project_collaborators FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = project_collaborators.project_id AND p.user_id = auth.uid()
  ));
```

### 2.5 `share_links`

```sql
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

-- Owner-only SELECT/INSERT/DELETE (no UPDATE)
CREATE POLICY "Users can view share links of their projects"
  ON public.share_links FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = share_links.project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "Users can create share links for their projects"
  ON public.share_links FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = share_links.project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete share links of their projects"
  ON public.share_links FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM travel_projects p
    WHERE p.id = share_links.project_id AND p.user_id = auth.uid()
  ));
```

### 2.6 `password_attempts`

```sql
ALTER TABLE public.password_attempts ENABLE ROW LEVEL SECURITY;

-- No public access at all
CREATE POLICY "No public access to password attempts"
  ON public.password_attempts FOR SELECT USING (false);
-- No INSERT/UPDATE/DELETE policies (managed by edge functions with service role)
```

### 2.7 `frequent_collaborators`

```sql
ALTER TABLE public.frequent_collaborators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own frequent collaborators"
  ON public.frequent_collaborators FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own frequent collaborators"
  ON public.frequent_collaborators FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own frequent collaborators"
  ON public.frequent_collaborators FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own frequent collaborators"
  ON public.frequent_collaborators FOR DELETE USING (auth.uid() = user_id);
```

### 2.8 `travel_groups` & `travel_group_members`

```sql
-- travel_groups: all CRUD scoped to auth.uid() = user_id
-- travel_group_members: all CRUD scoped to group owner via travel_groups join
```

### 2.9 Security Definer Functions

```sql
-- can_access_project(project_id UUID) → BOOLEAN
-- can_modify_project(project_id UUID) → BOOLEAN
-- is_project_collaborator(p_project_id UUID, p_user_email TEXT) → BOOLEAN
-- get_auth_user_email() → TEXT
-- get_public_project(p_project_id UUID) → TABLE
-- get_shared_project_by_code(p_share_code TEXT) → TABLE
-- validate_share_link(p_share_code TEXT) → TABLE
-- verify_edit_password(p_project_id UUID, p_password_hash TEXT) → BOOLEAN
-- All use: SECURITY DEFINER + SET search_path = public
```

---

## 🏪 3. App Store Metadata

### Short Description (80 chars)
```
Plan, sync & share your travel itinerary — beautifully simple trip organizer.
```

### Full Description
```
PeiPeiGoTravel is your all-in-one travel planning companion. Create stunning visual itineraries, collaborate with travel buddies in real-time, and access your plans offline — all in a beautifully designed interface.

✈️ KEY FEATURES:

• Visual Timeline — See your day-by-day itinerary on a beautiful, color-coded timeline with 8 custom icons (dining, lodging, sightseeing & more)

• Instant Sync — Changes appear in real-time across all devices. Plan together with friends, no matter where they are

• Smart Budget Tracking — Set prices per activity, split costs per person, and keep your trip on budget

• Google Maps Integration — Tap any location to open directions instantly in Google Maps

• Photo Attachments — Add photos to each stop to remember recommendations and reference material

• Share & Collaborate — Generate secure share links with optional password protection. Invite collaborators by email

• Lobby-First Design — Your project list loads instantly with smart caching. Zero spinners, zero wait

• 6 Highlight Colors — Color-code activities (meals in yellow, hotels in blue) for at-a-glance planning

• Multilingual — Full support for 繁體中文 and English

• Privacy First — Your itineraries are private by default. Share only when you choose to

FREE: 1 project, up to 3 days
PRO: Unlimited projects & days
```

### Keywords (10)
```
travel planner, itinerary, trip organizer, travel app, vacation planner, route planning, travel buddy, trip sharing, budget travel, day planner
```

### Category
- Google Play: `Travel & Local`
- App Store: `Travel`

---

## 🛠️ 4. Build & Deploy Commands

### Development
```bash
npm install          # Install dependencies
npm run dev          # Start dev server (localhost:5173)
npm run build        # Production build → dist/
npm run preview      # Preview production build
npm run lint         # ESLint check
npm run test         # Run tests
```

### Native (Capacitor)
```bash
# First-time setup
npx cap add android
npx cap add ios

# After every code change
npm run build
npx cap sync          # Syncs web assets + plugins to native projects

# Open in IDE
npx cap open android  # Opens Android Studio
npx cap open ios      # Opens Xcode

# Run on device/emulator
npx cap run android
npx cap run ios
```

### Pre-Release Checklist
1. Remove `server.url` from `capacitor.config.ts` (if present)
2. `npm run build && npx cap sync`
3. Set version in `android/app/build.gradle` and `ios/App/App/Info.plist`
4. Generate signed APK/AAB (Android) or Archive (iOS)

---

## 🔧 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| State | React Context + TanStack Query |
| Routing | React Router v6 |
| Animation | Framer Motion |
| Drag & Drop | @hello-pangea/dnd |
| i18n | i18next (zh-TW / en) |
| Database | PostgreSQL (Lovable Cloud) |
| Auth | Supabase Auth |
| Storage | Supabase Storage (`project-images`) |
| Edge Functions | Deno |
| Native | Capacitor 8 |

---

## 📄 License

MIT License — Built with ❤️ using [Lovable](https://lovable.dev)
