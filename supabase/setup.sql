-- Dalal Street League (DSL) by FinDeependence · Created by CA Deep Dalal
-- Supabase database setup. Paste the whole file into Supabase > SQL Editor and press Run.
-- Safe to run again: it never deletes players, wallets or contests.
--
-- Rules of this database:
--   * Players can only READ their own rows. Every change to money or contests goes through the functions below.
--   * Wallet balance = sum of a player's rows in dsl_txns (whole rupees). Nothing else stores a balance.
--   * Fees and coins: dsl_rake_bp() and dsl_coins() below mirror rakeBp and COINS in site/js/engine.js. Change both together.
--   * Contests are settled by the GitHub Actions job (scripts/settle.js) using the service key, never by a player.

-- ---------- tables ----------
create table if not exists public.dsl_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  email text not null,
  mobile text not null unique check (mobile ~ '^[6-9][0-9]{9}$'),
  is_owner boolean not null default false,
  joined timestamptz not null default now(),
  last_active timestamptz not null default now()
);

create table if not exists public.dsl_settings (
  id int primary key default 1 check (id = 1),
  upi text not null default '',
  payee text not null default 'CA Deep Dalal'
);
insert into public.dsl_settings (id) values (1) on conflict do nothing;

create table if not exists public.dsl_prices (d date primary key, closes jsonb not null);
create table if not exists public.dsl_quotes (id int primary key default 1 check (id = 1), d date, t timestamptz, px jsonb);

create table if not exists public.dsl_contests (
  id bigint generated always as identity primary key,
  kind text not null, entry int not null,
  duration text not null check (duration in ('day', 'week', 'month')),
  coins int not null, size int not null, joined int not null default 0,
  start_date date not null, end_date date not null,
  status text not null default 'open' check (status in ('open', 'live', 'settled', 'cancelled')),
  private boolean not null default false, code text unique,
  created timestamptz not null default now(),
  settle_date date, gross int, paid int, commission int, settled_at timestamptz,
  lock_at timestamptz, creator uuid
);
-- Upgrades from the first version (safe on a fresh database too).
alter table public.dsl_contests drop constraint if exists dsl_contests_kind_entry_fkey;
drop table if exists public.dsl_types;
alter table public.dsl_contests add column if not exists lock_at timestamptz;
alter table public.dsl_contests add column if not exists creator uuid;
alter table public.dsl_contests drop constraint if exists dsl_contests_shape;
alter table public.dsl_contests add constraint dsl_contests_shape check (kind in ('h2h', 'l10', 'm50', 'custom') and entry in (49, 99, 199, 499, 1000) and size between 2 and 100);
alter table public.dsl_profiles add column if not exists ref_code text unique;
alter table public.dsl_profiles add column if not exists referred_by uuid references public.dsl_profiles (id);
update public.dsl_profiles set ref_code = upper(substr(md5(id::text || random()::text), 1, 8)) where ref_code is null;
create index if not exists dsl_contests_match on public.dsl_contests (kind, entry, duration, end_date) where status = 'open';

create table if not exists public.dsl_entries (
  id bigint generated always as identity primary key,
  contest_id bigint not null references public.dsl_contests (id) on delete cascade,
  uid uuid not null references public.dsl_profiles (id),
  name text not null,
  holdings jsonb not null, cash numeric(14,2) not null,
  value numeric(14,2), rank int, prize int not null default 0,
  created timestamptz not null default now(),
  unique (contest_id, uid)
);
create index if not exists dsl_entries_uid on public.dsl_entries (uid);

create table if not exists public.dsl_requests (
  id bigint generated always as identity primary key,
  uid uuid not null references public.dsl_profiles (id),
  kind text not null check (kind in ('topup', 'withdraw')),
  amt int not null check (amt > 0),
  ref text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  ts timestamptz not null default now(), done_ts timestamptz
);
create unique index if not exists dsl_requests_utr on public.dsl_requests (ref) where kind = 'topup' and status <> 'rejected';
create index if not exists dsl_requests_uid on public.dsl_requests (uid);

create table if not exists public.dsl_txns (
  id bigint generated always as identity primary key,
  uid uuid not null references public.dsl_profiles (id),
  type text not null check (type in ('topup', 'entry', 'prize', 'withdraw', 'refund', 'entry_refund')),
  amt int not null check (amt <> 0),
  cid bigint, rid bigint,
  ts timestamptz not null default now()
);
create index if not exists dsl_txns_uid on public.dsl_txns (uid);

-- ---------- helpers ----------
create or replace function public.dsl_is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from dsl_profiles where id = auth.uid() and is_owner);
$$;
create or replace function public.dsl_in_contest(p_cid bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from dsl_entries where contest_id = p_cid and uid = auth.uid());
$$;
-- Other players' portfolios become visible only when nobody can join any more.
create or replace function public.dsl_can_see_entries(p_cid bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from dsl_contests c where c.id = p_cid and (c.status in ('live', 'settled') or now() >= c.lock_at))
     and exists (select 1 from dsl_entries where contest_id = p_cid and uid = auth.uid());
$$;
create or replace function public.dsl_balance(p_uid uuid) returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(amt), 0)::int from dsl_txns where uid = p_uid;
$$;
create or replace function public.dsl_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;
-- Last day of a contest joined on p_d (same rule as endDate in site/js/engine.js).
create or replace function public.dsl_end_date(p_d date, p_duration text) returns date language plpgsql immutable as $$
declare d date;
begin
  d := case p_duration when 'day' then p_d + 1 when 'week' then p_d + 7 when 'month' then p_d + 30 end;
  if d is null then raise exception 'Unknown contest length.'; end if;
  while extract(isodow from d) > 5 loop d := d + 1; end loop;
  return d;
end $$;
-- DSL commission in basis points of all entries: lower for longer contests, higher with more players (same as rakeBp in engine.js).
create or replace function public.dsl_rake_bp(p_n int, p_duration text) returns int language sql immutable as $$
  select (case p_duration when 'day' then 1200 when 'week' then 1000 when 'month' then 800 end)
       + (case when p_n <= 2 then 0 when p_n <= 5 then 100 when p_n <= 10 then 200 when p_n <= 25 then 300 when p_n <= 50 then 500 else 600 end);
$$;
create or replace function public.dsl_coins(p_entry int) returns int language sql immutable as $$
  select case p_entry when 49 then 50000 when 99 then 100000 when 199 then 200000 when 499 then 500000 when 1000 then 1000000 end;
$$;
-- Entries close when the market next opens after the day a contest was created: 09:15 IST on the next weekday.
create or replace function public.dsl_lock_at(p_start date) returns timestamptz language plpgsql stable as $$
declare d date := p_start + 1;
begin
  while extract(isodow from d) > 5 loop d := d + 1; end loop;
  return (d + time '09:15') at time zone 'Asia/Kolkata';
end $$;
update public.dsl_contests set lock_at = public.dsl_lock_at(start_date) where lock_at is null;
update public.dsl_contests set code = upper(substr(md5(id::text || random()::text), 1, 8)) where code is null;
-- Latest price of every stock: delayed quotes when they are newer than the last official close, otherwise that close.
create or replace function public.dsl_latest_px() returns jsonb language sql stable security definer set search_path = public as $$
  with last as (select d, closes from dsl_prices order by d desc limit 1), q as (select d, t, px from dsl_quotes where id = 1)
  select case
    when (select d from last) is null then null
    when (select d from q) > (select d from last) and (select px from q) is not null
      then jsonb_build_object('date', (select d from q), 'live', true, 'time', (select t from q), 'px', (select closes from last) || (select px from q))
    else jsonb_build_object('date', (select d from last), 'live', false, 'px', (select closes from last))
  end;
$$;

-- ---------- sign-up ----------
create or replace function public.dsl_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'mobile', '') = '' then return new; end if;   -- not created by the app
  insert into dsl_profiles (id, name, email, mobile, ref_code, referred_by)
  values (new.id, btrim(new.raw_user_meta_data ->> 'name'), lower(new.email), new.raw_user_meta_data ->> 'mobile',
    upper(substr(md5(new.id::text || random()::text), 1, 8)),
    (select p.id from dsl_profiles p where p.ref_code = upper(btrim(coalesce(new.raw_user_meta_data ->> 'ref', ''))) limit 1));
  return new;
end $$;
drop trigger if exists dsl_on_auth_user_created on auth.users;
create trigger dsl_on_auth_user_created after insert on auth.users for each row execute function public.dsl_new_user();

create or replace function public.dsl_mobile_taken(p_mobile text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from dsl_profiles where mobile = p_mobile);
$$;
create or replace function public.dsl_touch() returns void language sql security definer set search_path = public as $$
  update dsl_profiles set last_active = now() where id = auth.uid();
$$;
create or replace function public.dsl_my_balance() returns int language sql stable security definer set search_path = public as $$
  select dsl_balance(auth.uid());
$$;

-- ---------- wallet ----------
create or replace function public.dsl_request_topup(p_amt int, p_utr text) returns bigint language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id bigint;
begin
  if v_uid is null or not exists (select 1 from dsl_profiles where id = v_uid) then raise exception 'Please log in again.'; end if;
  if p_amt is null or p_amt < 49 or p_amt > 20000 then raise exception 'Enter an amount between 49 and 20,000.'; end if;
  if p_utr is null or p_utr !~ '^[0-9]{12}$' then raise exception 'Enter the 12-digit UPI reference number from your payment.'; end if;
  if (select upi from dsl_settings where id = 1) = '' then raise exception 'Top-ups are not open yet.'; end if;
  perform pg_advisory_xact_lock(hashtext(v_uid::text));
  if (select count(*) from dsl_requests where uid = v_uid and kind = 'topup' and status = 'pending') >= 3 then raise exception 'You already have 3 top-ups waiting for approval.'; end if;
  begin
    insert into dsl_requests (uid, kind, amt, ref) values (v_uid, 'topup', p_amt, p_utr) returning id into v_id;
  exception when unique_violation then raise exception 'This UPI reference number has already been used.';
  end;
  update dsl_profiles set last_active = now() where id = v_uid;
  return v_id;
end $$;

create or replace function public.dsl_request_withdraw(p_amt int, p_upi text) returns bigint language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id bigint;
begin
  if v_uid is null or not exists (select 1 from dsl_profiles where id = v_uid) then raise exception 'Please log in again.'; end if;
  if p_amt is null or p_amt < 50 then raise exception 'The smallest withdrawal is 50.'; end if;
  if p_upi is null or p_upi !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$' then raise exception 'Enter a valid UPI ID, like name@bank.'; end if;
  perform pg_advisory_xact_lock(hashtext(v_uid::text));
  if p_amt > dsl_balance(v_uid) then raise exception 'You cannot withdraw more than your balance.'; end if;
  insert into dsl_requests (uid, kind, amt, ref) values (v_uid, 'withdraw', p_amt, p_upi) returning id into v_id;
  insert into dsl_txns (uid, type, amt, rid) values (v_uid, 'withdraw', -p_amt, v_id);   -- held until the owner pays or rejects
  update dsl_profiles set last_active = now() where id = v_uid;
  return v_id;
end $$;

-- ---------- contests ----------
create or replace function public.dsl_challenge_info(p_code text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('kind', c.kind, 'entry', c.entry, 'duration', c.duration, 'end_date', c.end_date, 'size', c.size, 'joined', c.joined, 'private', c.private,
    'open', c.status = 'open' and now() < c.lock_at,
    'mine', exists (select 1 from dsl_entries e where e.contest_id = c.id and e.uid = auth.uid()),
    'by', (select e.name from dsl_entries e where e.contest_id = c.id order by e.id limit 1))
  from dsl_contests c where c.code = upper(btrim(p_code)) and auth.uid() is not null;
$$;

-- Join a contest. p_picks = [{"s": "RELIANCE", "q": 9}, ...]. Prices are taken by the server, never from the player.
--   p_code     joins one particular contest (an invite link).
--   p_private  starts a contest that only people with the link can join (1 vs 1 or a custom tournament).
--   p_size     seats of a custom tournament (2 to 100).
-- Every contest gets a code, so players can invite friends to public contests too. Entries close at lock_at.
drop function if exists public.dsl_join(text, int, text, jsonb, boolean, text);
create or replace function public.dsl_join(p_kind text, p_entry int, p_duration text, p_picks jsonb, p_private boolean default false, p_code text default null, p_size int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_name text; v_today date := dsl_today(); v_end date; v_size int; v_coins int; v_private boolean := coalesce(p_private, false);
  v_c dsl_contests%rowtype; v_px jsonb; v_pick jsonb; v_s text; v_p numeric;
  v_hold jsonb := '[]'::jsonb; v_cost numeric := 0; v_n int; v_cid bigint; v_code text; v_joined int; v_lock timestamptz;
begin
  select name into v_name from dsl_profiles where id = v_uid;
  if v_uid is null or v_name is null then raise exception 'Please log in again.'; end if;
  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  if p_code is not null then
    select * into v_c from dsl_contests where code = upper(btrim(p_code)) for update;
    if not found then raise exception 'This invite link is not valid.'; end if;
    if exists (select 1 from dsl_entries where contest_id = v_c.id and uid = v_uid) then raise exception 'You are already in this contest.'; end if;
    if v_c.status <> 'open' or now() >= v_c.lock_at then raise exception 'This contest is full or its entries have closed.'; end if;
    p_kind := v_c.kind; p_entry := v_c.entry; p_duration := v_c.duration; v_end := v_c.end_date; v_size := v_c.size;
  else
    v_end := dsl_end_date(v_today, p_duration);
    v_size := case p_kind when 'h2h' then 2 when 'l10' then 10 when 'm50' then 50 when 'custom' then p_size end;
    if v_size is null or v_size < 2 or v_size > 100 then raise exception 'A tournament needs 2 to 100 players.'; end if;
    if p_kind = 'custom' then v_private := true; end if;
    if v_private and p_kind not in ('h2h', 'custom') then raise exception 'Private contests are 1 vs 1 or a custom tournament.'; end if;
  end if;
  v_coins := dsl_coins(p_entry);
  if v_coins is null then raise exception 'This contest does not exist.'; end if;

  v_px := dsl_latest_px() -> 'px';
  if v_px is null then raise exception 'Stock prices are not available yet. Please try again later.'; end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' then raise exception 'Pick your stocks first.'; end if;
  v_n := jsonb_array_length(p_picks);
  if v_n < 3 then raise exception 'Pick at least 3 different stocks.'; end if;
  if v_n > 40 then raise exception 'You can pick at most 40 stocks.'; end if;
  if (select count(distinct x ->> 's') from jsonb_array_elements(p_picks) x) <> v_n then raise exception 'A stock is listed twice.'; end if;
  for v_pick in select * from jsonb_array_elements(p_picks) loop
    v_s := v_pick ->> 's';
    if v_s is null or coalesce(v_pick ->> 'q', '') !~ '^[1-9][0-9]{0,8}$' then raise exception 'Every stock needs a whole number of shares.'; end if;
    v_p := (v_px ->> v_s)::numeric;
    if v_p is null or v_p <= 0 then raise exception 'No price is available for %.', v_s; end if;
    v_cost := v_cost + (v_pick ->> 'q')::numeric * v_p;
    v_hold := v_hold || jsonb_build_object('s', v_s, 'q', (v_pick ->> 'q')::bigint, 'p', v_p);
  end loop;
  v_cost := round(v_cost, 2);
  if v_cost > v_coins then raise exception 'Prices have moved and your picks now cost more than your coins. Reduce a stock and try again.'; end if;
  if dsl_balance(v_uid) < p_entry then raise exception 'Not enough money in your wallet.'; end if;

  if p_code is not null then
    v_cid := v_c.id;
  else
    if not v_private then
      select c.id into v_cid from dsl_contests c
      where c.kind = p_kind and c.entry = p_entry and c.duration = p_duration and c.end_date = v_end and c.status = 'open' and not c.private and now() < c.lock_at
        and not exists (select 1 from dsl_entries e where e.contest_id = c.id and e.uid = v_uid)
      order by c.id limit 1 for update skip locked;
    end if;
    if v_cid is null then
      insert into dsl_contests (kind, entry, duration, coins, size, start_date, end_date, private, code, lock_at, creator)
      values (p_kind, p_entry, p_duration, v_coins, v_size, v_today, v_end, v_private,
        upper(substr(md5(random()::text || clock_timestamp()::text || v_uid::text), 1, 8)), dsl_lock_at(v_today), v_uid) returning id into v_cid;
    end if;
  end if;

  insert into dsl_entries (contest_id, uid, name, holdings, cash) values (v_cid, v_uid, v_name, v_hold, v_coins - v_cost);
  update dsl_contests set joined = joined + 1, status = case when joined + 1 >= size then 'live' else 'open' end where id = v_cid
    returning joined, code, size, lock_at, private into v_joined, v_code, v_size, v_lock, v_private;
  insert into dsl_txns (uid, type, amt, cid) values (v_uid, 'entry', -p_entry, v_cid);
  update dsl_profiles set last_active = now() where id = v_uid;
  return jsonb_build_object('contest_id', v_cid, 'code', v_code, 'joined', v_joined, 'size', v_size, 'end_date', v_end, 'lock_at', v_lock, 'private', v_private, 'kind', p_kind);
end $$;

-- ---------- settlement (service key only) ----------
-- Entries have closed (lock_at passed): a contest with at least 2 players starts with the players it has,
-- a contest with fewer is cancelled and the entry is returned in full.
drop function if exists public.dsl_cancel_contest(bigint);
create or replace function public.dsl_lock_due() returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c dsl_contests%rowtype; v_started int := 0; v_cancelled int := 0;
begin
  for v_c in select * from dsl_contests where status = 'open' and now() >= lock_at order by id for update loop
    if v_c.joined >= 2 then
      update dsl_contests set status = 'live' where id = v_c.id; v_started := v_started + 1;
    else
      insert into dsl_txns (uid, type, amt, cid) select uid, 'entry_refund', v_c.entry, v_c.id from dsl_entries where contest_id = v_c.id;
      update dsl_contests set status = 'cancelled', settled_at = now() where id = v_c.id; v_cancelled := v_cancelled + 1;
    end if;
  end loop;
  return jsonb_build_object('started', v_started, 'cancelled', v_cancelled);
end $$;

-- p_rows = [{"entry_id": 1, "value": 50123.45, "rank": 1, "prize": 90}, ...] computed by scripts/settle.js with site/js/engine.js.
-- The database re-checks the total: prizes can never exceed the entries minus the DSL fee for that number of players.
create or replace function public.dsl_apply_settlement(p_cid bigint, p_date date, p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c dsl_contests%rowtype; v_gross int; v_pool int; v_paid int; v_n int;
begin
  select * into v_c from dsl_contests where id = p_cid for update;
  if not found then raise exception 'Contest % not found', p_cid; end if;
  if v_c.status <> 'live' then raise exception 'Contest % is %, not live', p_cid, v_c.status; end if;
  if v_c.joined < 2 then raise exception 'Contest % has fewer than 2 players', p_cid; end if;
  if p_date < v_c.end_date or not exists (select 1 from dsl_prices where d = p_date) then raise exception 'Contest % cannot be settled on %', p_cid, p_date; end if;
  if exists (select 1 from dsl_prices where d >= v_c.end_date and d < p_date) then raise exception 'Contest % must use the first closing day on or after its end date', p_cid; end if;
  select count(*), coalesce(sum((r ->> 'prize')::int), 0) into v_n, v_paid from jsonb_array_elements(p_rows) r;
  if v_n <> v_c.joined or (select count(*) from dsl_entries e join jsonb_array_elements(p_rows) r on (r ->> 'entry_id')::bigint = e.id where e.contest_id = p_cid) <> v_c.joined
    then raise exception 'Contest % needs exactly one result for each of its % players', p_cid, v_c.joined; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where (r ->> 'prize')::int < 0 or (r ->> 'rank')::int < 1) then raise exception 'Bad result rows for contest %', p_cid; end if;
  v_gross := v_c.entry * v_c.joined;
  v_pool := (v_gross::bigint * (10000 - dsl_rake_bp(v_c.joined, v_c.duration)) / 10000)::int;
  if v_paid > v_pool then raise exception 'Prizes of contest % are above its prize pool', p_cid; end if;
  update dsl_entries e set value = (r ->> 'value')::numeric, rank = (r ->> 'rank')::int, prize = (r ->> 'prize')::int
    from jsonb_array_elements(p_rows) r where e.id = (r ->> 'entry_id')::bigint and e.contest_id = p_cid;
  insert into dsl_txns (uid, type, amt, cid) select uid, 'prize', prize, p_cid from dsl_entries where contest_id = p_cid and prize > 0;
  update dsl_contests set status = 'settled', settle_date = p_date, gross = v_gross, paid = v_paid, commission = v_gross - v_paid, settled_at = now() where id = p_cid;
  return jsonb_build_object('gross', v_gross, 'paid', v_paid, 'commission', v_gross - v_paid);
end $$;

-- ---------- owner ----------
create or replace function public.dsl_owner_decide(p_rid bigint, p_ok boolean) returns void language plpgsql security definer set search_path = public as $$
declare v_r dsl_requests%rowtype;
begin
  if not dsl_is_owner() then raise exception 'Only the owner can do this.'; end if;
  select * into v_r from dsl_requests where id = p_rid for update;
  if not found or v_r.status <> 'pending' then raise exception 'This request has already been handled.'; end if;
  perform pg_advisory_xact_lock(hashtext(v_r.uid::text));
  update dsl_requests set status = case when p_ok then 'approved' else 'rejected' end, done_ts = now() where id = p_rid;
  if v_r.kind = 'topup' and p_ok then insert into dsl_txns (uid, type, amt, rid) values (v_r.uid, 'topup', v_r.amt, p_rid); end if;
  if v_r.kind = 'withdraw' and not p_ok then insert into dsl_txns (uid, type, amt, rid) values (v_r.uid, 'refund', v_r.amt, p_rid); end if;
end $$;

create or replace function public.dsl_owner_set_payment(p_upi text, p_payee text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not dsl_is_owner() then raise exception 'Only the owner can do this.'; end if;
  if p_upi is null or p_upi !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$' then raise exception 'Enter a valid UPI ID, like name@bank.'; end if;
  if p_payee is null or char_length(btrim(p_payee)) < 2 then raise exception 'Enter the name players will see.'; end if;
  update dsl_settings set upi = p_upi, payee = btrim(p_payee) where id = 1;
end $$;

create or replace function public.dsl_owner_report() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not dsl_is_owner() then raise exception 'Only the owner can do this.'; end if;
  select jsonb_build_object(
    'players', (select count(*) from dsl_profiles),
    'active', (select count(*) from dsl_profiles where last_active > now() - interval '7 days'),
    'new_week', (select count(*) from dsl_profiles where joined > now() - interval '7 days'),
    'in_live', (select count(distinct e.uid) from dsl_entries e join dsl_contests c on c.id = e.contest_id where c.status in ('open', 'live')),
    'total', (select count(*) from dsl_contests),
    'open', (select count(*) from dsl_contests where status = 'open'),
    'live', (select count(*) from dsl_contests where status = 'live'),
    'settled', (select count(*) from dsl_contests where status = 'settled'),
    'cancelled', (select count(*) from dsl_contests where status = 'cancelled'),
    'gross', (select coalesce(sum(gross), 0) from dsl_contests where status = 'settled'),
    'paid', (select coalesce(sum(paid), 0) from dsl_contests where status = 'settled'),
    'commission', (select coalesce(sum(commission), 0) from dsl_contests where status = 'settled'),
    'commission_coming', (select coalesce(sum((c.entry * c.joined)::bigint * dsl_rake_bp(c.joined, c.duration) / 10000), 0) from dsl_contests c where c.status = 'live'),
    'invited', (select count(*) from dsl_profiles where referred_by is not null),
    'by_kind', (select coalesce(jsonb_agg(k order by k ->> 'kind'), '[]'::jsonb) from (
        select jsonb_build_object('kind', kind, 'settled', count(*) filter (where status = 'settled'), 'running', count(*) filter (where status in ('open', 'live')),
          'gross', coalesce(sum(gross) filter (where status = 'settled'), 0), 'paid', coalesce(sum(paid) filter (where status = 'settled'), 0), 'commission', coalesce(sum(commission) filter (where status = 'settled'), 0)) k
        from dsl_contests group by kind) s),
    'topups', (select coalesce(sum(amt), 0) from dsl_txns where type = 'topup'),
    'entries', (select coalesce(-sum(amt), 0) from dsl_txns where type in ('entry', 'entry_refund')),
    'prizes', (select coalesce(sum(amt), 0) from dsl_txns where type = 'prize'),
    'withdrawn', (select coalesce(sum(amt), 0) from dsl_requests where kind = 'withdraw' and status = 'approved'),
    'float', (select coalesce(sum(amt), 0) from dsl_txns),
    'pend_top_n', (select count(*) from dsl_requests where kind = 'topup' and status = 'pending'),
    'pend_top_amt', (select coalesce(sum(amt), 0) from dsl_requests where kind = 'topup' and status = 'pending'),
    'pend_wd_n', (select count(*) from dsl_requests where kind = 'withdraw' and status = 'pending'),
    'pend_wd_amt', (select coalesce(sum(amt), 0) from dsl_requests where kind = 'withdraw' and status = 'pending')
  ) into v;
  return v;
end $$;

drop function if exists public.dsl_owner_players();
create or replace function public.dsl_owner_players() returns table (id uuid, name text, email text, mobile text, joined timestamptz, last_active timestamptz, contests bigint, entries_paid bigint, prizes bigint, balance bigint, invited_by text, friends_invited bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not dsl_is_owner() then raise exception 'Only the owner can do this.'; end if;
  return query
    select p.id, p.name, p.email, p.mobile, p.joined, p.last_active,
      (select count(*) from dsl_entries e where e.uid = p.id),
      (select coalesce(-sum(t.amt), 0) from dsl_txns t where t.uid = p.id and t.type in ('entry', 'entry_refund'))::bigint,
      (select coalesce(sum(t.amt), 0) from dsl_txns t where t.uid = p.id and t.type = 'prize')::bigint,
      (select coalesce(sum(t.amt), 0) from dsl_txns t where t.uid = p.id)::bigint,
      (select r.name from dsl_profiles r where r.id = p.referred_by),
      (select count(*) from dsl_profiles f where f.referred_by = p.id)
    from dsl_profiles p order by p.joined desc;
end $$;

-- Run once in the SQL Editor after you have signed up in the app:  select dsl_make_owner('your@email.com');
create or replace function public.dsl_make_owner(p_email text) returns text language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update dsl_profiles set is_owner = true where email = lower(btrim(p_email));
  get diagnostics v_n = row_count;
  if v_n = 0 then return 'No player with this email. Sign up in the app first, then run this again.'; end if;
  return 'Done. ' || p_email || ' is now the owner. Log out and log in again in the app.';
end $$;

-- ---------- security ----------
alter table public.dsl_profiles enable row level security;
alter table public.dsl_settings enable row level security;
alter table public.dsl_prices enable row level security;
alter table public.dsl_quotes enable row level security;
alter table public.dsl_contests enable row level security;
alter table public.dsl_entries enable row level security;
alter table public.dsl_requests enable row level security;
alter table public.dsl_txns enable row level security;

revoke all on public.dsl_profiles, public.dsl_settings, public.dsl_prices, public.dsl_quotes, public.dsl_contests, public.dsl_entries, public.dsl_requests, public.dsl_txns from anon, authenticated;
grant select on public.dsl_prices, public.dsl_quotes to anon, authenticated;
grant select on public.dsl_profiles, public.dsl_settings, public.dsl_contests, public.dsl_entries, public.dsl_requests, public.dsl_txns to authenticated;
grant all on public.dsl_profiles, public.dsl_settings, public.dsl_prices, public.dsl_quotes, public.dsl_contests, public.dsl_entries, public.dsl_requests, public.dsl_txns to service_role;

drop policy if exists dsl_profiles_read on public.dsl_profiles;
create policy dsl_profiles_read on public.dsl_profiles for select to authenticated using (id = auth.uid() or public.dsl_is_owner());
drop policy if exists dsl_settings_read on public.dsl_settings;
create policy dsl_settings_read on public.dsl_settings for select to authenticated using (true);
drop policy if exists dsl_prices_read on public.dsl_prices;
create policy dsl_prices_read on public.dsl_prices for select to anon, authenticated using (true);
drop policy if exists dsl_quotes_read on public.dsl_quotes;
create policy dsl_quotes_read on public.dsl_quotes for select to anon, authenticated using (true);
drop policy if exists dsl_contests_read on public.dsl_contests;
create policy dsl_contests_read on public.dsl_contests for select to authenticated using (not private or public.dsl_in_contest(id) or public.dsl_is_owner());
drop policy if exists dsl_entries_read on public.dsl_entries;
create policy dsl_entries_read on public.dsl_entries for select to authenticated using (uid = auth.uid() or public.dsl_is_owner() or public.dsl_can_see_entries(contest_id));
drop policy if exists dsl_requests_read on public.dsl_requests;
create policy dsl_requests_read on public.dsl_requests for select to authenticated using (uid = auth.uid() or public.dsl_is_owner());
drop policy if exists dsl_txns_read on public.dsl_txns;
create policy dsl_txns_read on public.dsl_txns for select to authenticated using (uid = auth.uid() or public.dsl_is_owner());

-- Who may call which function.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'dsl\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('dsl_apply_settlement', 'dsl_lock_due') then
      execute format('grant execute on function %s to service_role', f.sig);
    elsif f.proname in ('dsl_make_owner', 'dsl_new_user', 'dsl_balance') then
      null;                                                     -- SQL Editor / internal only
    elsif f.proname in ('dsl_mobile_taken', 'dsl_latest_px', 'dsl_today', 'dsl_end_date', 'dsl_rake_bp', 'dsl_coins', 'dsl_lock_at') then
      execute format('grant execute on function %s to anon, authenticated, service_role', f.sig);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    end if;
  end loop;
end $$;
grant execute on function public.dsl_balance(uuid) to service_role;

notify pgrst, 'reload schema';
select 'Dalal Street League database is ready.' as result;
