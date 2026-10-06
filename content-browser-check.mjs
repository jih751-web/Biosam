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
  const driveUploads=new Map(),driveCalls=[],driveDeletes=[],mediaVariants=[];
  await page.route('**/config.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(resolve(root,'config.js'),'utf8')).replace("photoStorage: 'supabase'","photoStorage: 'drive'")}));
  await page.route('**/api/drive?*',async route=>{
    const request=route.request(),url=new URL(request.url()),action=url.searchParams.get('action');
    driveCalls.push(action);
    if(action==='status')return route.fulfill({json:{configured:true}});
    assert.equal(request.headers().authorization,'Bearer browser-session');
    if(action==='init'){
      const data=request.postDataJSON();driveUploads.set(data.attachmentId,{...data,original:[],display:[],thumb:[]});
      return route.fulfill({json:{sessions:Object.fromEntries(['original','display','thumb'].map(variant=>[variant,{ticket:data.attachmentId+':'+variant}]))}});
    }
    if(action==='chunk'){
      const [id,variant]=request.headers()['x-upload-ticket'].split(':'),chunks=driveUploads.get(id)[variant],body=request.postDataBuffer();
      assert.ok(body.length<=1024*1024);assert.equal(Number(request.headers()['x-upload-offset']),chunks.reduce((sum,chunk)=>sum+chunk.length,0));chunks.push(body);
      return route.fulfill({json:{complete:true}});
    }
    if(action==='complete'){
      const upload=driveUploads.get(request.postDataJSON().attachmentId);
      assert.equal(Buffer.concat(upload.display).length,upload.displayBytes);assert.equal(Buffer.concat(upload.thumb).length,upload.thumbBytes);
      return route.fulfill({json:{complete:true}});
    }
    if(action==='media'){
      const variant=url.searchParams.get('variant');assert.ok(['thumb','display'].includes(variant));mediaVariants.push(variant);
      return route.fulfill({contentType:'image/webp',body:Buffer.concat(driveUploads.get(url.searchParams.get('id'))[variant])});
    }
    if(action==='delete'){const id=request.postDataJSON().attachmentId;driveDeletes.push(id);driveUploads.delete(id);return route.fulfill({json:{deleted:true}});}
    throw new Error('Unexpected Drive action: '+action);
  });
  await page.route('**/supabase-2.117.2.js',route=>route.fulfill({contentType:'text/javascript',body:`
    window.testStatus='approved';window.testPosts=[];window.testAttachments=[];window.testFiles={};window.testTopics=[{name:'식물'},{name:'미생물'},{name:'기타'}];
    const actor='10000000-0000-4000-8000-000000000001';
    const makeQuery=table=>{let method='select',data,filters=[],single=false,range,orders=[];
      const q={select(){return q},insert(d){method='insert';data=d;return q},update(d){method='update';data=d;return q},delete(){method='delete';return q},eq(k,v){filters.push([k,v]);return q},order(k,options={ascending:true}){orders.push([k,options]);return q},limit(){return q},range(a,b){range=[a,b];return q},single(){single=true;return q},maybeSingle(){single=true;return q},then(ok,fail){try{
        if(table==='biosem_memberships')return new Promise(resolve=>setTimeout(()=>resolve({data:{status:window.testStatus,real_name:'검사 회원',institution:'검사 학교',phone:'01012345678'},error:null}),window.testSlowSync?150:0)).then(ok,fail);
        let rows=table==='biosem_gallery_topics'?window.testTopics:table==='biosem_posts'?window.testPosts:window.testAttachments;
        const matches=x=>filters.every(([k,v])=>x[k]===v);
        let output;
        if(method==='insert'){const row={...data,created_at:new Date().toISOString()};rows.push(row);output=[row];}
        else if(method==='update'){output=rows.filter(matches);output.forEach(x=>Object.assign(x,data));}
        else if(method==='delete'){output=rows.filter(matches);const kept=rows.filter(x=>!matches(x));if(table==='biosem_posts'){window.testPosts=kept;window.testAttachments=window.testAttachments.filter(a=>!output.some(p=>p.id===a.post_id));}else window.testAttachments=kept;}
        else output=rows.filter(matches);
        output=output.map(x=>table==='biosem_posts'?{...x,biosem_attachments:window.testAttachments.filter(a=>a.post_id===x.id)}:{...x});output.sort((a,b)=>{for(const [k,o] of orders){if(a[k]===b[k])continue;if(a[k]==null)return o.nullsFirst?-1:1;if(b[k]==null)return o.nullsFirst?1:-1;return (a[k]<b[k]?-1:1)*(o.ascending?1:-1);}return 0;});if(range)output=output.slice(range[0],range[1]+1);
        return Promise.resolve({data:single?output[0]:output,error:null}).then(ok,fail);
      }catch(err){return Promise.reject(err).then(ok,fail);}}};q.is=(k,v)=>{filters.push([k,v]);return q;};return q;};
    window.supabase={createClient:()=>({from:makeQuery,rpc:async()=>({data:false,error:null}),auth:{getSession:async()=>({data:{session:window.testAnonymous?null:{access_token:'browser-session'}}}),getUser:async()=>({data:{user:window.testAnonymous?null:{id:actor,email:'test@example.invalid',email_confirmed_at:new Date().toISOString()}}}),onAuthStateChange(fn){window.testAuthChange=fn;},signOut:async()=>({error:null})},storage:{from:()=>({upload:async(path,file)=>{if(window.testRefreshDuringUpload){window.testRefreshDuringUpload=false;window.testSlowSync=true;window.testAuthChange('TOKEN_REFRESHED');await new Promise(r=>setTimeout(r,30));}if(window.testFailUpload&&file.name==='fail.pdf')return {error:{message:'upload failed'}};window.testFiles[path]=file;return {data:{path},error:null};},download:async(path)=>({data:window.testFiles[path]||null,error:window.testFiles[path]?null:{message:'Not found'}}),remove:async(paths)=>{if(window.testFailCleanup)return {error:{message:'cleanup failed'}};paths.forEach(p=>delete window.testFiles[p]);return {data:paths,error:null};}})}})};
  `}));
  await page.goto(base+'/#/activities');
  const originalPhoto=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1200;
    const context=canvas.getContext('2d'),pixels=context.createImageData(canvas.width,canvas.height);let seed=12345;
    for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;}
    context.putImageData(pixels,0,0);return canvas.toDataURL('image/png').split(',')[1];
  }),'base64');
  for(const [menu,category] of [['activities','활동 기록'],['gallery','SEM 갤러리'],['resources','교육 자료'],['community','자유 나눔']]){
    await page.evaluate(menu=>location.hash='#/'+menu,menu);
    const button=menu==='community'?page.locator('[data-member-action="write"]'):page.locator('[data-content-category]');
    await button.click();await page.locator('#content-form').waitFor();
    await page.locator('#content-form [name="title"]').fill(category+' 검사 제목');
    await page.locator('#content-form [name="body"]').fill('사진과 자료를 나누는 검사 내용입니다.');
    if(menu==='activities'){await page.locator('[name="activity_date"]').fill('2024-02-29');await page.locator('[name="portfolio_public"]').check();}
    if(menu==='gallery'){await page.locator('[name="gallery_topic"]').selectOption('__new__');await page.locator('[name="new_topic"]').fill('곤충');}
    if(menu==='gallery')await page.evaluate(()=>window.testRefreshDuringUpload=true);
    if(menu==='gallery')await page.locator('[name="files"]').setInputFiles([{name:'관찰.png',mimeType:'image/png',buffer:originalPhoto},{name:'활동지.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')}]);
    await page.locator('#content-form [type="submit"]').click();
    await page.locator('.content-card').filter({hasText:category+' 검사 제목'}).waitFor();
    console.log('PASS '+category+' 게시 및 메뉴 표시');
  }
  assert.equal(driveUploads.size,1);
  const [archivedId,archived]=[...driveUploads.entries()][0];
  assert.deepEqual(Buffer.concat(archived.original),originalPhoto);
  assert.ok(archived.original.length>1);
  for(const [variant,longest,budget] of [['display',2048,1024*1024],['thumb',600,256*1024]]){
    const bytes=Buffer.concat(archived[variant]);assert.ok(bytes.length<=budget);
    const dimensions=await page.evaluate(async base64=>{const blob=await (await fetch('data:image/webp;base64,'+base64)).blob(),image=await createImageBitmap(blob);const result=[image.width,image.height];image.close();return result;},bytes.toString('base64'));
    assert.ok(Math.max(...dimensions)<=longest);assert.equal(dimensions[0]/dimensions[1],2);
  }
  assert.equal(await page.evaluate(()=>Object.values(window.testFiles).every(file=>file.type==='application/pdf')),true);
  console.log('PASS real canvas WebP previews, unchanged original, bounded authenticated Drive chunks, documents on existing storage');
  await page.evaluate(()=>location.hash='#/gallery');
  await page.locator('#gallery-topic-filter option[value="topic:곤충"]').waitFor({state:'attached'});
  assert.equal(await page.locator('#member-gallery-list .member-gallery-grid').count(),1);
  assert.equal(await page.locator('#member-gallery-list [data-image]').count(),3);
  await page.locator('#gallery-topic-filter').selectOption('topic:식물');
  await page.waitForFunction(()=>document.querySelectorAll('#member-gallery-list [data-image]').length===2&&document.querySelectorAll('#member-gallery-list [data-member-post]').length===0);
  await page.locator('#gallery-topic-filter').selectOption('topic:곤충');
  await page.waitForFunction(()=>document.querySelectorAll('#member-gallery-list [data-image]').length===0&&document.querySelectorAll('#member-gallery-list [data-member-post]').length===1);
  await page.evaluate(()=>window.testPosts.push({id:'old-gallery',category:'SEM 갤러리',title:'기존 미분류 사진',body:'기존 내용',gallery_topic:null,created_at:new Date().toISOString(),published:true}));
  await page.locator('#gallery-topic-filter').selectOption('__none__');
  await page.getByRole('button',{name:'기존 미분류 사진 자세히 보기'}).waitFor();
  assert.equal(await page.locator('#member-gallery-list [data-image]').count(),0);
  await page.evaluate(()=>window.testPosts=window.testPosts.filter(p=>p.id!=='old-gallery'));
  await page.locator('#gallery-topic-filter').selectOption('');
  console.log('PASS 공용 주제 추가·선택, 참고 사진 통합 필터, 기존 글 미분류');
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
  assert.equal(await page.locator('.content-attachment button').count(),1);
  assert.equal(await page.getByRole('button',{name:/관찰.png.*다운로드/}).count(),0);
  assert.ok(mediaVariants.includes('thumb')&&mediaVariants.includes('display'));
  const download=page.waitForEvent('download');await page.getByRole('button',{name:/활동지.pdf.*다운로드/}).click();assert.equal((await download).suggestedFilename(),'활동지.pdf');
  await page.locator('#content-edit').click();await page.locator('#content-form [name="title"]').fill('수정된 사진 기록');await page.locator('#content-form [type="submit"]').click();
  await page.locator('.content-card').filter({hasText:'수정된 사진 기록'}).click();
  await page.locator('#content-delete').click();await page.locator('#content-delete-confirm').click();
  await page.waitForFunction(()=>!document.querySelector('#modal[open]')&&document.querySelectorAll('#member-gallery-list [data-member-post]').length===0);
  assert.equal(await page.evaluate(()=>Object.keys(window.testFiles).length),0);
  assert.ok(driveDeletes.includes(archivedId));assert.equal(driveUploads.size,0);
  console.log('PASS 사진 미리보기, 파일 다운로드, 본인 수정·삭제');
  const initCount=driveCalls.filter(action=>action==='init').length,deleteCount=driveDeletes.length;
  await page.locator('[data-content-category]').click();
  await page.locator('#content-form [name="title"]').fill('깨진 사진 정리 검사');
  await page.locator('#content-form [name="body"]').fill('사진 변환 실패 시 초안과 예약 정보를 정리합니다.');
  await page.locator('[name="gallery_topic"]').selectOption('topic:곤충');
  await page.locator('[name="files"]').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not a decodable image')});
  await page.locator('#content-form [type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#content-error').textContent.length>0&&!document.querySelector('#content-form [type="submit"]').disabled);
  assert.equal(driveCalls.filter(action=>action==='init').length,initCount);
  assert.equal(driveDeletes.length,deleteCount+1);
  assert.equal(await page.evaluate(()=>window.testPosts.some(p=>p.title==='깨진 사진 정리 검사')),false);
  assert.equal(await page.evaluate(()=>window.testAttachments.some(a=>a.filename==='broken.png')),false);
  assert.equal(await page.evaluate(()=>Object.keys(window.testFiles).length),0);
  await page.locator('.modal-close').click();
  console.log('PASS decode failure before Drive init removes reservation and draft without fallback');
  await page.evaluate(()=>{window.testFailUpload=true;window.testFailCleanup=true;});
  await page.locator('[data-content-category]').click();
  await page.locator('#content-form [name="title"]').fill('미완료 업로드 검사');
  await page.locator('#content-form [name="body"]').fill('실패 복구 검증입니다.');
  await page.locator('[name="gallery_topic"]').selectOption('topic:곤충');
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
  await page.waitForFunction(()=>!document.querySelector('#modal[open]')&&document.querySelectorAll('#member-gallery-list [data-member-post]').length===0);
  assert.equal(await page.evaluate(()=>Object.keys(window.testFiles).length),0);
  console.log('PASS 토큰 갱신 중 업로드 유지, 정리 실패 시 비공개 초안 보존 및 삭제 재시도');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>location.hash='#/resources');await page.locator('.content-card').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'content-mobile-check.png',fullPage:true});
  await page.evaluate(()=>{window.testStatus='pending';location.hash='#/gallery';});
  await page.getByRole('heading',{name:'승인된 회원과 함께 나눕니다.'}).waitFor();
  await page.evaluate(()=>{
    const base={category:'활동 기록',body:'포트폴리오 설명',created_at:new Date().toISOString(),published:true,portfolio_public:true,activity_date:'2026-01-10'};
    window.testPosts.push({...base,id:'new-public',title:'새 공개 활동'},{...base,id:'private-activity',title:'비공개 활동',portfolio_public:false},{...base,id:'draft-activity',title:'미완료 활동',published:false});
    window.testAttachments.push({id:'public-photo',post_id:'new-public',object_path:'portfolio/photo.png',filename:'활동.png',mime:'image/png',bytes:67},{id:'private-doc',post_id:'new-public',object_path:'portfolio/doc.pdf',filename:'비공개문서.pdf',mime:'application/pdf',bytes:20});
    const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));window.testFiles['portfolio/photo.png']=new Blob([bytes],{type:'image/png'});
    window.testAnonymous=true;window.testAuthChange('SIGNED_OUT');location.hash='#/about';
  });
  await page.locator('#activity-portfolio-list .content-thumbnail img').waitFor();
  assert.equal(await page.locator('[data-portfolio-post]').count(),2);
  assert.match(await page.locator('[data-portfolio-post]').first().textContent(),/새 공개 활동/);
  assert.match(await page.locator('[data-portfolio-post]').last().textContent(),/2024.*2.*29/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.activity-portfolio').screenshot({path:'content-mobile-check.png'});
  await page.locator('[data-portfolio-post="new-public"]').click();
  await page.locator('.content-image').waitFor();
  assert.equal(await page.locator('.member-post-copy').textContent(),'포트폴리오 설명');
  assert.equal(await page.locator('.content-attachment').count(),1);
  assert.equal(await page.locator('.content-attachment button').count(),0);
  assert.equal(await page.locator('#content-edit').count(),0);
  await page.locator('.modal-close').click();
  await page.evaluate(()=>{window.testPosts.find(p=>p.id==='new-public').portfolio_public=false;location.hash='#/';});
  await page.locator('.hero').waitFor();await page.evaluate(()=>location.hash='#/about');
  await page.waitForFunction(()=>document.querySelectorAll('[data-portfolio-post]').length===1);
  await page.evaluate(()=>{window.testPosts.forEach(p=>p.portfolio_public=false);location.hash='#/';});
  await page.locator('.hero').waitFor();await page.evaluate(()=>location.hash='#/about');
  await page.getByRole('heading',{name:'공개된 활동을 준비하고 있습니다.'}).waitFor();
  console.log('PASS 비로그인 포트폴리오, 활동 날짜순, 사진·설명 표시, 문서·초안·비공개 제외, 공개 철회');
  assert.deepEqual(errors,[]);console.log('PASS 모바일 레이아웃, 승인 대기 접근 차단, 브라우저 오류 없음');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
