import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './.sites-runtime/pglite/package/dist/index.js';
const db=new PGlite();
const alice='10000000-0000-4000-8000-000000000001',bob='10000000-0000-4000-8000-000000000002',pending='10000000-0000-4000-8000-000000000003';
const post='20000000-0000-4000-8000-000000000001';
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security; grant usage on schema storage to authenticated,anon; grant all on storage.objects to authenticated,anon;`);
await db.exec(await readFile(new URL('./membership-schema.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('./member-content.sql',import.meta.url),'utf8'));
for(const id of [alice,bob,pending]){await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[id]);await db.query("insert into public.biosem_memberships(user_id,real_name,institution,phone,interest,consent_version,status) values($1,'검사 회원','검사 학교','01012345678','생물 수업 활용','2026-10-06',$2)",[id,id===pending?'pending':'approved']);}
async function as(id,fn,role='authenticated'){await db.exec('set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn();}finally{await db.exec('reset role');}}
let count=0;async function check(name,fn){await fn();console.log('PASS '+name);count++;}
const insert=(id,category,published=false)=>db.query("insert into public.biosem_posts(id,author_id,category,title,body,published) values($1,$2,$3,'검사 제목','검사 내용',$4)",[post,id,category,published]);
await check('pending members cannot create gallery posts',()=>as(pending,()=>assert.rejects(insert(pending,'SEM 갤러리'))));
await check('approved members create activity drafts',()=>as(alice,()=>insert(alice,'활동 기록')));
await check('other members cannot see or edit drafts',()=>as(bob,async()=>{assert.equal((await db.query('select * from public.biosem_posts')).rows.length,0);assert.equal((await db.query("update public.biosem_posts set title='위조 제목' returning id")).rows.length,0);}));
const pathFor=i=>`${alice}/${post}/30000000-0000-4000-8000-${String(i).padStart(12,'0')}.jpg`;
const meta=i=>db.query('insert into public.biosem_attachments(id,post_id,object_path,filename,mime,bytes) values($1,$2,$3,$4,$5,$6)',[`30000000-0000-4000-8000-${String(i).padStart(12,'0')}`,post,pathFor(i),'사진.jpg','image/jpeg',20]);
await check('other members cannot upload to another author folder',()=>as(bob,()=>assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('biosem-files',$1)",[pathFor(1)]))));
await check('unreserved uploads are rejected',()=>as(alice,()=>assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('biosem-files',$1)",[pathFor(1)]))));
await check('owner can reserve metadata then upload private attachment',()=>as(alice,async()=>{await meta(1);await db.query("insert into storage.objects(bucket_id,name) values('biosem-files',$1)",[pathFor(1)]);}));
await check('database accepts 50MB and rejects one byte over',async()=>{
  const aid='30000000-0000-4000-8000-000000000009',path=pathFor(9);
  await as(alice,async()=>{
    await assert.rejects(db.query("insert into public.biosem_attachments(id,post_id,object_path,filename,mime,bytes) values($1,$2,$3,'large.jpg','image/jpeg',52428801)",[aid,post,path]));
    await db.query("insert into public.biosem_attachments(id,post_id,object_path,filename,mime,bytes) values($1,$2,$3,'large.jpg','image/jpeg',52428800)",[aid,post,path]);
    await db.query('delete from public.biosem_attachments where id=$1',[aid]);
  });
  assert.equal(Number((await db.query("select file_size_limit from storage.buckets where id='biosem-files'")).rows[0].file_size_limit),52428800);
});
await check('draft attachments remain hidden from other members',()=>as(bob,async()=>{assert.equal((await db.query('select * from storage.objects')).rows.length,0);assert.equal((await db.query('select * from public.biosem_attachments')).rows.length,0);}));
await check('sixth metadata and direct storage upload are rejected',()=>as(alice,async()=>{for(let i=2;i<=5;i++)await meta(i);await assert.rejects(meta(6));await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('biosem-files',$1)",[pathFor(6)]));}));
await check('author can publish and approved readers can read',async()=>{await as(alice,()=>db.query('update public.biosem_posts set published=true where id=$1',[post]));await as(bob,async()=>{assert.equal((await db.query('select * from public.biosem_posts')).rows.length,1);assert.equal((await db.query('select * from storage.objects')).rows.length,1);});});
await check('published post rejects unexpected extra uploads',()=>as(alice,()=>assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('biosem-files',$1)",[pathFor(7)]))));
await check('pending readers cannot download attachments',()=>as(pending,async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0)));
await check('anonymous cannot read member files',()=>as(null,async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0),'anon'));
await check('other members cannot delete published posts or files',()=>as(bob,async()=>{assert.equal((await db.query('delete from public.biosem_posts returning id')).rows.length,0);assert.equal((await db.query('delete from storage.objects returning id')).rows.length,0);}));
await check('suspension revokes file access',async()=>{await db.query('insert into biosem_private.admins(user_id) values($1)',[alice]);await as(alice,()=>db.query("select public.biosem_review_member($1,'approved','suspended','검사 정지')",[bob]));await as(bob,async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0));});
await check('owner deletes files and own post',()=>as(alice,async()=>{assert.equal((await db.query('delete from storage.objects returning id')).rows.length,1);assert.equal((await db.query('delete from public.biosem_posts returning id')).rows.length,1);assert.equal((await db.query('select * from public.biosem_attachments')).rows.length,0);}));
await db.close();console.log(`Content security: ${count} checks passed.`);
