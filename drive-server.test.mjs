import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDriveHandler } from './drive-server.mjs';

const id='11111111-1111-4111-8111-111111111111';
const env={DRIVE_STORAGE_ENABLED:'true',GOOGLE_DRIVE_CLIENT_ID:'client',GOOGLE_DRIVE_CLIENT_SECRET:'secret',GOOGLE_DRIVE_REFRESH_TOKEN:'refresh',GOOGLE_DRIVE_FOLDER_ID:'folder',DRIVE_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),SUPABASE_URL:'https://db.example',SUPABASE_PUBLISHABLE_KEY:'public'};
const webp=Buffer.from('RIFF0000WEBPpayload');
function fixture({owner='user',approved=true,admin=false}={}) {
  const controls={approved,admin,folder:'folder',time:1000,missing:new Set(),failDelete:null};
  let row={id,mime:'image/jpeg',bytes:20,storage_provider:'supabase',drive_ref:null,biosem_posts:{id:'post',author_id:owner,published:false}};
  const calls=[];let sessions=0;
  const fetch=async(url,options={})=>{
    calls.push({url:String(url),...options}); const u=new URL(url),json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
    if(u.pathname==='/auth/v1/user')return json({id:'user'});
    if(u.pathname.includes('biosem_memberships'))return json(controls.approved?[{status:'approved'}]:[]);
    if(u.pathname.includes('biosem_is_admin'))return json(controls.admin);
    if(u.pathname.includes('biosem_attachments')){if(options.method==='PATCH')row={...row,...JSON.parse(options.body)};return json([row]);}
    if(u.hostname==='oauth2.googleapis.com')return json({access_token:'GOOGLE_SECRET',expires_in:3600});
    if(u.pathname.endsWith('generateIds'))return json({ids:['originalID','displayID','thumbID']});
    if(u.pathname.startsWith('/upload/')&&options.method==='POST'){assert.ok(row.drive_ref,'reference persisted before session');return new Response('',{headers:{location:`https://www.googleapis.com/upload/drive/v3/files?upload_id=s${++sessions}`}});}
    if(u.pathname.startsWith('/upload/')&&options.method==='PUT')return json({id:'hidden'});
    if(options.method==='DELETE'){if(u.pathname.endsWith(controls.failDelete))return new Response(null,{status:500});controls.missing.add(u.pathname.split('/').pop());return new Response(null,{status:204});}
    if(u.searchParams.get('alt')==='media')return new Response(webp,{headers:{'content-type':'image/webp'}});
    if(u.pathname.includes('/drive/v3/files/')){if(controls.missing.has(u.pathname.split('/').pop()))return new Response(null,{status:404});return json({parents:[controls.folder],size:u.pathname.endsWith('originalID')?'20':String(webp.length),mimeType:u.pathname.endsWith('originalID')?'image/jpeg':'image/webp',trashed:false});}
    throw Error('Unexpected mocked URL');
  };
  const handler=createDriveHandler({env,fetch,now:()=>controls.time});
  async function request(action,{method='POST',body,headers={},auth=true,query=''}={}){
    const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body??{}));const req=Readable.from([bytes]);req.url=`/api/drive?action=${action}${query}`;req.method=method;req.headers={...(auth?{authorization:'Bearer user-token'}:{}),...headers};
    let result;const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){result={status:this.statusCode,headers:this.headers,body:value};}};
    await handler(req,res);if(typeof result.body==='string')result.json=JSON.parse(result.body);return result;
  }
  return {request,calls,controls,row:()=>row};
}
test('status is gated and missing credentials leave storage disabled',async()=>{
 const f=fixture();assert.equal((await f.request('status',{method:'GET',auth:false})).json.configured,true);
 const handler=createDriveHandler({env:{...env,DRIVE_STORAGE_ENABLED:'false'}});let body;await handler({url:'/api/drive?action=status',method:'GET'},{setHeader(){},end(x){body=x;}});assert.equal(JSON.parse(body).configured,false);
});
test('upload persists encrypted IDs, returns opaque tickets, and serves only previews',async()=>{
 const f=fixture();const start=await f.request('init',{body:{attachmentId:id,displayBytes:webp.length,thumbBytes:webp.length}});assert.equal(start.status,200);
 assert.ok(f.row().drive_ref);assert.ok(!JSON.stringify(start.json).includes('googleapis'));assert.ok(!f.row().drive_ref.includes('originalID'));
 for(const variant of ['original','display','thumb']){const r=await f.request('chunk',{body:variant==='original'?Buffer.alloc(20):webp,headers:{'x-upload-ticket':start.json.sessions[variant].ticket,'x-upload-offset':'0'}});assert.equal(r.status,200);assert.equal(r.json.complete,true);}
 assert.equal((await f.request('complete',{body:{attachmentId:id}})).status,200);
 const media=await f.request('media',{method:'GET',auth:false,query:`&id=${id}&variant=display`});assert.equal(media.status,200);assert.equal(media.headers['Cache-Control'],'private, no-store');
 assert.equal((await f.request('media',{method:'GET',auth:false,query:`&id=${id}&variant=original`})).status,403);
 assert.equal((await f.request('delete',{body:{attachmentId:id}})).status,200);assert.equal(f.calls.filter(x=>x.method==='DELETE').length,3);
});
test('writes reject anonymous, pending, and other owners including admins',async()=>{
 for(const options of [{auth:false},{approved:false},{owner:'other',admin:true}]){const f=fixture(options);assert.equal((await f.request('init',{auth:options.auth,body:{attachmentId:id,displayBytes:20,thumbBytes:20}})).status,403);assert.ok(!f.calls.some(x=>x.url.includes('googleapis')));}
});
test('tampered tickets and oversized preview/chunks are rejected',async()=>{
 const f=fixture();assert.equal((await f.request('init',{body:{attachmentId:id,displayBytes:1048577,thumbBytes:20}})).status,400);
 assert.equal((await f.request('chunk',{body:webp,headers:{'x-upload-ticket':'tampered','x-upload-offset':'0'}})).status,403);
 assert.equal((await f.request('chunk',{body:Buffer.alloc(1048577)})).status,413);
});
test('each chunk rechecks approval, owner and ticket expiration',async()=>{
 const f=fixture();const start=await f.request('init',{body:{attachmentId:id,displayBytes:webp.length,thumbBytes:webp.length}});
 const chunk=()=>f.request('chunk',{body:webp,headers:{'x-upload-ticket':start.json.sessions.display.ticket,'x-upload-offset':'0'}});
 f.controls.approved=false;assert.equal((await chunk()).status,403);
 f.controls.approved=true;f.row().biosem_posts.author_id='someone-else';assert.equal((await chunk()).status,403);
 f.row().biosem_posts.author_id='user';f.controls.time+=3600001;assert.equal((await chunk()).status,403);
});
test('malformed previews and incorrect chunk offsets never reach Google uploads',async()=>{
 const f=fixture();const start=await f.request('init',{body:{attachmentId:id,displayBytes:webp.length,thumbBytes:webp.length}});
 const headers={'x-upload-ticket':start.json.sessions.display.ticket,'x-upload-offset':'0'};
 assert.equal((await f.request('chunk',{body:Buffer.alloc(webp.length),headers})).status,400);
 assert.equal((await f.request('chunk',{body:webp,headers:{...headers,'x-upload-offset':'1'}})).status,400);
 assert.equal(f.calls.filter(x=>x.method==='PUT').length,0);
});
test('folder isolation blocks media and deletions; partial deletion is retryable',async()=>{
 const f=fixture();await f.request('init',{body:{attachmentId:id,displayBytes:webp.length,thumbBytes:webp.length}});await f.request('complete',{body:{attachmentId:id}});
 f.controls.folder='outside';assert.equal((await f.request('media',{method:'GET',auth:false,query:`&id=${id}&variant=thumb`})).status,403);assert.equal((await f.request('delete',{body:{attachmentId:id}})).status,403);
 f.controls.folder='folder';f.controls.failDelete='displayID';assert.equal((await f.request('delete',{body:{attachmentId:id}})).status,502);
 f.controls.failDelete=null;assert.equal((await f.request('delete',{body:{attachmentId:id}})).status,200);
 assert.equal(f.calls.filter(x=>x.method==='DELETE'&&x.url.endsWith('originalID')).length,1);
});
test('reserved Drive drafts with no reference can be cleaned up only by an authorized owner/admin',async()=>{
 const f=fixture();f.row().storage_provider='drive';
 assert.equal((await f.request('delete',{body:{attachmentId:id}})).status,200);
 assert.ok(!f.calls.some(x=>x.url.includes('googleapis')));
 f.row().biosem_posts.author_id='other';assert.equal((await f.request('delete',{body:{attachmentId:id}})).status,403);
 f.controls.admin=true;assert.equal((await f.request('delete',{body:{attachmentId:id}})).status,200);
 f.controls.admin=false;f.controls.approved=false;assert.equal((await f.request('delete',{body:{attachmentId:id}})).status,403);
});
test('original formats are restricted to the database-supported image types',async()=>{
 for(const mime of ['image/gif','image/heic','image/heif','image/avif']){const f=fixture();f.row().mime=mime;assert.equal((await f.request('init',{body:{attachmentId:id,displayBytes:webp.length,thumbBytes:webp.length}})).status,400);assert.ok(!f.calls.some(x=>x.url.includes('googleapis')));}
});
