import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=createRequire(import.meta.url)('E:/클로드/_agent/shared/tools/npm/playwright-mcp/0.0.79/node_modules/playwright');
const root=resolve('dist');
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',route=>route.abort());
  await page.route('**/supabase-2.117.2.js',route=>route.fulfill({contentType:'text/javascript',body:`
    window.testStatus='approved';window.testUser=true;window.directoryCalls=0;window.delayDirectory=false;
    window.supabase={createClient:()=>({
      auth:{getUser:async()=>({data:{user:window.testUser?{id:'one',email:'test@example.invalid'}:null}}),onAuthStateChange(fn){window.authChanged=fn}},
      from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{status:window.testStatus}})}),
      rpc:async(name,args)=>{if(name==='biosem_is_admin')return {data:true};
        if(name!=='biosem_member_directory')throw Error('Unexpected RPC');window.directoryCalls++;
        if(window.delayDirectory)await new Promise(resolve=>window.finishDirectory=resolve);
        if(window.failDirectory)return {error:{code:'42501'}};
        return {data:{total:25,rows:[{real_name:args.p_page?'두번째':'<img src=x onerror=alert(1)>',institution:'테스트 학교',interest:'생물 수업 활용',introduction:'함께 탐구합니다.'}]}};
      }
    })};
  `}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/#/members');
  await page.locator('.member-directory-card').waitFor();
  assert.match(await page.locator('.member-directory-card').innerText(),/<img src=x/);
  assert.equal(await page.locator('.member-directory-card img').count(),0);
  await page.getByRole('button',{name:'다음',exact:true}).click();
  await page.getByRole('heading',{name:'두번째 선생님'}).waitFor();
  for(const status of ['pending','rejected','suspended']){
    await page.evaluate(status=>{window.testStatus=status;window.authChanged('TOKEN_REFRESHED')},status);
    await page.getByRole('heading',{name:'승인된 회원만 구성원을 볼 수 있습니다.'}).waitFor();
    assert.equal(await page.locator('.member-directory-card').count(),0);
  }
  await page.evaluate(()=>{window.testStatus='approved';window.authChanged('TOKEN_REFRESHED')});
  await page.locator('.member-directory-card').waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>{window.delayDirectory=true});
  await page.getByRole('button',{name:'새로고침',exact:true}).click();
  await page.waitForFunction(()=>typeof window.finishDirectory==='function');
  await page.evaluate(()=>{window.testUser=false;window.authChanged('SIGNED_OUT');window.finishDirectory()});
  await page.getByRole('heading',{name:'승인된 회원만 구성원을 볼 수 있습니다.'}).waitFor();
  assert.equal(await page.locator('.member-directory-card').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS approved profiles, escaped content, pagination, pending/rejected/suspended restriction, mobile layout, logout race');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
