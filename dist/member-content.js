(function(){
  'use strict';
  window.createBioSEMContent=function(deps){
    const {state,sync,open,notify,refresh}=deps,c=window.BioSEMContentCore,e=window.BioSEMMembership.escape;
    const client=()=>deps.client(),allowed=()=>window.BioSEMMembership.canParticipate(state),bucket=()=>client().storage.from('biosem-files');
    const urls=new Set(),loads=new Map();let epoch=0,authEpoch=0,busy=false;
    const $=s=>document.querySelector(s),date=v=>new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium'}).format(new Date(v));
    function invalidate(){epoch++;loads.clear();for(const u of urls)URL.revokeObjectURL(u);urls.clear();}
    function invalidateAuth(){authEpoch++;invalidate();}
    function blobUrl(blob){const u=URL.createObjectURL(blob);urls.add(u);return u;}
    function errorText(error){return error?.userMessage||'처리하지 못했습니다. 회원 상태와 연결을 확인한 뒤 다시 시도해 주세요.';}
    function userError(message){return Object.assign(new Error(message),{userMessage:message});}
    function validate(fn){try{return fn();}catch(err){throw userError(err.message);}}
    async function requireMember(){await sync();if(!allowed()){await open(state.user?'account':'login');return false;}return true;}
    function showError(error){const el=$('#content-error');if(el){el.textContent=errorText(error);el.focus();}else notify(errorText(error));}
    async function compose(category,post=null){
      if(!await requireMember())return;
      if(post&&post.author_id!==state.user.id&&!state.isAdmin)return;
      window.BioSEMUI.openModal(`<div class="modal-inner member-post-form"><div class="eyebrow">SHARE YOUR DISCOVERY</div><h2 id="modal-title">${post?'게시물 수정':e(category)+' 등록'}</h2><form id="content-form" data-post-id="${e(post?.id||'')}"><label class="form-field">메뉴·분류<select name="category">${c.categories.map(x=>`<option ${x===category?'selected':''}>${e(x)}</option>`).join('')}</select></label><label class="form-field">제목<input name="title" required minlength="2" maxlength="120" value="${e(post?.title||'')}"></label><label class="form-field">내용<textarea name="body" required minlength="2" maxlength="10000" placeholder="관찰 내용, 설명과 출처를 적어주세요.">${e(post?.body||'')}</textarea></label>${post?'<p class="preview-note">기존 첨부 파일은 유지됩니다. 제목·내용·분류를 수정할 수 있습니다.</p>':`<label class="form-field">사진·자료 첨부<input name="files" type="file" multiple accept="${Object.keys(c.types).map(x=>'.'+x).join(',')}"></label><p class="preview-note">최대 5개 · 파일당 50MB. JPG·PNG·WebP 사진, PDF·한글·Word·PowerPoint·Excel 문서를 올릴 수 있습니다.</p><ul id="content-file-list" class="attachment-selection"></ul>`}<p class="privacy-copy">승인된 회원에게만 공개됩니다. 공유 권한이 있는 자료만 올리고 학생·타인의 개인정보는 제거해 주세요.</p><div id="content-error" class="member-error" tabindex="-1" role="alert"></div><p id="content-progress" role="status" aria-live="polite"></p><button class="button primary wide" type="submit">${post?'수정 저장':'게시하기'}</button></form></div>`);
    }
    async function save(form){
      if(busy)return;busy=true;
      const button=form.querySelector('[type="submit"]');button.disabled=true;
      let draft=null;const uploaded=[];let published=false;
      try{
        if(!await requireMember())return;
        const actor=state.user.id,start=authEpoch,data=new FormData(form),id=form.dataset.postId;
        const fields=validate(()=>c.validatePost(Object.fromEntries(data)));
        const files=id?[]:validate(()=>c.validateFiles(Array.from(form.elements.files.files)));
        const active=()=>authEpoch===start&&state.user?.id===actor&&allowed();
        if(id){const result=await client().from('biosem_posts').update(fields).eq('id',id).select('id').single();if(result.error)throw result.error;}
        else{
          draft=crypto.randomUUID();
          const result=await client().from('biosem_posts').insert({...fields,id:draft,author_id:actor,published:false}).select('id').single();if(result.error){draft=null;throw result.error;}
          for(let i=0;i<files.length;i++){
            if(!active())throw userError('로그인 상태가 바뀌었습니다. 다시 시도해 주세요.');
            const item=files[i],attachmentId=crypto.randomUUID(),path=actor+'/'+draft+'/'+attachmentId+'.'+item.extension;
            const progress=form.querySelector('#content-progress');if(progress)progress.textContent=`파일 ${i+1}/${files.length} 업로드 중…`;
            const metadata=await client().from('biosem_attachments').insert({id:attachmentId,post_id:draft,object_path:path,filename:item.file.name,mime:item.mime,bytes:item.file.size});if(metadata.error)throw metadata.error;
            uploaded.push(path);
            const upload=await bucket().upload(path,item.file,{contentType:item.mime,upsert:false});if(upload.error)throw upload.error;
          }
          if(!active())throw userError('로그인 상태가 바뀌었습니다. 다시 시도해 주세요.');
          const done=await client().from('biosem_posts').update({published:true}).eq('id',draft).select('id').single();if(done.error)throw done.error;published=true;
        }
        if(!active())return;
        window.BioSEMUI.closeModal();notify(id?'게시물을 수정했습니다.':'게시물을 등록했습니다.');
        await deps.navigate(fields.category);
      }catch(error){
        if(draft&&!published){try{if(uploaded.length){const removal=await bucket().remove(uploaded);if(removal.error)throw removal.error;}const removal=await client().from('biosem_posts').delete().eq('id',draft).select('id').single();if(removal.error)throw removal.error;}catch{error=userError('업로드 정리를 완료하지 못했습니다. 목록에 나에게만 보이는 미완료 게시물이 남아 있습니다. 연결이 복구되면 해당 게시물을 삭제하고 다시 등록해 주세요.');}}
        showError(error);
      }finally{busy=false;if(button.isConnected)button.disabled=false;}
    }
    async function load(category,target,page=0){
      const key=target.id,token=Symbol(),start=epoch;loads.set(key,token);
      const active=()=>epoch===start&&loads.get(key)===token&&target.isConnected;
      await sync();if(!active())return;
      if(!allowed()){target.innerHTML='<div class="empty-state compact"><h2>승인된 회원과 함께 나눕니다.</h2><p>회원이 등록한 글·사진·자료는 로그인과 가입 승인 후 볼 수 있습니다.</p><button class="button primary" data-member-action="'+(state.user?'account':'login')+'">'+(state.user?'내 회원 상태 확인':'로그인')+'</button></div>';return;}
      const actor=state.user.id;target.innerHTML='<p class="member-loading">게시물을 불러오고 있습니다.</p>';
      const r=await client().from('biosem_posts').select('id,title,category,created_at,published,biosem_attachments(id,object_path,mime,filename,bytes)').eq('category',category).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*20,page*20+20);
      if(!active()||state.user?.id!==actor||!allowed())return;
      if(r.error){target.innerHTML='<div class="member-error">게시물을 불러오지 못했습니다.</div>';return;}
      const rows=r.data.slice(0,20),hasNext=r.data.length>20;
      target.innerHTML=rows.length?'<div class="content-grid">'+rows.map(p=>`<button class="content-card" data-member-post="${e(p.id)}">${p.biosem_attachments.some(a=>a.mime.startsWith('image/'))?`<div class="content-thumbnail" data-thumbnail="${e(p.id)}"></div>`:''}<span class="community-tag">${e(p.category)}</span><h3>${e(p.title)}</h3><span class="post-meta">${date(p.created_at)} · 첨부 ${p.biosem_attachments.length}개${p.published?'':' · 업로드 미완료'}</span></button>`).join('')+'</div>':'<div class="empty-state compact"><h2>첫 번째 기록을 남겨보세요.</h2><p>아직 등록된 게시물이 없습니다.</p></div>';
      const pager=document.createElement('div');pager.className='member-actions';
      for(const [label,next,enabled] of [['이전',page-1,page>0],['다음',page+1,hasNext]]){const b=document.createElement('button');b.className='button small';b.textContent=label;b.disabled=!enabled;b.addEventListener('click',()=>load(category,target,next));pager.append(b);}if(page>0||hasNext)target.append(pager);
      for(const p of rows){const first=p.biosem_attachments.find(a=>a.mime.startsWith('image/'));if(!first)continue;const result=await bucket().download(first.object_path);if(!active()||!allowed()||state.user?.id!==actor)return;if(result.error)continue;const holder=target.querySelector(`[data-thumbnail="${p.id}"]`);if(holder){const img=document.createElement('img');img.src=blobUrl(result.data);img.alt=p.title;img.loading='lazy';holder.append(img);}}
    }
    async function show(id){
      const start=epoch,revision=$('#modal').dataset.revision;
      if(!await requireMember()||epoch!==start)return;const actor=state.user.id;
      const r=await client().from('biosem_posts').select('*,biosem_attachments(*)').eq('id',id).maybeSingle();
      if(epoch!==start||state.user?.id!==actor||!allowed()||$('#modal').dataset.revision!==revision)return;
      if(r.error||!r.data){notify('게시물을 확인할 수 없습니다.');return;}const post=r.data;
      window.BioSEMUI.openModal(`<article class="article-content"><div class="eyebrow">${e(post.category)}</div><h2 id="modal-title">${e(post.title)}</h2><p class="review-detail">${date(post.created_at)} · 승인 회원 공개</p><div class="member-post-copy">${e(post.body)}</div><div id="content-attachments" class="content-attachments"></div>${post.author_id===actor||state.isAdmin?'<div class="member-actions"><button class="button" id="content-edit">수정</button><button class="button danger" id="content-delete">삭제</button></div>':''}<div id="content-error" class="member-error" tabindex="-1" role="alert"></div></article>`,'article-modal');
      const view=$('#content-attachments');
      if(!post.published){const note=document.createElement('p');note.className='member-error';note.textContent='업로드 미완료 게시물입니다. 다른 회원에게 공개되지 않습니다. 삭제한 뒤 다시 등록해 주세요.';view.before(note);$('#content-edit')?.remove();}
      if($('#content-edit'))$('#content-edit').onclick=()=>compose(post.category,post);
      if($('#content-delete'))$('#content-delete').onclick=()=>confirmDelete(post);
      for(const a of post.biosem_attachments){
        const row=document.createElement('div');row.className='content-attachment';
        const button=document.createElement('button');button.className='button';button.textContent=`${a.filename} · ${(a.bytes/1024/1024).toFixed(1)}MB 다운로드`;
        button.onclick=async()=>{button.disabled=true;try{if(!await requireMember())return;const result=await bucket().download(a.object_path);if(result.error)throw result.error;if(epoch!==start||state.user?.id!==actor||!view.isConnected)return;const link=document.createElement('a');const url=blobUrl(result.data);link.href=url;link.download=a.filename;document.body.append(link);link.click();link.remove();}catch(err){showError(err);}finally{button.disabled=false;}};
        row.append(button);view.append(row);
        if(a.mime.startsWith('image/')){const result=await bucket().download(a.object_path);if(epoch!==start||state.user?.id!==actor||!view.isConnected||!allowed())return;if(!result.error){const img=document.createElement('img');img.src=blobUrl(result.data);img.alt=a.filename;img.className='content-image';row.prepend(img);}}
      }
    }
    function confirmDelete(post){
      window.BioSEMUI.openModal(`<div class="modal-inner"><h2 id="modal-title">게시물을 삭제할까요?</h2><p>${e(post.title)}</p><p>게시물과 첨부 파일이 삭제됩니다.</p><div class="member-actions"><button class="button" data-close>취소</button><button class="button danger" id="content-delete-confirm">삭제하기</button></div><div id="content-error" class="member-error" role="alert" tabindex="-1"></div></div>`);
      $('#content-delete-confirm').onclick=async event=>{event.target.disabled=true;try{if(!await requireMember())return;const paths=post.biosem_attachments.map(a=>a.object_path);if(paths.length){const removed=await bucket().remove(paths);if(removed.error)throw removed.error;}const result=await client().from('biosem_posts').delete().eq('id',post.id).select('id').single();if(result.error)throw result.error;window.BioSEMUI.closeModal();notify('게시물을 삭제했습니다.');await refresh();}catch(err){showError(err);event.target.disabled=false;}};
    }
    document.addEventListener('submit',event=>{if(event.target.id==='content-form'){event.preventDefault();save(event.target);}});
    document.addEventListener('change',event=>{if(event.target.name!=='files'||event.target.form?.id!=='content-form')return;const list=$('#content-file-list');list.innerHTML='';try{const files=validate(()=>c.validateFiles(Array.from(event.target.files)));for(const item of files){const li=document.createElement('li');li.textContent=item.file.name;list.append(li);}$('#content-error').textContent='';}catch(err){showError(err);}});
    return {compose,load,show,invalidate,invalidateAuth};
  };
})();
