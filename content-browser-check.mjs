import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require('E:/클로드/_agent/shared/tools/npm/playwright-mcp/0.0.79/node_modules/playwright');
const root=resolve('dist');
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.jpg':'image/jpeg'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',route=>route.abort());
  await page.route('**/supabase-2.117.2.js',route=>route.fulfill({contentType:'text/javascript',body:`
    window.testStatus='approved';window.testPosts=[];window.testAttachments=[];window.testFiles={};
    const actor='10000000-0000-4000-8000-000000000001';
    const makeQuery=table=>{let method='select',data,filters=[],single=false,range;
      const q={select(){return q},insert(d){method='insert';data=d;return q},update(d){method='update';data=d;return q},delete(){method='delete';return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},range(a,b){range=[a,b];return q},single(){single=true;return q},maybeSingle(){single=true;return q},then(ok,fail){try{
        if(table==='biosem_memberships')return new Promise(resolve=>setTimeout(()=>resolve({data:{status:window.testStatus,real_name:'검사 회원',institution:'검사 학교',phone:'01012345678'},error:null}),window.testSlowSync?150:0)).then(ok,fail);
        let rows=table==='biosem_posts'?window.testPosts:window.testAttachments;
        const matches=x=>filters.every(([k,v])=>x[k]===v);
        let output;
        if(method==='insert'){const row={...data,created_at:new Date().toISOString()};rows.push(row);output=[row];}
        else if(method==='update'){output=rows.filter(matches);output.forEach(x=>Object.assign(x,data));}
        else if(method==='delete'){output=rows.filter(matches);const kept=rows.filter(x=>!matches(x));if(table==='biosem_posts')window.testPosts=kept;else window.testAttachments=kept;}
        else output=rows.filter(matches);
        output=output.map(x=>table==='biosem_posts'?{...x,biosem_attachments:window.testAttachments.filter(a=>a.post_id===x.id)}:{...x});if(range)output=output.slice(range[0],range[1]+1);
        return Promise.resolve({data:single?output[0]:output,error:null}).then(ok,fail);
      }catch(err){return Promise.reject(err).then(ok,fail);}}};return q;};
    window.supabase={createClient:()=>({from:makeQuery,rpc:async()=>({data:false,error:null}),auth:{getUser:async()=>({data:{user:{id:actor,email:'test@example.invalid',email_confirmed_at:new Date().toISOString()}}}),onAuthStateChange(fn){window.testAuthChange=fn;},signOut:async()=>({error:null})},storage:{from:()=>({upload:async(path,file)=>{if(window.testRefreshDuringUpload){window.testRefreshDuringUpload=false;window.testSlowSync=true;window.testAuthChange('TOKEN_REFRESHED');await new Promise(r=>setTimeout(r,30));}if(window.testFailUpload&&file.name==='fail.pdf')return {error:{message:'upload failed'}};window.testFiles[path]=file;return {data:{path},error:null};},download:async(path)=>({data:window.testFiles[path]||null,error:window.testFiles[path]?null:{message:'Not found'}}),remove:async(paths)=>{if(window.testFailCleanup)return {error:{message:'cleanup failed'}};paths.forEach(p=>delete window.testFiles[p]);return {data:paths,error:null};}})}})};
  `}));
  await page.goto(base+'/#/activities');
  for(const [menu,category] of [['activities','활동 기록'],['gallery','SEM 갤러리'],['resources','교육 자료'],['community','자유 나눔']]){
    await page.evaluate(menu=>location.hash='#/'+menu,menu);
    const button=menu==='community'?page.locator('[data-member-action="write"]'):page.locator('[data-content-category]');
    await button.click();await page.locator('#content-form').waitFor();
    await page.locator('#content-form [name="title"]').fill(category+' 검사 제목');
    await page.locator('#content-form [name="body"]').fill('사진과 자료를 나누는 검사 내용입니다.');
    if(menu==='gallery')await page.evaluate(()=>window.testRefreshDuringUpload=true);
    if(menu==='gallery')await page.locator('[name="files"]').setInputFiles([{name:'관찰.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')},{name:'활동지.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')}]);
    await page.locator('#content-form [type="submit"]').click();
    await page.locator('.content-card').filter({hasText:category+' 검사 제목'}).waitFor();
    console.log('PASS '+category+' 게시 및 메뉴 표시');
  }
  await page.evaluate(()=>location.hash='#/gallery');
  const galleryCard=page.getByRole('button',{name:'SEM 갤러리 검사 제목 자세히 보기',exact:true});
  await galleryCard.locator('img').waitFor();
  assert.equal(await galleryCard.locator('h3,.community-tag,.post-meta').count(),0);
  assert.ok((await galleryCard.boundingBox()).width>450);
  assert.ok((await galleryCard.boundingBox()).height>300);
  await page.setViewportSize({width:390,height:844});
  assert.ok((await galleryCard.boundingBox()).width>300);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'content-mobile-check.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.locator('.content-card').filter({hasText:'SEM 갤러리 검사 제목'}).click();
  await page.locator('.content-image').waitFor();
  assert.equal(await page.locator('.member-post-copy').textContent(),'사진과 자료를 나누는 검사 내용입니다.');
  console.log('PASS 갤러리 큰 사진 전용 카드, 모바일 배치, 클릭 후 설명 표시');
  assert.equal(await page.locator('.content-attachment').count(),2);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:/활동지.pdf.*다운로드/}).click();assert.equal((await download).suggestedFilename(),'활동지.pdf');
  await page.locator('#content-edit').click();await page.locator('#content-form [name="title"]').fill('수정된 사진 기록');await page.locator('#content-form [type="submit"]').click();
  await page.locator('.content-card').filter({hasText:'수정된 사진 기록'}).click();
  await page.locator('#content-delete').click();await page.locator('#content-delete-confirm').click();
  await page.getByRole('heading',{name:'첫 번째 기록을 남겨보세요.'}).waitFor();
  assert.equal(await page.evaluate(()=>Object.keys(window.testFiles).length),0);
  console.log('PASS 사진 미리보기, 파일 다운로드, 본인 수정·삭제');
  await page.evaluate(()=>{window.testFailUpload=true;window.testFailCleanup=true;});
  await page.locator('[data-content-category]').click();
  await page.locator('#content-form [name="title"]').fill('미완료 업로드 검사');
  await page.locator('#content-form [name="body"]').fill('실패 복구 검증입니다.');
  await page.locator('[name="files"]').setInputFiles([{name:'ok.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')},{name:'fail.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')}]);
  await page.locator('#content-form [type="submit"]').click();
  await page.locator('#content-error').filter({hasText:'미완료 게시물이 남아 있습니다'}).waitFor();
  assert.equal(await page.evaluate(()=>window.testPosts.filter(p=>!p.published).length),1);
  assert.equal(await page.evaluate(()=>Object.keys(window.testFiles).length),1);
  await page.locator('.modal-close').click();
  await page.evaluate(()=>{window.testFailCleanup=false;window.testFailUpload=false;location.hash='#/activities';});
  await page.locator('[data-content-category="활동 기록"]').waitFor();
  await page.evaluate(()=>location.hash='#/gallery');
  await page.locator('.content-card').filter({hasText:'미완료 업로드 검사'}).click();
  await page.locator('#content-delete').click();await page.locator('#content-delete-confirm').click();
  await page.getByRole('heading',{name:'첫 번째 기록을 남겨보세요.'}).waitFor();
  assert.equal(await page.evaluate(()=>Object.keys(window.testFiles).length),0);
  console.log('PASS 토큰 갱신 중 업로드 유지, 정리 실패 시 비공개 초안 보존 및 삭제 재시도');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>location.hash='#/resources');await page.locator('.content-card').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'content-mobile-check.png',fullPage:true});
  await page.evaluate(()=>{window.testStatus='pending';location.hash='#/gallery';});
  await page.getByRole('heading',{name:'승인된 회원과 함께 나눕니다.'}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS 모바일 레이아웃, 승인 대기 접근 차단, 브라우저 오류 없음');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
