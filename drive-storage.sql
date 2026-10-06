begin;
alter table public.biosem_attachments add column storage_provider text not null default 'supabase'
  check(storage_provider in ('supabase','drive'));
alter table public.biosem_attachments add column drive_ref text check(char_length(drive_ref)<=12000);
grant select(storage_provider,drive_ref) on public.biosem_attachments to anon;
grant insert(storage_provider),update(storage_provider,drive_ref) on public.biosem_attachments to authenticated;
create policy biosem_attachments_drive_update on public.biosem_attachments for update to authenticated
  using(((select biosem_private.is_approved_member()) or (select biosem_private.is_admin())) and exists(
    select 1 from public.biosem_posts p where p.id=post_id and p.author_id=(select auth.uid()) and not p.published
  ))
  with check(((select biosem_private.is_approved_member()) or (select biosem_private.is_admin())) and exists(
    select 1 from public.biosem_posts p where p.id=post_id and p.author_id=(select auth.uid()) and not p.published
  ));
alter policy biosem_files_upload on storage.objects with check(
  bucket_id='biosem-files' and split_part(name,'/',1)=(select auth.uid())::text
  and name ~ '^[a-f0-9-]+/[a-f0-9-]+/[a-f0-9-]+\.(jpg|jpeg|png|webp|pdf|ppt|pptx|doc|docx|xls|xlsx|hwp|hwpx)$'
  and exists(select 1 from public.biosem_attachments a join public.biosem_posts p on p.id=a.post_id
    where a.object_path=name and a.storage_provider='supabase' and p.id::text=split_part(name,'/',2)
      and p.author_id=(select auth.uid()) and not p.published)
);
commit;
