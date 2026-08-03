create table if not exists public.onboarding_submissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  salon_name text not null,
  phone text not null,
  city text not null,
  salon_type text not null,
  agent_name text not null,
  agent_tone text not null,
  agent_languages jsonb not null,
  booking_software text,
  services jsonb not null default '[]'::jsonb,
  collect_deposit boolean not null default false,
  tier text not null,
  billing text not null,
  payment_method text not null,
  payer_name text not null,
  transaction_reference text,
  receipt_bucket text not null,
  receipt_path text not null,
  receipt_original_name text not null,
  created_at timestamptz not null default now()
);

alter table public.onboarding_submissions enable row level security;

create policy "Superadmins full access - onboarding submissions"
  on public.onboarding_submissions for all
  using (public.is_superadmin());
