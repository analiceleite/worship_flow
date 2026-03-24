-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.ministers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE,
  avatar_url text,
  created_at timestamp with time zone DEFAULT now(),
  user_id uuid,
  role text DEFAULT 'minister'::text CHECK (role = ANY (ARRAY['admin'::text, 'minister'::text, 'midia'::text])),
  is_active boolean DEFAULT false,
  instrument text,
  CONSTRAINT ministers_pkey PRIMARY KEY (id),
  CONSTRAINT ministers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.repertoire (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  minister_id uuid,
  song_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  order_index integer DEFAULT 0,
  event_name text,
  CONSTRAINT repertoire_pkey PRIMARY KEY (id),
  CONSTRAINT repertoire_minister_id_fkey FOREIGN KEY (minister_id) REFERENCES public.ministers(id),
  CONSTRAINT repertoire_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id)
);
CREATE TABLE public.schedule_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quarter_id uuid,
  minister_id uuid,
  is_trainee boolean NOT NULL DEFAULT false,
  role_id uuid,
  event_date date NOT NULL,
  event_type text NOT NULL CHECK (event_type = ANY (ARRAY['thursday'::text, 'sunday'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT schedule_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT schedule_assignments_quarter_id_fkey FOREIGN KEY (quarter_id) REFERENCES public.schedule_quarters(id),
  CONSTRAINT schedule_assignments_minister_id_fkey FOREIGN KEY (minister_id) REFERENCES public.ministers(id),
  CONSTRAINT schedule_assignments_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.schedule_roles(id)
);
CREATE TABLE public.schedule_email_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  notification_type text NOT NULL CHECK (notification_type = ANY (ARRAY['quarter_published'::text, 'reminder_7days'::text, 'reminder_1day'::text])),
  quarter_id uuid,
  minister_id uuid NOT NULL,
  event_date date,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  sent_at timestamp with time zone,
  CONSTRAINT schedule_email_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT schedule_email_notifications_quarter_id_fkey FOREIGN KEY (quarter_id) REFERENCES public.schedule_quarters(id),
  CONSTRAINT schedule_email_notifications_minister_id_fkey FOREIGN KEY (minister_id) REFERENCES public.ministers(id)
);
CREATE TABLE public.schedule_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  minister_id uuid,
  event_date date NOT NULL,
  event_type text NOT NULL,
  notification_type text CHECK (notification_type = ANY (ARRAY['7_days'::text, '1_day'::text])),
  sent_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'sent'::text CHECK (status = ANY (ARRAY['sent'::text, 'failed'::text])),
  CONSTRAINT schedule_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT schedule_notifications_minister_id_fkey FOREIGN KEY (minister_id) REFERENCES public.ministers(id)
);
CREATE TABLE public.schedule_quarters (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_published boolean DEFAULT false,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT schedule_quarters_pkey PRIMARY KEY (id),
  CONSTRAINT schedule_quarters_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.ministers(id)
);
CREATE TABLE public.schedule_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text CHECK (category = ANY (ARRAY['ministro'::text, 'vocal'::text, 'instrumento'::text])),
  display_order integer DEFAULT 0,
  CONSTRAINT schedule_roles_pkey PRIMARY KEY (id)
);
CREATE TABLE public.songs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  artist text NOT NULL,
  tone text DEFAULT 'C'::text,
  youtube_url text,
  cipher_url text,
  created_at timestamp with time zone DEFAULT now(),
  capo_frets integer DEFAULT 0,
  minister_id uuid,
  CONSTRAINT songs_pkey PRIMARY KEY (id),
  CONSTRAINT songs_minister_id_fkey FOREIGN KEY (minister_id) REFERENCES public.ministers(id)
);
CREATE TABLE public.special_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  event_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  CONSTRAINT special_events_pkey PRIMARY KEY (id),
  CONSTRAINT special_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.ministers(id)
);