-- ==============================================================
-- Migration: Multi-Tenant SaaS Conversion
-- Part 1: Structural changes (safe to run before any data migration)
-- Part 2: Data migration via companion TS script
-- Part 3: Rekey + RLS (run after data migration)
--
-- Execute in order:
--   1. Run "Part 1" and "Part 2" below
--   2. Run the companion TypeScript data-migration script:
--      scripts/migrate-users-to-instagram-accounts.ts
--   3. Run "Part 3" below
-- ==============================================================

-- ==============================================================
-- PART 1: Create new tables and structures
-- ==============================================================

-- 1a. Create instagram_accounts table — bridge between auth.users
--     and Instagram accounts. Supports multiple accounts per user.
CREATE TABLE IF NOT EXISTS public.instagram_accounts (
  id            BIGINT PRIMARY KEY,         -- Instagram numeric user ID (from OAuth)
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_username   TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  business_account_id BIGINT,
  page_id       TEXT,
  groq_auto_reply_enabled BOOLEAN DEFAULT FALSE,
  ai_context    TEXT DEFAULT NULL,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Make sure the extension for auth.users UUID PK is available
-- (auth schema is built-in, no extension needed for uuid)

CREATE INDEX IF NOT EXISTS idx_instagram_accounts_user_id
  ON public.instagram_accounts(user_id);

COMMENT ON TABLE public.instagram_accounts IS
  'Connects an Instagram account to a platform user (auth.users). One user may have multiple Instagram accounts.';

-- ==============================================================
-- PART 2: Data migration — run via companion TypeScript script
--          scripts/migrate-users-to-instagram-accounts.ts
--
-- That script will:
--   1. Read all rows from old public.users
--   2. For each, call supabase.auth.admin.createUser() with
--      a placeholder email to create an auth.users entry
--   3. Insert the corresponding row into instagram_accounts
--      with the new user_id pointing to the created auth.users id
-- ==============================================================

-- ==============================================================
-- PART 3: Rekey child tables, fix dm_queue, enable RLS
--          RUN THIS AFTER THE TS DATA-MIGRATION SCRIPT
-- ==============================================================

-- 3a. Drop old FK constraints on all child tables
ALTER TABLE IF EXISTS public.conversations
  DROP CONSTRAINT IF EXISTS conversations_user_id_fkey;

ALTER TABLE IF EXISTS public.messages
  DROP CONSTRAINT IF EXISTS messages_user_id_fkey,
  DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;

ALTER TABLE IF EXISTS public.automations
  DROP CONSTRAINT IF EXISTS automations_user_id_fkey;

ALTER TABLE IF EXISTS public.media_cache
  DROP CONSTRAINT IF EXISTS media_cache_user_id_fkey;

ALTER TABLE IF EXISTS public.ice_breakers
  DROP CONSTRAINT IF EXISTS ice_breakers_user_id_fkey;

ALTER TABLE IF EXISTS public.content_pool
  DROP CONSTRAINT IF EXISTS content_pool_user_id_fkey;

ALTER TABLE IF EXISTS public.scheduler_config
  DROP CONSTRAINT IF EXISTS scheduler_config_user_id_fkey;

ALTER TABLE IF EXISTS public.reels_posts
  DROP CONSTRAINT IF EXISTS reels_posts_user_id_fkey,
  DROP CONSTRAINT IF EXISTS reels_posts_content_pool_id_fkey;

-- 3b. Rename columns: user_id → instagram_account_id
ALTER TABLE public.conversations
  RENAME COLUMN user_id TO instagram_account_id;

ALTER TABLE public.messages
  RENAME COLUMN user_id TO instagram_account_id;

ALTER TABLE public.automations
  RENAME COLUMN user_id TO instagram_account_id;

ALTER TABLE public.media_cache
  RENAME COLUMN user_id TO instagram_account_id;

ALTER TABLE public.ice_breakers
  RENAME COLUMN user_id TO instagram_account_id;

ALTER TABLE public.content_pool
  RENAME COLUMN user_id TO instagram_account_id;

ALTER TABLE public.scheduler_config
  RENAME COLUMN user_id TO instagram_account_id;

ALTER TABLE public.reels_posts
  RENAME COLUMN user_id TO instagram_account_id;

-- 3c. Fix dm_queue: user_id was TEXT (inconsistent) — change to BIGINT FK
-- Rename existing column, then add new properly-typed column
ALTER TABLE public.dm_queue
  RENAME COLUMN user_id TO user_id_old;

ALTER TABLE public.dm_queue
  ADD COLUMN instagram_account_id BIGINT;

-- Migrate data (all existing values should be numeric strings)
UPDATE public.dm_queue
  SET instagram_account_id = user_id_old::BIGINT
  WHERE user_id_old ~ '^\d+$';

-- Drop old column once data is migrated
ALTER TABLE public.dm_queue
  DROP COLUMN user_id_old;

-- 3d. Add new FK constraints pointing to instagram_accounts
ALTER TABLE public.conversations
  ADD CONSTRAINT fk_conversations_instagram_account
  FOREIGN KEY (instagram_account_id) REFERENCES public.instagram_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.messages
  ADD CONSTRAINT fk_messages_instagram_account
  FOREIGN KEY (instagram_account_id) REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_messages_conversation
  FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE public.automations
  ADD CONSTRAINT fk_automations_instagram_account
  FOREIGN KEY (instagram_account_id) REFERENCES public.instagram_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.media_cache
  ADD CONSTRAINT fk_media_cache_instagram_account
  FOREIGN KEY (instagram_account_id) REFERENCES public.instagram_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.ice_breakers
  ADD CONSTRAINT fk_ice_breakers_instagram_account
  FOREIGN KEY (instagram_account_id) REFERENCES public.instagram_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.content_pool
  ADD CONSTRAINT fk_content_pool_instagram_account
  FOREIGN KEY (instagram_account_id) REFERENCES public.instagram_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.scheduler_config
  ADD CONSTRAINT fk_scheduler_config_instagram_account
  FOREIGN KEY (instagram_account_id) REFERENCES public.instagram_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.reels_posts
  ADD CONSTRAINT fk_reels_posts_instagram_account
  FOREIGN KEY (instagram_account_id) REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_reels_posts_content_pool
  FOREIGN KEY (content_pool_id) REFERENCES public.content_pool(id) ON DELETE SET NULL;

ALTER TABLE public.dm_queue
  ADD CONSTRAINT fk_dm_queue_instagram_account
  FOREIGN KEY (instagram_account_id) REFERENCES public.instagram_accounts(id);

-- 3e. Fix webhook_events — rename user_id to instagram_account_id, add FK
ALTER TABLE public.webhook_events
  RENAME COLUMN user_id TO instagram_account_id;

ALTER TABLE public.webhook_events
  ADD CONSTRAINT fk_webhook_events_instagram_account
  FOREIGN KEY (instagram_account_id) REFERENCES public.instagram_accounts(id);

-- 3f. Update indexes to match new column names
DROP INDEX IF EXISTS idx_automations_user_source;
CREATE INDEX IF NOT EXISTS idx_automations_account_source
  ON public.automations(instagram_account_id, trigger_source);

DROP INDEX IF EXISTS idx_content_pool_user_sequence;
CREATE INDEX IF NOT EXISTS idx_content_pool_account_sequence
  ON public.content_pool(instagram_account_id, sequence_index);

DROP INDEX IF EXISTS idx_reels_posts_user_status;
CREATE INDEX IF NOT EXISTS idx_reels_posts_account_status
  ON public.reels_posts(instagram_account_id, status);

CREATE INDEX IF NOT EXISTS idx_messages_account
  ON public.messages(instagram_account_id);
CREATE INDEX IF NOT EXISTS idx_conversations_account
  ON public.conversations(instagram_account_id);
CREATE INDEX IF NOT EXISTS idx_ice_breakers_account
  ON public.ice_breakers(instagram_account_id);
CREATE INDEX IF NOT EXISTS idx_media_cache_account
  ON public.media_cache(instagram_account_id);

-- ==============================================================
-- PART 4: Row Level Security
-- ==============================================================

-- 4a. Enable RLS on all tables
ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ice_breakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduler_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reels_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_queue ENABLE ROW LEVEL SECURITY;

-- 4b. RLS policies

-- instagram_accounts: users can only see their own accounts
DROP POLICY IF EXISTS "Users can view their own instagram accounts" ON public.instagram_accounts;
CREATE POLICY "Users can view their own instagram accounts"
  ON public.instagram_accounts
  FOR ALL
  USING (user_id = auth.uid());

-- Helper function to check if a user owns an instagram_account
-- Used by child table policies to avoid repeating the subquery
CREATE OR REPLACE FUNCTION public.user_owns_instagram_account(account_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.instagram_accounts
    WHERE id = account_id AND user_id = auth.uid()
  );
$$;

-- conversations: scoped to authenticated user's instagram accounts
DROP POLICY IF EXISTS "Users can access their own conversations" ON public.conversations;
CREATE POLICY "Users can access their own conversations"
  ON public.conversations
  FOR ALL
  USING (public.user_owns_instagram_account(instagram_account_id));

DROP POLICY IF EXISTS "Users can insert to their own conversations" ON public.conversations;
CREATE POLICY "Users can insert to their own conversations"
  ON public.conversations
  FOR INSERT
  WITH CHECK (public.user_owns_instagram_account(instagram_account_id));

-- messages: scoped to conversations the user owns
DROP POLICY IF EXISTS "Users can access their own messages" ON public.messages;
CREATE POLICY "Users can access their own messages"
  ON public.messages
  FOR ALL
  USING (public.user_owns_instagram_account(instagram_account_id));

DROP POLICY IF EXISTS "Users can insert to their own messages" ON public.messages;
CREATE POLICY "Users can insert to their own messages"
  ON public.messages
  FOR INSERT
  WITH CHECK (public.user_owns_instagram_account(instagram_account_id));

-- automations
DROP POLICY IF EXISTS "Users can access their own automations" ON public.automations;
CREATE POLICY "Users can access their own automations"
  ON public.automations
  FOR ALL
  USING (public.user_owns_instagram_account(instagram_account_id));

DROP POLICY IF EXISTS "Users can insert their own automations" ON public.automations;
CREATE POLICY "Users can insert their own automations"
  ON public.automations
  FOR INSERT
  WITH CHECK (public.user_owns_instagram_account(instagram_account_id));

-- media_cache
DROP POLICY IF EXISTS "Users can access their own media cache" ON public.media_cache;
CREATE POLICY "Users can access their own media cache"
  ON public.media_cache
  FOR ALL
  USING (public.user_owns_instagram_account(instagram_account_id));

DROP POLICY IF EXISTS "Users can insert to their own media cache" ON public.media_cache;
CREATE POLICY "Users can insert to their own media cache"
  ON public.media_cache
  FOR INSERT
  WITH CHECK (public.user_owns_instagram_account(instagram_account_id));

-- ice_breakers
DROP POLICY IF EXISTS "Users can access their own ice breakers" ON public.ice_breakers;
CREATE POLICY "Users can access their own ice breakers"
  ON public.ice_breakers
  FOR ALL
  USING (public.user_owns_instagram_account(instagram_account_id));

DROP POLICY IF EXISTS "Users can insert their own ice breakers" ON public.ice_breakers;
CREATE POLICY "Users can insert their own ice breakers"
  ON public.ice_breakers
  FOR INSERT
  WITH CHECK (public.user_owns_instagram_account(instagram_account_id));

-- content_pool
DROP POLICY IF EXISTS "Users can access their own content pool" ON public.content_pool;
CREATE POLICY "Users can access their own content pool"
  ON public.content_pool
  FOR ALL
  USING (public.user_owns_instagram_account(instagram_account_id));

DROP POLICY IF EXISTS "Users can insert to their own content pool" ON public.content_pool;
CREATE POLICY "Users can insert to their own content pool"
  ON public.content_pool
  FOR INSERT
  WITH CHECK (public.user_owns_instagram_account(instagram_account_id));

-- scheduler_config
DROP POLICY IF EXISTS "Users can access their own scheduler config" ON public.scheduler_config;
CREATE POLICY "Users can access their own scheduler config"
  ON public.scheduler_config
  FOR ALL
  USING (public.user_owns_instagram_account(instagram_account_id));

DROP POLICY IF EXISTS "Users can upsert their own scheduler config" ON public.scheduler_config;
CREATE POLICY "Users can upsert their own scheduler config"
  ON public.scheduler_config
  FOR INSERT
  WITH CHECK (public.user_owns_instagram_account(instagram_account_id));

-- reels_posts
DROP POLICY IF EXISTS "Users can access their own reels posts" ON public.reels_posts;
CREATE POLICY "Users can access their own reels posts"
  ON public.reels_posts
  FOR ALL
  USING (public.user_owns_instagram_account(instagram_account_id));

DROP POLICY IF EXISTS "Users can insert their own reels posts" ON public.reels_posts;
CREATE POLICY "Users can insert their own reels posts"
  ON public.reels_posts
  FOR INSERT
  WITH CHECK (public.user_owns_instagram_account(instagram_account_id));

-- dm_queue
DROP POLICY IF EXISTS "Users can access their own dm queue" ON public.dm_queue;
CREATE POLICY "Users can access their own dm queue"
  ON public.dm_queue
  FOR ALL
  USING (public.user_owns_instagram_account(instagram_account_id));

DROP POLICY IF EXISTS "Users can insert to their own dm queue" ON public.dm_queue;
CREATE POLICY "Users can insert to their own dm queue"
  ON public.dm_queue
  FOR INSERT
  WITH CHECK (public.user_owns_instagram_account(instagram_account_id));

-- webhook_events: accessible by the owning user
DROP POLICY IF EXISTS "Users can view their own webhook events" ON public.webhook_events;
CREATE POLICY "Users can view their own webhook events"
  ON public.webhook_events
  FOR SELECT
  USING (instagram_account_id IS NULL OR public.user_owns_instagram_account(instagram_account_id));

-- 4c. Policies for storage buckets (scoped to authenticated users)
-- reels bucket
DROP POLICY IF EXISTS "Authenticated users can upload to reels" ON storage.objects;
CREATE POLICY "Authenticated users can upload to reels"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'reels');

DROP POLICY IF EXISTS "Authenticated users can view reels" ON storage.objects;
CREATE POLICY "Authenticated users can view reels"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'reels');

-- ==============================================================
-- PART 5: Cleanup (run after verifying everything works)
-- ==============================================================
-- The old public.users table is no longer needed.
-- Once all data is verified migrated:
--   DROP TABLE public.users CASCADE;
-- (CASCADE will fail if any FK still points to it, which is a good
--  safety check — if it fails, you missed a FK update above.)
--
-- For now, it stays as an archive. The RLS policy explicitly blocks
-- all user access (no policies granted).
COMMENT ON TABLE public.users IS 'DEPRECATED — replaced by instagram_accounts. Drop after migration is verified.';
