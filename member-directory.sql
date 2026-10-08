begin;
-- Only the limited directory profile crosses the existing application RLS boundary.
create or replace function biosem_private.member_directory(p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not biosem_private.has_verified_identity() or not exists (
    select 1 from public.biosem_memberships where user_id = (select auth.uid()) and status = 'approved'
  ) then raise exception '승인된 회원만 구성원을 조회할 수 있습니다.' using errcode='42501'; end if;
  if p_page is null or p_page < 0 or p_page > 100000 then
    raise exception '잘못된 페이지입니다.' using errcode='22023';
  end if;
  select jsonb_build_object('total',(select count(*) from public.biosem_memberships where status='approved'),
    'rows',coalesce((select jsonb_agg(to_jsonb(profile)) from (
      select real_name,institution,interest,introduction from public.biosem_memberships
      where status='approved' order by real_name,user_id limit 24 offset p_page * 24
    ) profile),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function biosem_private.member_directory(integer) from public,anon,authenticated;
grant execute on function biosem_private.member_directory(integer) to authenticated;
create or replace function public.biosem_member_directory(p_page integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select biosem_private.member_directory(p_page);
$$;
revoke all on function public.biosem_member_directory(integer) from public,anon,authenticated;
grant execute on function public.biosem_member_directory(integer) to authenticated;
commit;
