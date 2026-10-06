import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const CHUNK=1024*1024;
const variants=['original','display','thumb'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class PublicError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new PublicError(status,message);};
const validSize=(n,max)=>Number.isSafeInteger(n)&&n>0&&n<=max;

export function createDriveHandler({env=process.env,fetch=globalThis.fetch,now=Date.now}={}) {
  const required=['GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN','GOOGLE_DRIVE_FOLDER_ID','DRIVE_ENCRYPTION_KEY','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'];
  const key=Buffer.from(env.DRIVE_ENCRYPTION_KEY||'','base64');
  const configured=env.DRIVE_STORAGE_ENABLED==='true'&&required.every(k=>env[k])&&key.length===32;
  let token=null,expires=0;
  function seal(data,aad){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));return Buffer.concat([iv,cipher.update(JSON.stringify(data)),cipher.final(),cipher.getAuthTag()]).toString('base64url');}
  function unseal(value,aad){try{if(typeof value!=='string'||value.length>16000)throw Error();const data=Buffer.from(value,'base64url');const decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(data.subarray(-16));return JSON.parse(Buffer.concat([decipher.update(data.subarray(12,-16)),decipher.final()]));}catch{fail(403,'Invalid upload or storage reference');}}
  async function googleToken(){if(token&&expires>now()+60000)return token;const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_DRIVE_CLIENT_ID,client_secret:env.GOOGLE_DRIVE_CLIENT_SECRET,refresh_token:env.GOOGLE_DRIVE_REFRESH_TOKEN}).toString(),redirect:'error'});if(!response.ok)fail(502,'Photo storage unavailable');const data=await response.json();if(!data.access_token)fail(502,'Photo storage unavailable');token=data.access_token;expires=now()+Number(data.expires_in||300)*1000;return token;}
  async function google(url,options={}){const response=await fetch(url,{...options,redirect:'error',headers:{...options.headers,Authorization:`Bearer ${await googleToken()}`}});return response;}
  async function db(path,bearer,options={}){const response=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}${path}`,{...options,redirect:'error',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,...(bearer?{Authorization:bearer}:{}),'Content-Type':'application/json',...options.headers}});if(!response.ok)fail(response.status===401||response.status===403?403:502,'Photo access unavailable');return response.status===204?null:response.json();}
  async function actor(bearer){if(!bearer?.startsWith('Bearer '))fail(403,'Sign in required');const user=await db('/auth/v1/user',bearer);if(typeof user.id!=='string'||!user.id)fail(403,'Sign in required');const [members,admin]=await Promise.all([db(`/rest/v1/biosem_memberships?user_id=eq.${encodeURIComponent(user.id)}&select=status`,bearer),db('/rest/v1/rpc/biosem_is_admin',bearer,{method:'POST',body:'{}'})]);if(admin!==true&&!members.some(m=>m.status==='approved'))fail(403,'Approved membership required');return {id:user.id,admin:admin===true};}
  async function attachment(id,bearer,write=false){if(!UUID.test(id||''))fail(400,'Invalid attachment');const columns=write?'id,mime,bytes,storage_provider,drive_ref,biosem_posts!inner(id,author_id,published)':'id,mime,bytes,storage_provider,drive_ref,biosem_posts!inner(id)';const rows=await db(`/rest/v1/biosem_attachments?id=eq.${id}&select=${encodeURIComponent(columns)}`,bearer);if(rows.length!==1)fail(404,'Photo not found');return rows[0];}
  function writable(row,user,draft){const post=Array.isArray(row.biosem_posts)?row.biosem_posts[0]:row.biosem_posts;if(!post||(draft?(post.author_id!==user.id||post.published):(post.author_id!==user.id&&!user.admin)))fail(403,'Photo access denied');}
  async function patch(row,bearer,fields,initial=false){const rows=await db(`/rest/v1/biosem_attachments?id=eq.${row.id}${initial?'&drive_ref=is.null':''}`,bearer,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(fields)});if(!rows||rows.length!==1)fail(409,'Photo state changed');}
  function reference(row){if(row.storage_provider!=='drive'||!row.drive_ref)fail(404,'Photo not found');const ref=unseal(row.drive_ref,`ref:${row.id}`);if(ref.folder!==env.GOOGLE_DRIVE_FOLDER_ID)fail(403,'Photo access denied');return ref;}
  const fileUrl=id=>`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`;
  async function metadata(file,allowMissing=false){const r=await google(`${fileUrl(file.id)}?fields=id,size,mimeType,parents,trashed`);if(allowMissing&&r.status===404)return null;if(!r.ok)fail(502,'Photo storage unavailable');const data=await r.json();if(data.trashed||!data.parents?.includes(env.GOOGLE_DRIVE_FOLDER_ID))fail(403,'Photo access denied');return data;}
  async function readBody(req,max){if(Number(req.headers?.['content-length'])>max)fail(413,'Upload chunk too large');if(req.body!==undefined){const b=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));if(b.length>max)fail(413,'Upload chunk too large');return b;}const pieces=[];let length=0;for await(const piece of req){const b=Buffer.from(piece);length+=b.length;if(length>max)fail(413,'Upload chunk too large');pieces.push(b);}return Buffer.concat(pieces);}
  return async function handler(req,res){res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');const json=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};try{
    const url=new URL(req.url,'https://biosem.invalid'),action=url.searchParams.get('action');
    if(action==='status'&&req.method==='GET')return json(200,{configured:Boolean(configured)});
    if(!configured)fail(503,'Photo storage is not configured');
    const bearer=req.headers?.authorization;
    if(action==='media'&&req.method==='GET'){
      const variant=url.searchParams.get('variant');if(!['thumb','display'].includes(variant))fail(403,'Original downloads are unavailable');
      const row=await attachment(url.searchParams.get('id'),bearer),ref=reference(row);if(!ref.ready)fail(409,'Photo upload is incomplete');const file=ref.files[variant];const meta=await metadata(file);if(Number(meta.size)!==file.bytes||meta.mimeType!=='image/webp')fail(502,'Photo storage unavailable');const r=await google(`${fileUrl(file.id)}?alt=media`);if(!r.ok)fail(502,'Photo storage unavailable');const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length!==file.bytes||bytes.length>CHUNK)fail(502,'Photo storage unavailable');res.setHeader('Content-Type','image/webp');res.setHeader('Content-Disposition','inline');return res.end(bytes);
    }
    if(req.method!=='POST'||!['init','chunk','complete','delete'].includes(action))fail(405,'Unsupported photo request');
    const raw=await readBody(req,action==='chunk'?CHUNK:16384);const user=await actor(bearer);
    if(action==='chunk'){
      const t=unseal(req.headers['x-upload-ticket'],'upload');if(t.user!==user.id||t.expires<now())fail(403,'Upload ticket expired');
      const row=await attachment(t.attachment,bearer,true);writable(row,user,true);const ref=reference(row),file=ref.files[t.variant];if(ref.ready||!file||file.id!==t.id)fail(403,'Upload ticket no longer valid');
      const offset=Number(req.headers['x-upload-offset']);if(!Number.isSafeInteger(offset)||offset<0||offset%CHUNK!==0||!raw.length||offset+raw.length>file.bytes||(offset+raw.length<file.bytes&&raw.length!==CHUNK))fail(400,'Invalid upload chunk');
      if(t.variant!=='original'&&offset===0&&(raw.toString('ascii',0,4)!=='RIFF'||raw.toString('ascii',8,12)!=='WEBP'))fail(400,'Preview must be WebP');
      const session=new URL(t.url);if(session.origin!=='https://www.googleapis.com'||!session.pathname.startsWith('/upload/drive/'))fail(403,'Invalid upload ticket');
      const r=await google(t.url,{method:'PUT',headers:{'Content-Type':file.mime,'Content-Range':`bytes ${offset}-${offset+raw.length-1}/${file.bytes}`},body:raw});if(!r.ok&&r.status!==308)fail(502,'Photo upload failed');return json(200,{complete:r.ok});
    }
    let body;try{body=JSON.parse(raw);}catch{fail(400,'Invalid photo request');}const row=await attachment(body.attachmentId,bearer,true);writable(row,user,action!=='delete');
    if(action==='init'){
      if(row.drive_ref)fail(409,'Photo upload already started');if(!/^image\/(jpeg|png|webp)$/i.test(row.mime)||!validSize(row.bytes,50*CHUNK)||!validSize(body.displayBytes,CHUNK)||!validSize(body.thumbBytes,256*1024))fail(400,'Invalid photo size or type');
      const response=await google('https://www.googleapis.com/drive/v3/files/generateIds?count=3&space=drive&type=files');if(!response.ok)fail(502,'Photo storage unavailable');const {ids}=await response.json();if(ids?.length!==3||new Set(ids).size!==3)fail(502,'Photo storage unavailable');
      const ref={folder:env.GOOGLE_DRIVE_FOLDER_ID,ready:false,files:Object.fromEntries(variants.map((v,i)=>[v,{id:ids[i],bytes:v==='original'?row.bytes:body[`${v}Bytes`],mime:v==='original'?row.mime:'image/webp'}]))};
      await patch(row,bearer,{storage_provider:'drive',drive_ref:seal(ref,`ref:${row.id}`)},true);
      const sessions={};for(const variant of variants){const file=ref.files[variant];const r=await google('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':file.mime,'X-Upload-Content-Length':String(file.bytes)},body:JSON.stringify({id:file.id,name:`${row.id}-${variant}`,mimeType:file.mime,parents:[ref.folder]})});if(!r.ok||!r.headers.get('location'))fail(502,'Photo upload could not start');sessions[variant]={ticket:seal({user:user.id,attachment:row.id,variant,id:file.id,url:r.headers.get('location'),expires:now()+60*60*1000},'upload')};}return json(200,{sessions});
    }
    if(action==='delete'&&row.storage_provider==='drive'&&!row.drive_ref)return json(200,{deleted:true});
    const ref=reference(row);
    if(action==='complete'){for(const v of variants){const file=ref.files[v],data=await metadata(file);if(Number(data.size)!==file.bytes||data.mimeType!==file.mime)fail(409,'Photo upload is incomplete');}ref.ready=true;await patch(row,bearer,{drive_ref:seal(ref,`ref:${row.id}`)});return json(200,{complete:true});}
    for(const v of variants){const file=ref.files[v];if(!await metadata(file,true))continue;const r=await google(fileUrl(file.id),{method:'DELETE'});if(!r.ok&&r.status!==404)fail(502,'Photo deletion failed');}return json(200,{deleted:true});
  }catch(error){return json(error instanceof PublicError?error.status:502,{error:error instanceof PublicError?error.message:'Photo request failed'});}};
}
