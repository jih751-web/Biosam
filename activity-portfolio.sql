begin;
alter table public.biosem_posts add column activity_date date
  check(activity_date between date '1900-01-01' and date '9999-12-31');
grant insert(activity_date),update(activity_date) on public.biosem_posts to authenticated;
alter table public.biosem_posts add column portfolio_public boolean not null default false;
grant insert(portfolio_public),update(portfolio_public) on public.biosem_posts to authenticated;
grant select(id,title,body,category,created_at,activity_date,published,portfolio_public) on public.biosem_posts to anon;
create policy biosem_public_portfolio_read on public.biosem_posts for select to anon,authenticated
  using(category='활동 기록' and published and portfolio_public);
grant select(id,post_id,object_path,filename,mime,bytes) on public.biosem_attachments to anon;
alter policy biosem_attachments_read on public.biosem_attachments
  using(((select biosem_private.is_approved_member()) or (select biosem_private.is_admin()))
    and exists(select 1 from public.biosem_posts p where p.id=post_id));
alter policy biosem_attachments_delete on public.biosem_attachments
  using(exists(select 1 from public.biosem_posts p where p.id=post_id
    and (((select biosem_private.is_approved_member()) and p.author_id=(select auth.uid()))
      or (select biosem_private.is_admin()))));
create policy biosem_public_portfolio_photos on public.biosem_attachments for select to anon,authenticated
  using(mime in ('image/jpeg','image/png','image/webp') and exists(
    select 1 from public.biosem_posts p where p.id=post_id and p.category='활동 기록' and p.published and p.portfolio_public
  ));
create policy biosem_public_portfolio_files on storage.objects for select to anon
  using(bucket_id='biosem-files' and exists(select 1 from public.biosem_attachments a where a.object_path=name));
create index biosem_posts_activity_date on public.biosem_posts(activity_date desc nulls last,created_at desc,id desc)
  where category='활동 기록';
commit;
