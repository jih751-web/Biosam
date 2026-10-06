-- Apply after membership-schema.sql. Existing posts remain published.
begin;
alter table public.biosem_posts drop constraint biosem_posts_category_check;
alter table public.biosem_posts add constraint biosem_posts_category_check
  check(category in ('활동 기록','SEM 갤러리','교육 자료','자유 나눔','질문과 답변'));
alter table public.biosem_posts add column published boolean not null default true;
grant insert(id,published),update(title,body,category,published),delete on public.biosem_posts to authenticated;
drop policy biosem_posts_read on public.biosem_posts;
create policy biosem_posts_read on public.biosem_posts for select to authenticated
  using(((select biosem_private.is_approved_member()) or (select biosem_private.is_admin())) and (published or author_id=(select auth.uid()) or (select biosem_private.is_admin())));
create policy biosem_posts_update on public.biosem_posts for update to authenticated
  using(((select biosem_private.is_approved_member()) and author_id=(select auth.uid())) or (select biosem_private.is_admin()))
  with check(((select biosem_private.is_approved_member()) and author_id=(select auth.uid())) or (select biosem_private.is_admin()));
create policy biosem_posts_delete on public.biosem_posts for delete to authenticated
  using(((select biosem_private.is_approved_member()) and author_id=(select auth.uid())) or (select biosem_private.is_admin()));

create table public.biosem_attachments (
  id uuid primary key,
  post_id uuid not null references public.biosem_posts(id) on delete cascade,
  object_path text not null unique,
  filename text not null check(char_length(filename) between 1 and 200),
  mime text not null check(mime in ('image/jpeg','image/png','image/webp','application/pdf','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/x-hwp','application/vnd.hancom.hwpx')),
  bytes bigint not null check(bytes between 1 and 52428800),
  created_at timestamptz not null default now()
);
create index biosem_attachments_post on public.biosem_attachments(post_id);
alter table public.biosem_attachments enable row level security;
revoke all on public.biosem_attachments from public,anon,authenticated;
grant select,insert,delete on public.biosem_attachments to authenticated;
create policy biosem_attachments_read on public.biosem_attachments for select to authenticated
  using(exists(select 1 from public.biosem_posts p where p.id=post_id));
create policy biosem_attachments_insert on public.biosem_attachments for insert to authenticated
  with check(exists(select 1 from public.biosem_posts p where p.id=post_id and p.author_id=(select auth.uid()) and not p.published)
    and split_part(object_path,'/',1)=(select auth.uid())::text
    and split_part(object_path,'/',2)=post_id::text
    and split_part(split_part(object_path,'/',3),'.',1)=id::text
    and object_path ~ '^[a-f0-9-]+/[a-f0-9-]+/[a-f0-9-]+\.(jpg|jpeg|png|webp|pdf|ppt|pptx|doc|docx|xls|xlsx|hwp|hwpx)$');
create policy biosem_attachments_delete on public.biosem_attachments for delete to authenticated
  using(exists(select 1 from public.biosem_posts p where p.id=post_id and (p.author_id=(select auth.uid()) or (select biosem_private.is_admin()))));
create function biosem_private.limit_attachments() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform id from public.biosem_posts where id=new.post_id for update;
  if (select count(*) from public.biosem_attachments where post_id=new.post_id)>=5 then
    raise exception '첨부 파일은 최대 5개입니다.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function biosem_private.limit_attachments() from public,anon,authenticated;
create trigger biosem_attachments_limit before insert on public.biosem_attachments for each row execute function biosem_private.limit_attachments();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('biosem-files','biosem-files',false,52428800,array['image/jpeg','image/png','image/webp','application/pdf','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/x-hwp','application/vnd.hancom.hwpx']);
create policy biosem_files_upload on storage.objects for insert to authenticated
  with check(bucket_id='biosem-files' and split_part(name,'/',1)=(select auth.uid())::text
    and name ~ '^[a-f0-9-]+/[a-f0-9-]+/[a-f0-9-]+\.(jpg|jpeg|png|webp|pdf|ppt|pptx|doc|docx|xls|xlsx|hwp|hwpx)$'
    and exists(select 1 from public.biosem_attachments a join public.biosem_posts p on p.id=a.post_id
      where a.object_path=name and p.id::text=split_part(name,'/',2) and p.author_id=(select auth.uid()) and not p.published));
create policy biosem_files_read on storage.objects for select to authenticated
  using(bucket_id='biosem-files' and exists(select 1 from public.biosem_attachments a where a.object_path=name));
create policy biosem_files_delete on storage.objects for delete to authenticated
  using(bucket_id='biosem-files' and ((select biosem_private.is_admin()) or ((select biosem_private.is_approved_member()) and split_part(name,'/',1)=(select auth.uid())::text)));
-- Owners must be able to remove incomplete uploads whose metadata save failed.
create policy biosem_files_owner_read on storage.objects for select to authenticated
  using(bucket_id='biosem-files' and (((select biosem_private.is_approved_member()) and split_part(name,'/',1)=(select auth.uid())::text) or (select biosem_private.is_admin())));
commit;
