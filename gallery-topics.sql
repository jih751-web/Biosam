begin;
create table public.biosem_gallery_topics (
  name text primary key check(name=btrim(name) and char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
alter table public.biosem_gallery_topics enable row level security;
revoke all on public.biosem_gallery_topics from public,anon,authenticated;
grant select,insert(name) on public.biosem_gallery_topics to authenticated;
create policy biosem_topics_read on public.biosem_gallery_topics for select to authenticated
  using((select biosem_private.is_approved_member()) or (select biosem_private.is_admin()));
create policy biosem_topics_add on public.biosem_gallery_topics for insert to authenticated
  with check((select biosem_private.is_approved_member()) or (select biosem_private.is_admin()));
insert into public.biosem_gallery_topics(name) values('식물'),('미생물'),('기타');
alter table public.biosem_posts add column gallery_topic text references public.biosem_gallery_topics(name);
create index biosem_posts_gallery_topic on public.biosem_posts(gallery_topic);
grant insert(gallery_topic),update(gallery_topic) on public.biosem_posts to authenticated;
commit;
