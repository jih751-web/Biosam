// Explicit operator check: real Google Drive, isolated in-memory membership/metadata.
// Creates three private test files and deletes only those files in finally.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createDriveHandler } from './drive-server.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require('E:/클로드/_agent/shared/tools/npm/playwright-mcp/0.0.79/node_modules/playwright');
const env={DRIVE_STORAGE_ENABLED:'true',SUPABASE_URL:'https://isolated-test.invalid',SUPABASE_PUBLISHABLE_KEY:'test'};
for(const line of (await readFile(join(homedir(),'.claude/secrets/.env'),'utf8')).split(/\r?\n/)){
  const at=line.indexOf('=');const key=line.slice(0,at);
  if(!['GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN','GOOGLE_DRIVE_FOLDER_ID','DRIVE_ENCRYPTION_KEY'].includes(key))continue;
  const value=line.slice(at+1);env[key]=value.startsWith('"')?JSON.parse(value):value;
}
const original=await readFile('dist/assets/pollen.jpg');
const row={id:randomUUID(),mime:'image/jpeg',bytes:original.length,storage_provider:'drive',drive_ref:null,biosem_posts:{id:randomUUID(),author_id:'isolated-test-user',published:false}};
const googleIds=[];
let googleToken,googleError;
const realFetch=globalThis.fetch;
async function network(url,options={}){
  const u=new URL(url);
  const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  if(u.hostname==='isolated-test.invalid'){
    if(u.pathname==='/auth/v1/user')return json({id:'isolated-test-user'});
    if(u.pathname.includes('biosem_memberships'))return json([{status:'approved'}]);
    if(u.pathname.includes('biosem_is_admin'))return json(false);
    if(u.pathname.includes('biosem_attachments')){if(options.method==='PATCH')Object.assign(row,JSON.parse(options.body));return json([row]);}
    throw Error('Unexpected isolated database request');
  }
  const response=await realFetch(url,{...options,signal:AbortSignal.timeout(25000)});
  if(u.hostname==='oauth2.googleapis.com'&&response.ok)googleToken=(await response.clone().json()).access_token;
  if(u.pathname.endsWith('/generateIds')&&response.ok)googleIds.push(...(await response.clone().json()).ids);
  if(!response.ok&&response.status!==308&&response.status!==404){
    const error=await response.clone().json().catch(()=>({}));
    googleError={status:response.status,code:error.error?.status||error.error?.errors?.[0]?.reason||(typeof error.error==='string'?error.error:'unknown')};
  }
  return response;
}
const handler=createDriveHandler({env,fetch:network});
const helper=await readFile('dist/drive-photos.js','utf8');
const server=createServer((req,res)=>{
  if(req.url.startsWith('/api/drive'))return handler(req,res);
  if(req.url==='/fixture.jpg'){res.setHeader('Content-Type','image/jpeg');return res.end(original);}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Isolated Drive check</title>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage();await page.goto(base);await page.addScriptTag({content:helper});
  const result=await page.evaluate(async attachment=>{
    const client=()=>({auth:{getSession:async()=>({data:{session:{access_token:'isolated-test-token'}}})}});
    const drive=window.createBioSEMDrivePhotos({client});
    if(!(await drive.status()).configured)throw Error('Drive configuration incomplete');
    const file=new File([await(await fetch('/fixture.jpg')).blob()],'BioSEM-private-storage-check.jpg',{type:'image/jpeg'});
    await drive.upload(attachment,file);
    const sizes={};
    for(const variant of ['thumb','display']){
      const r=await drive.download(attachment,variant);if(r.error)throw r.error;
      const bitmap=await createImageBitmap(r.data);sizes[variant]={width:bitmap.width,height:bitmap.height,bytes:r.data.size};bitmap.close();
    }
    const blocked=await fetch('/api/drive?action=media&id='+attachment.id+'&variant=original');
    return {sizes,originalStatus:blocked.status};
  },{id:row.id});
  assert.equal(result.originalStatus,403);
  assert.ok(Math.max(result.sizes.thumb.width,result.sizes.thumb.height)<=600);
  assert.ok(result.sizes.thumb.bytes<=256*1024);
  assert.ok(Math.max(result.sizes.display.width,result.sizes.display.height)<=2048);
  assert.ok(result.sizes.display.bytes<=1024*1024);
  for(const id of googleIds){
    const r=await realFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=permissions(id,type),parents',{headers:{Authorization:'Bearer '+googleToken},signal:AbortSignal.timeout(20000)});
    assert.equal(r.status,200);const file=await r.json();assert.ok(file.parents.includes(env.GOOGLE_DRIVE_FOLDER_ID));
    assert.ok(!file.permissions?.some(p=>p.type==='anyone'||p.type==='domain'));
  }
  console.log('PASS real Google Drive upload, private files, browser WebP previews and original download denial');
  console.log(JSON.stringify(result.sizes));
}catch(error){console.error('Live Drive check failed:',googleError||error.message);process.exitCode=1;}
finally{
  try{
    if(row.drive_ref){
      const r=await realFetch(base+'/api/drive?action=delete',{method:'POST',headers:{Authorization:'Bearer isolated-test-token','Content-Type':'application/json'},body:JSON.stringify({attachmentId:row.id})});
      assert.equal(r.status,200,'Test file cleanup must succeed');
      for(const id of googleIds){const r=await realFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id',{headers:{Authorization:'Bearer '+googleToken},signal:AbortSignal.timeout(20000)});assert.equal(r.status,404,'Test file must no longer exist');}
      console.log('PASS all three temporary Google Drive files deleted');
    }
  }catch{console.error('Test file cleanup failed; operator must check the BioSEM test files before proceeding.');process.exitCode=1;}
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
}
