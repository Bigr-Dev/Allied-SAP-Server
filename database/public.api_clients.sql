-- 0) Owner & extensions (adjust owner if needed)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) Table
CREATE TABLE public.api_clients (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT api_clients_pkey PRIMARY KEY (id)
);

-- 2) (Re)apply RLS exactly like your current table
ALTER TABLE public.api_clients ENABLE ROW LEVEL SECURITY;

-- Your existing policy is permissive, ALL, to public, with 'true' qual
CREATE POLICY api_clients_policy
ON public.api_clients
AS PERMISSIVE
FOR ALL
TO public
USING (true);

-- 3) Grants (faithful to what you’ve shown)
-- (Add postgres implicitly owns, but we’ll grant anyway for completeness)
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.api_clients TO postgres;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.api_clients TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.api_clients TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.api_clients TO service_role;

-- 4) Indexes (these are automatically created by the constraints above,
--     included here for clarity; Postgres already added them)
-- CREATE UNIQUE INDEX api_clients_pkey ON public.api_clients USING btree (id);
-- CREATE UNIQUE INDEX api_clients_username_key ON public.api_clients USING btree (username);
