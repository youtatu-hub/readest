-- Migration 019: Permit AI conversation metadata, messages, and binary images.
-- AI history is split into small rows so long chats and attachments do not
-- exceed the Replica JSON row cap. The client schema remains the primary
-- validation layer; this CHECK rejects unknown kinds at the database boundary.

ALTER TABLE public.replicas
  DROP CONSTRAINT IF EXISTS replicas_kind_allowlist;

ALTER TABLE public.replicas
  ADD CONSTRAINT replicas_kind_allowlist
  CHECK (
    kind IN (
      'dictionary',
      'font',
      'texture',
      'opds_catalog',
      'settings',
      'ai_chat',
      'ai_chat_message',
      'ai_chat_attachment'
    )
  );
