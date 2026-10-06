-- Apply once to the selected BioSEM Supabase project after connection.
-- No seed users, credentials or real personal data are included.
begin;
create schema if not exists biosem_private;
revoke all on schema biosem_private from public, anon, authenticated;
grant usage on schema biosem_private to authenticated;

create table biosem_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table biosem_private.admins enable row level security;
revoke all on biosem_private.admins from public, anon, authenticated;

create table biosem_private.settings (
  singleton boolean primary key default true check(singleton),
  accepting_applications boolean not null default false
);
insert into biosem_private.settings(singleton,accepting_applications) values(true,false);
alter table biosem_private.settings enable row level security;
revoke all on biosem_private.settings from public,anon,authenticated;

create function biosem_private.has_verified_identity() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from auth.users u where u.id = (select auth.uid())
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
  );
$$;
create function biosem_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and biosem_private.has_verified_identity()
    and exists (select 1 from biosem_private.admins a where a.user_id = (select auth.uid()));
$$;
revoke all on function biosem_private.has_verified_identity(),biosem_private.is_admin() from public,anon,authenticated;
grant execute on function biosem_private.has_verified_identity(),biosem_private.is_admin() to authenticated;

create function biosem_private.applications_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists(
    select 1 from biosem_private.settings s where s.singleton and s.accepting_applications
  );
$$;
revoke all on function biosem_private.applications_open() from public,anon,authenticated;
grant execute on function biosem_private.applications_open() to authenticated;

create table public.biosem_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  real_name text not null check(char_length(btrim(real_name)) between 2 and 40),
  institution text not null check(char_length(btrim(institution)) between 2 and 100),
  phone text not null check(phone ~ '^0[0-9]{8,10}$'),
  interest text not null check(char_length(btrim(interest)) between 2 and 80),
  introduction text not null default '' check(char_length(introduction) <= 500),
  consent_version text not null check(consent_version = '2026-10-06'),
  status text not null default 'pending' check(status in ('pending','approved','rejected','suspended')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text not null default '' check(char_length(review_note) <= 500)
);
create index biosem_memberships_queue on public.biosem_memberships(status,submitted_at desc);
alter table public.biosem_memberships enable row level security;
revoke all on public.biosem_memberships from public,anon,authenticated;
grant select on public.biosem_memberships to authenticated;
grant insert(user_id,real_name,institution,phone,interest,introduction,consent_version) on public.biosem_memberships to authenticated;
grant update(status,review_note) on public.biosem_memberships to authenticated;
create policy biosem_membership_read on public.biosem_memberships for select to authenticated
  using(user_id = (select auth.uid()) or (select biosem_private.is_admin()));
create policy biosem_membership_apply on public.biosem_memberships for insert to authenticated
  with check(user_id = (select auth.uid()) and status = 'pending' and (select biosem_private.has_verified_identity()) and (select biosem_private.applications_open()));
create policy biosem_membership_review on public.biosem_memberships for update to authenticated
  using((select biosem_private.is_admin())) with check((select biosem_private.is_admin()));

create table public.biosem_review_log (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.biosem_memberships(user_id) on delete cascade,
  reviewer_id uuid references auth.users(id) on delete set null,
  previous_status text not null,
  next_status text not null,
  note text not null,
  created_at timestamptz not null default now()
);
create index biosem_review_log_member on public.biosem_review_log(member_id,created_at desc);
create index biosem_review_log_reviewer on public.biosem_review_log(reviewer_id);
create index biosem_memberships_reviewer on public.biosem_memberships(reviewed_by);
alter table public.biosem_review_log enable row level security;
revoke all on public.biosem_review_log from public,anon,authenticated;
grant select on public.biosem_review_log to authenticated;
create policy biosem_audit_read on public.biosem_review_log for select to authenticated using((select biosem_private.is_admin()));

create function biosem_private.guard_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not biosem_private.is_admin() then
    raise exception '운영진만 회원 상태를 변경할 수 있습니다.' using errcode='42501';
  end if;
  if not ((old.status='pending' and new.status in ('approved','rejected'))
    or (old.status='approved' and new.status='suspended')
    or (old.status='suspended' and new.status='approved')
    or (old.status='rejected' and new.status='pending')) then
    raise exception '허용되지 않는 상태 변경입니다.' using errcode='23514';
  end if;
  if new.user_id <> old.user_id then raise exception '회원 ID를 바꿀 수 없습니다.'; end if;
  if new.status in ('rejected','suspended') and char_length(btrim(new.review_note)) < 2 then
    raise exception '반려 또는 정지 사유를 입력해 주세요.' using errcode='23514';
  end if;
  new.reviewed_at=now(); new.reviewed_by=(select auth.uid());
  insert into public.biosem_review_log(member_id,reviewer_id,previous_status,next_status,note)
    values(old.user_id,new.reviewed_by,old.status,new.status,new.review_note);
  return new;
end;
$$;
revoke all on function biosem_private.guard_review() from public,anon,authenticated;
create trigger biosem_review_guard before update on public.biosem_memberships
  for each row execute function biosem_private.guard_review();

create function public.biosem_review_member(p_user_id uuid,p_expected_status text,p_status text,p_note text default '')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare changed public.biosem_memberships;
begin
  if not biosem_private.is_admin() then raise exception '운영진 권한이 필요합니다.' using errcode='42501'; end if;
  update public.biosem_memberships set status=p_status,review_note=btrim(coalesce(p_note,''))
    where user_id=p_user_id and status=p_expected_status returning * into changed;
  if not found then raise exception '다른 운영진이 상태를 변경했습니다. 목록을 새로고침해 주세요.' using errcode='40001'; end if;
  return to_jsonb(changed);
end;
$$;
create function public.biosem_is_admin() returns boolean language sql stable security invoker set search_path = '' as $$
  select biosem_private.is_admin();
$$;
revoke all on function public.biosem_review_member(uuid,text,text,text),public.biosem_is_admin() from public,anon,authenticated;
grant execute on function public.biosem_review_member(uuid,text,text,text),public.biosem_is_admin() to authenticated;

create function public.biosem_list_members(p_status text default 'pending',p_search text default '',p_page integer default 0)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result_rows jsonb; result_total bigint; result_counts jsonb;
begin
  if not biosem_private.is_admin() then raise exception '운영진 권한이 필요합니다.' using errcode='42501'; end if;
  if p_status not in ('all','pending','approved','rejected','suspended') or p_status is null
    or p_page is null or p_page < 0 or p_page > 100000 or char_length(coalesce(p_search,'')) > 100 then
    raise exception '목록 조회 조건을 확인해 주세요.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) into result_rows from (
    select * from public.biosem_memberships
    where (p_status='all' or status=p_status)
      and position(lower(btrim(coalesce(p_search,''))) in lower(real_name||' '||institution)) > 0
    order by submitted_at desc,user_id limit 25 offset p_page * 25
  ) m;
  select count(*) into result_total from public.biosem_memberships
    where (p_status='all' or status=p_status)
      and position(lower(btrim(coalesce(p_search,''))) in lower(real_name||' '||institution)) > 0;
  select jsonb_build_object('pending',count(*) filter(where status='pending'),
    'approved',count(*) filter(where status='approved'),'rejected',count(*) filter(where status='rejected'),
    'suspended',count(*) filter(where status='suspended')) into result_counts from public.biosem_memberships;
  return jsonb_build_object('rows',result_rows,'total',result_total,'counts',result_counts);
end;
$$;
revoke all on function public.biosem_list_members(text,text,integer) from public,anon,authenticated;
grant execute on function public.biosem_list_members(text,text,integer) to authenticated;

create function biosem_private.is_approved_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and biosem_private.has_verified_identity()
    and exists(select 1 from public.biosem_memberships m where m.user_id=(select auth.uid()) and m.status='approved');
$$;
revoke all on function biosem_private.is_approved_member() from public,anon,authenticated;
grant execute on function biosem_private.is_approved_member() to authenticated;
create table public.biosem_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  category text not null check(category in ('자유 나눔','질문과 답변','교육 자료')),
  title text not null check(char_length(btrim(title)) between 2 and 120),
  body text not null check(char_length(btrim(body)) between 2 and 10000),
  created_at timestamptz not null default now()
);
create index biosem_posts_category_date on public.biosem_posts(category,created_at desc);
create index biosem_posts_author on public.biosem_posts(author_id);
alter table public.biosem_posts enable row level security;
revoke all on public.biosem_posts from public,anon,authenticated;
grant select on public.biosem_posts to authenticated;
grant insert(author_id,category,title,body) on public.biosem_posts to authenticated;
create policy biosem_posts_read on public.biosem_posts for select to authenticated
  using((select biosem_private.is_approved_member()) or (select biosem_private.is_admin()));
create policy biosem_posts_create on public.biosem_posts for insert to authenticated
  with check(author_id=(select auth.uid()) and ((select biosem_private.is_approved_member()) or (select biosem_private.is_admin())));
commit;
