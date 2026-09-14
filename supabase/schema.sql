-- Crumble & Co MVI — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run)
-- Single-table design: right-sized for a micro-bakery's order volume, easy for the owner to read.

create table if not exists public.orders (
  order_num   text primary key,                 -- e.g. 'CC-48392'
  name        text not null,
  email       text not null,
  phone       text,
  items       text not null,                    -- '2× Classic Choc Chip, 1× Red Velvet Dream'
  delivery    text not null,                    -- 'Delivery' | 'Pickup'
  address     text,
  total       text not null,                    -- 'R85'
  status      text not null default 'New'
              check (status in ('New','Paid','Baking','Packing','Ready','Delivered','Cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists orders_email_idx on public.orders (lower(email));

-- Keep updated_at fresh on every change
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- Row-Level Security ON, with NO public policies:
-- nobody (anon or logged-in) can read/write this table directly.
-- The Cloudflare Worker uses the service_role key, which bypasses RLS.
alter table public.orders enable row level security;
