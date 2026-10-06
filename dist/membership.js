(function(){
  'use strict';
  const core=window.BioSEMMembership,e=core.escape,config=window.BIOSEM_CONFIG||{};
  const state={configured:core.configured(config),ready:false,user:null,membership:null,isAdmin:false,error:null};
  let client=null,syncVersion=0,routeVersion=0,adminRows=[],adminFilter='pending',adminSearch='',postCategory='자유 나눔',pendingCategory=null;
  const demoRows=[
    {user_id:'example-a',real_name:'탐구 교사 A',institution:'예시 고등학교',interest:'식물 미세구조',introduction:'잎의 표면 구조를 관찰하고 수업 자료로 나누고 싶습니다.',status:'pending',submitted_at:'2026-10-06T00:00:00Z'},
    {user_id:'example-b',real_name:'탐구 교사 B',institution:'예시 중학교',interest:'생물 수업 활용',introduction:'학생들과 관찰 이미지를 함께 읽는 활동을 준비하고 있습니다.',status:'pending',submitted_at:'2026-10-05T00:00:00Z'},
    {user_id:'example-c',real_name:'탐구 교사 C',institution:'예시 과학고등학교',interest:'SEM 기초 및 관찰',introduction:'관찰 조건을 기록하는 방법을 함께 정리하고 싶습니다.',status:'approved',submitted_at:'2026-10-04T00:00:00Z'},
    {user_id:'example-d',real_name:'탐구 교사 D',institution:'예시 교육기관',interest:'미생물 관찰',introduction:'규조류 관찰에 관심이 있습니다.',status:'rejected',review_note:'소속 정보를 확인한 뒤 다시 검토합니다.',submitted_at:'2026-10-03T00:00:00Z'}
  ];
  const requestGate=core.createRequestGate();
  let adminPage=0,adminTotal=0,adminCounts={},searchTimer;
  const selector=s=>document.querySelector(s);
  const routeName=()=>location.hash.replace(/^#\/?/,'').split('/')[0];
  const demo=()=>routeName()==='admin-preview'&&!state.configured;
  const date=value=>value&&!Number.isNaN(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium'}).format(new Date(value)):'—';
  const badge=status=>`<span class="member-state ${e(status)}">${e(core.labels[status]||'확인 필요')}</span>`;
  const head=(name,en,description)=>`<div class="container page-head"><div class="breadcrumb"><a href="#/">홈</a> &nbsp;/&nbsp; ${name}</div><div class="eyebrow">${en}</div><h1>${name}</h1><p>${description}</p></div>`;
  function modal(html,cls=''){window.BioSEMUI.openModal(html,cls);}
  function notify(text){const el=selector('.toast');el.textContent=text;el.classList.add('visible');setTimeout(()=>el.classList.remove('visible'),3500);}
  function errorMessage(error){if(error?.code==='23505')return '이미 접수된 신청입니다. 내 계정에서 상태를 확인해 주세요.';if(error?.code==='40001')return '다른 운영진이 상태를 변경했습니다. 목록을 새로고침해 주세요.';if(error?.code==='42501')return '이 작업을 수행할 권한이 없습니다. 회원 상태를 확인해 주세요.';return '처리하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.';}
  function showError(text){const el=selector('#member-error');if(el){el.textContent=text;el.focus();}else notify(text);}
  async function sync(){
    const version=++syncVersion;
    if(!client){state.ready=true;return;}
    try{
      const {data,error}=await client.auth.getUser();
      if(version!==syncVersion)return;
      if(error&&error.name!=='AuthSessionMissingError')throw error;
      state.user=data?.user||null;state.membership=null;state.isAdmin=false;state.error=null;
      if(state.user){
        const [membership,admin]=await Promise.all([client.from('biosem_memberships').select('*').eq('user_id',state.user.id).maybeSingle(),client.rpc('biosem_is_admin')]);
        if(version!==syncVersion)return;
        if(membership.error||admin.error)throw membership.error||admin.error;
        state.membership=membership.data;state.isAdmin=admin.data===true;
      }
    }catch(error){if(version===syncVersion){state.membership=null;state.isAdmin=false;state.error=errorMessage(error);}}
    finally{if(version===syncVersion){state.ready=true;updateHeader();}}
  }
  function updateHeader(){
    const login=selector('.login-button');login.textContent=state.user?'내 계정':'로그인';
    login.dataset.auth=state.user?'account':'login';
    let link=selector('.admin-header-link');
    if(state.isAdmin&&!state.error){if(!link){link=document.createElement('a');link.className='admin-header-link';link.href='#/admin';link.textContent='운영진';selector('.header-actions').prepend(link);}}
    else link?.remove();
    if(!state.configured&&!selector('.preview-admin-link')){const preview=document.createElement('a');preview.className='preview-admin-link';preview.href='#/admin-preview';preview.textContent='운영진 화면 미리보기';selector('.footer-links').append(preview);}
  }
  function providers(){return ['google','kakao'].map(provider=>{const enabled=state.configured&&Array.isArray(config.enabledProviders)&&config.enabledProviders.includes(provider);return `<button class="social-button ${provider==='kakao'?'kakao':''}" data-provider="${provider}" ${enabled?'':'disabled'}><b class="provider-icon" aria-hidden="true">${provider==='google'?'G':'●'}</b>${provider==='google'?'구글':'카카오'}로 계속하기${enabled?'':'<small>연결 예정</small>'}</button>`;}).join('');}
  function login(){modal(`<div class="modal-inner"><div class="eyebrow">WELCOME TO BIOSEM</div><h2 id="modal-title">다시 만나서 반갑습니다.</h2><p>본인 확인 후, 운영진 승인을 거쳐 함께합니다.</p>${providers()}<div class="auth-message">${state.configured?'로그인만으로 회원 활동 권한이 생기지 않습니다. 가입 신청 후 운영진 승인이 필요합니다.':'로그인 서비스를 연결하고 있습니다. 연결 전에는 개인정보를 접수하지 않습니다.'}</div><div id="member-error" class="member-error" role="alert" tabindex="-1"></div><div class="auth-switch">BioSEM에 처음 오셨나요?<button data-member-action="join-info">참여 안내</button></div></div>`);}
  async function open(mode){
    if(['form','pending'].includes(mode)&&!state.configured){window.BioSEMUI.openPreviewAuth(mode);return;}
    if(mode==='account'){location.hash='#/account';return;}
    if(mode==='join'){
      modal(`<div class="modal-inner"><div class="eyebrow">JOIN OUR COMMUNITY</div><h2 id="modal-title">다음 발견을 함께해요.</h2><p>BioSEM은 생물교사들이 관찰 경험과 수업 아이디어를 나누는 승인제 공동체입니다.</p><div class="auth-message"><strong>본인 확인 → 가입 신청 → 운영진 승인</strong><br>학교·기관 소속과 참여 목적을 확인한 뒤 회원 활동을 시작할 수 있습니다.</div><button class="button primary wide" data-member-action="begin-application">${state.configured?'가입 신청 시작하기':'가입 신청 화면 살펴보기'}</button><p class="preview-note">${state.configured?'승인 전에는 회원 게시물과 자료 등록을 이용할 수 없습니다.':'현재는 화면 미리보기입니다. 실제 신청은 접수되지 않습니다.'}</p><div class="auth-switch">이미 회원이신가요?<button data-member-action="login">로그인</button></div></div>`);return;
    }
    if(mode==='form'){await sync();if(state.user)showApplication();else login();return;}
    if(state.user){location.hash='#/account';window.BioSEMUI.closeModal();await showAccount();}else login();
  }
  function showApplication(){
    if(state.error){showError(state.error);return;}
    if(state.membership){location.hash='#/account';window.BioSEMUI.closeModal();return;}
    if(!state.user?.email_confirmed_at){modal(`<div class="modal-inner"><div class="eyebrow">IDENTITY CHECK</div><h2 id="modal-title">이메일 확인이 필요합니다.</h2><p>확인된 이메일이 있는 계정으로 로그인한 뒤 신청해 주세요. 카카오 로그인 시 이메일 제공과 확인 상태를 점검해 주세요.</p><button class="button primary wide" data-member-action="logout">로그아웃</button></div>`);return;}
    if(!config.acceptingApplications||!validPrivacyUrl()){modal(`<div class="modal-inner"><div class="eyebrow">MEMBERSHIP</div><h2 id="modal-title">가입 접수를 준비하고 있습니다.</h2><p>운영진과 개인정보 처리 안내 설정을 마치면 신청할 수 있습니다. 아직 신청 정보는 접수하지 않습니다.</p><button class="button primary wide" data-close>확인</button></div>`);return;}
    modal(`<div class="modal-inner"><div class="eyebrow">MEMBERSHIP APPLICATION</div><h2 id="modal-title">BioSEM 가입 신청</h2><p>함께할 선생님에 대해 알려주세요.</p><form id="membership-application"><div class="form-grid"><label class="form-field">이름<input name="real_name" required minlength="2" maxlength="40" autocomplete="name"></label><label class="form-field">학교명<input name="institution" required minlength="2" maxlength="100" autocomplete="organization"></label></div><label class="form-field">전화번호<input name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" placeholder="010-1234-5678"></label><label class="form-field">인증된 이메일<span class="read-only-field">${e(state.user.email)}</span></label><label class="form-field">관심 분야<select name="interest" required><option value="">선택해 주세요</option>${core.interests.map(x=>`<option>${x}</option>`).join('')}</select></label><label class="form-field">참여하고 싶은 활동<textarea name="introduction" maxlength="500" placeholder="함께 탐구하고 싶은 주제를 적어주세요."></textarea></label><label class="check-row"><input name="consent" type="checkbox" required><span><a href="${e(config.privacyNoticeUrl)}" target="_blank" rel="noopener noreferrer">개인정보 처리 안내</a>를 확인했으며 회원 확인을 위한 정보 처리에 동의합니다.</span></label><div id="member-error" class="member-error" role="alert" tabindex="-1"></div><button class="button primary wide" type="submit">가입 신청 제출</button><p class="privacy-copy">신청 정보는 운영진 확인에 사용됩니다. 제출 후 내 계정에서 승인 상태를 확인할 수 있습니다.</p></form></div>`);
  }
  function validPrivacyUrl(){try{const u=new URL(config.privacyNoticeUrl,location.origin);return Boolean(config.privacyNoticeUrl)&&u.protocol==='https:';}catch{return false;}}
  async function showAccount(){
    const version=++routeVersion;selector('#main').innerHTML=head('내 계정','MY MEMBERSHIP','신청 내역과 회원 상태를 확인하세요.')+'<div class="container page-body member-loading">회원 상태를 확인하고 있습니다.</div>';
    await sync();if(version!==routeVersion||routeName()!=='account')return;
    let content;
    if(!state.configured||!state.user){content=`<div class="empty-state"><div class="empty-symbol">◎</div><h2>로그인 후 확인할 수 있습니다.</h2><p>본인 계정의 가입 상태를 확인하는 공간입니다.</p><button class="button primary" data-member-action="login">로그인</button></div>`;}
    else if(state.error){content=`<div class="member-error">${e(state.error)}</div><button class="button" data-member-action="refresh">다시 확인</button>`;}
    else if(!state.membership&&!state.isAdmin){content=`<div class="empty-state"><h2>가입 신청을 완료해 주세요.</h2><p>${e(state.user.email)} 계정으로 로그인했습니다.<br>소속과 관심 분야를 알려주시면 운영진이 확인합니다.</p><button class="button primary" data-member-action="begin-application">가입 신청 작성하기</button></div>`;}
    else{const m=state.membership||{};const label=state.isAdmin?'운영진':core.labels[m.status];const descriptions={pending:'신청하신 정보를 운영진이 확인하고 있습니다. 승인이 완료되면 회원 활동을 이용할 수 있습니다.',approved:'동료 교사들과 질문을 나누고, 관찰 경험을 기록해 보세요.',rejected:'운영진의 확인 내용을 살펴보세요. 추가 확인이 끝나면 운영진이 신청을 다시 검토할 수 있습니다.',suspended:'현재 회원 활동을 이용할 수 없습니다. 아래 운영진 안내를 확인해 주세요.'};content=`<div class="member-summary"><div class="member-profile"><div class="eyebrow">YOUR COMMUNITY</div><h2>${e(m.real_name||'BioSEM 운영진')} 선생님</h2><p>${state.isAdmin?'가입 신청을 확인하고 동료 교사들이 함께할 수 있도록 도와주세요.':e(descriptions[m.status]||'회원 상태를 확인하고 있습니다.')}</p><span class="member-state ${e(m.status||'approved')}">${label}</span></div><div class="soft-panel"><h2>가입 정보</h2><dl class="member-data"><div><dt>계정</dt><dd>${e(state.user.email)}</dd></div><div><dt>학교명</dt><dd>${e(m.institution||'운영진 계정')}</dd></div><div><dt>전화번호</dt><dd>${e(m.phone||'—')}</dd></div><div><dt>관심 분야</dt><dd>${e(m.interest||'—')}</dd></div><div><dt>신청일</dt><dd>${date(m.submitted_at)}</dd></div></dl></div></div>${m.review_note?`<div class="soft-panel"><h2>운영진 안내</h2><p class="review-copy">${e(m.review_note)}</p></div>`:''}<div class="member-actions">${state.isAdmin?'<a class="button primary" href="#/admin">운영진 관리</a>':''}${core.canParticipate(state)?'<button class="button primary" data-member-action="write">커뮤니티 글쓰기</button><button class="button" data-member-action="resource-write">교육 자료 글 등록</button>':''}<button class="button" data-member-action="refresh">상태 새로고침</button></div>`;}
    selector('#main').innerHTML=head('내 계정','MY MEMBERSHIP','신청 내역과 회원 상태를 확인하세요.')+`<section class="container page-body">${content}${state.user?'<div class="member-actions"><button class="button small" data-member-action="logout">로그아웃</button></div>':''}</section>`;
  }
  async function showAdmin(){
    const version=++routeVersion,preview=demo();
    selector('#main').innerHTML=head('운영진 관리','COMMUNITY DESK','함께할 선생님들의 신청 정보를 확인합니다.')+'<div class="container page-body member-loading">신청 목록을 확인하고 있습니다.</div>';
    if(!preview){await sync();if(version!==routeVersion)return;if(!state.user||!state.isAdmin||state.error){selector('#main').innerHTML=head('운영진 관리','COMMUNITY DESK','승인 권한이 있는 운영진을 위한 공간입니다.')+'<section class="container page-body"><div class="empty-state"><h2>운영진 계정이 필요합니다.</h2><p>'+e(state.error||'운영진 계정으로 로그인해 주세요.')+'</p><button class="button primary" data-member-action="login">로그인</button></div></section>';return;}}
    selector('#main').innerHTML=head('운영진 관리','COMMUNITY DESK','함께할 선생님들의 신청 정보를 확인합니다.')+'<section class="container page-body">'+(preview?'<div class="admin-note"><span class="availability">디자인 미리보기</span><span>아래 인물과 신청은 모두 예시입니다. 변경은 실제 회원에게 영향을 주지 않으며 저장되지 않습니다.</span></div>':'')+'<div class="admin-stats">'+Object.entries(core.labels).map(([key,label])=>'<div class="admin-stat"><span>'+label+'</span><strong data-admin-count="'+key+'">—</strong></div>').join('')+'</div><div class="admin-toolbar"><div class="filter-tabs">'+[['all','전체'],...Object.entries(core.labels)].map(([key,label])=>'<button class="filter-tab '+(adminFilter===key?'active':'')+'" data-admin-filter="'+key+'" aria-pressed="'+(adminFilter===key)+'">'+label+'</button>').join('')+'</div><label><span class="sr-only">신청자 또는 소속 검색</span><input class="admin-search" id="admin-search" maxlength="100" placeholder="신청자·소속 검색" value="'+e(adminSearch)+'"></label></div><div id="admin-list" class="admin-list"></div><div id="admin-pagination" class="member-actions"></div><div class="admin-footer">처리한 상태 변경은 운영진 검토 기록에 남습니다.</div><div class="member-actions"><button class="button small" data-member-action="refresh">목록 새로고침</button></div></section>';
    await loadAdminRows();
  }
  async function loadAdminRows(){
    const current=requestGate.capture('admin-list'),version=routeVersion,target=selector('#admin-list');
    if(!target)return;target.innerHTML='<div class="member-loading">신청 목록을 불러오고 있습니다.</div>';
    if(demo()){const rows=demoRows.filter(x=>(adminFilter==='all'||x.status===adminFilter)&&(x.real_name+' '+x.institution).toLowerCase().includes(adminSearch.toLowerCase()));adminTotal=rows.length;adminCounts=Object.fromEntries(Object.keys(core.labels).map(key=>[key,demoRows.filter(x=>x.status===key).length]));adminRows=rows.slice(adminPage*25,(adminPage+1)*25);}
    else{const r=await client.rpc('biosem_list_members',{p_status:adminFilter,p_search:adminSearch,p_page:adminPage});if(!current()||version!==routeVersion||!target.isConnected||!state.isAdmin)return;if(r.error){target.innerHTML='<div class="member-error">'+e(errorMessage(r.error))+'</div>';return;}adminRows=r.data.rows;adminTotal=r.data.total;adminCounts=r.data.counts;}
    if(!current()||version!==routeVersion||!target.isConnected)return;
    if(adminPage>0&&adminPage*25>=adminTotal){adminPage=Math.max(0,Math.ceil(adminTotal/25)-1);await loadAdminRows();return;}
    document.querySelectorAll('[data-admin-count]').forEach(el=>el.textContent=String(adminCounts[el.dataset.adminCount]||0));
    paintAdminList();const pages=Math.max(1,Math.ceil(adminTotal/25));selector('#admin-pagination').innerHTML='<button class="button small" data-admin-page="previous" '+(adminPage===0?'disabled':'')+'>이전</button><span class="member-help">'+(adminPage+1)+' / '+pages+' 페이지 · '+adminTotal+'명</span><button class="button small" data-admin-page="next" '+(adminPage+1>=pages?'disabled':'')+'>다음</button>';
  }
  function paintAdminList(){const list=adminRows;const target=selector('#admin-list');if(!target)return;target.innerHTML=list.length?'<div class="admin-row admin-table-header"><span>신청자</span><span>소속</span><span>관심 분야</span><span>상태</span><span>검토</span></div>'+list.map(x=>`<div class="admin-row"><div><strong>${e(x.real_name)}</strong><small>${date(x.submitted_at)}</small></div><span class="institution">${e(x.institution)}</span><span class="interest">${e(x.interest)}</span>${badge(x.status)}<button class="button small" data-review-id="${e(x.user_id)}">살펴보기</button></div>`).join(''):'<div class="empty-state compact"><h2>해당하는 신청이 없습니다.</h2><p>다른 상태를 선택하거나 검색어를 바꿔보세요.</p></div>';}
  function reviewMember(id){const row=adminRows.find(x=>x.user_id===id);if(!row)return;const actions={approved:row.status==='suspended'?'이용 복구':'회원 승인',rejected:'신청 반려',suspended:'이용 정지',pending:'다시 검토'};modal(`<div class="modal-inner"><div class="eyebrow">MEMBERSHIP REVIEW</div><div class="account-topline"><h2 id="modal-title">${e(row.real_name)} 선생님</h2>${badge(row.status)}</div><dl class="member-data"><div><dt>학교명</dt><dd>${e(row.institution)}</dd></div><div><dt>전화번호</dt><dd>${e(row.phone||'—')}</dd></div><div><dt>관심 분야</dt><dd>${e(row.interest)}</dd></div><div><dt>신청일</dt><dd>${date(row.submitted_at)}</dd></div></dl><div class="review-copy">${e(row.introduction||'추가 소개가 없습니다.')}</div>${row.review_note?`<p class="review-detail">이전 안내: ${e(row.review_note)}</p>`:''}<label class="form-field">신청자에게 전달할 안내<textarea id="review-note" maxlength="500" placeholder="반려·정지 시 사유를 반드시 입력해 주세요."></textarea></label><p class="review-detail">승인 전 소속과 교사 여부를 별도로 확인해 주세요. 이름과 소속 입력만으로 교사임이 인증되지는 않습니다.</p><div id="member-error" class="member-error" role="alert" tabindex="-1"></div><div class="review-buttons">${(core.transitions[row.status]||[]).map(status=>`<button class="button ${['rejected','suspended'].includes(status)?'danger':'primary'}" data-review-submit="${status}" data-review-member="${e(id)}" data-expected-status="${e(row.status)}">${actions[status]}</button>`).join('')}</div><p class="preview-note">${demo()?'예시 인물의 상태만 변경됩니다.':'처리 결과는 신청자에게 표시되며 운영진 검토 기록에 남습니다.'}</p></div>`);}
  async function submitReview(button){const status=button.dataset.reviewSubmit,note=selector('#review-note').value.trim(),id=button.dataset.reviewMember,old=button.dataset.expectedStatus;if(['rejected','suspended'].includes(status)&&note.length<2){showError('반려 또는 정지 사유를 2자 이상 입력해 주세요.');return;}const buttons=[...document.querySelectorAll('[data-review-submit]')];buttons.forEach(b=>b.disabled=true);try{if(demo()){const row=demoRows.find(x=>x.user_id===id);if(!row||row.status!==old)throw {code:'40001'};row.status=status;row.review_note=note;}else{await sync();if(!state.isAdmin||state.error)throw {code:'42501'};const result=await client.rpc('biosem_review_member',{p_user_id:id,p_expected_status:old,p_status:status,p_note:note});if(result.error)throw result.error;}window.BioSEMUI.closeModal();notify(demo()?'예시 회원 상태를 변경했습니다.':`${core.labels[status]} 처리했습니다.`);await showAdmin();}catch(error){showError(errorMessage(error));buttons.forEach(b=>b.disabled=false);}}
  async function composer(category){await sync();if(!core.canParticipate(state)){await open(state.user?'account':'login');return;}modal(`<div class="modal-inner member-post-form"><div class="eyebrow">SHARE YOUR DISCOVERY</div><h2 id="modal-title">${category==='교육 자료'?'교육 자료 나누기':'이야기 나누기'}</h2><p>관찰 경험과 수업 아이디어를 동료 교사와 나눠보세요.</p><form id="member-post-form"><label class="form-field">분류<select name="category">${['자유 나눔','질문과 답변','교육 자료'].map(c=>`<option ${c===category?'selected':''}>${c}</option>`).join('')}</select></label><label class="form-field">제목<input name="title" required minlength="2" maxlength="120" placeholder="나누고 싶은 이야기의 제목"></label><label class="form-field">내용<textarea name="body" required minlength="2" maxlength="10000" placeholder="관찰한 내용과 질문을 적어주세요. 학생 개인정보는 포함하지 말아 주세요."></textarea></label><p class="preview-note">승인된 회원에게 공개됩니다. 자료는 본문으로 등록하며 파일 첨부는 아직 지원하지 않습니다.</p><div id="member-error" class="member-error" role="alert" tabindex="-1"></div><button class="button primary wide" type="submit">게시하기</button></form></div>`);}
  async function loadPosts(category,target){
    const version=routeVersion,key=target.id==='community-results'?'community-board':'resource-board';
    const current=requestGate.capture(key);
    const active=()=>current()&&version===routeVersion&&target.isConnected&&(key!=='community-board'||selector('[data-filter-group="community"] .active')?.dataset.filter===category);
    await sync();if(!active())return;
    if(!core.canParticipate(state)){target.innerHTML='<div class="empty-state compact"><div class="empty-symbol">◎</div><h2>승인된 회원과 함께 나눕니다.</h2><p>'+e(state.error||'회원 글과 수업 자료는 운영진 승인 후 볼 수 있습니다.')+'</p><button class="button primary" data-member-action="'+(state.user?'account':'login')+'">'+(state.user?'내 회원 상태 확인':'로그인')+'</button></div>';return;}
    const userId=state.user.id;
    target.innerHTML='<div class="member-loading">회원 글을 불러오고 있습니다.</div>';
    const r=await client.from('biosem_posts').select('id,title,category,created_at').eq('category',category).order('created_at',{ascending:false}).limit(50);
    if(!active()||state.user?.id!==userId||!core.canParticipate(state))return;
    if(r.error){target.innerHTML='<div class="member-error">'+e(errorMessage(r.error))+'</div>';return;}
    target.innerHTML=r.data.length?r.data.map(p=>'<button class="community-item" data-member-post="'+e(p.id)+'"><span class="community-tag">'+e(p.category)+'</span><span class="post-title">'+e(p.title)+'</span><span class="post-meta">'+date(p.created_at)+'</span></button>').join(''):'<div class="empty-state compact"><h2>첫 번째 기록을 남겨보세요.</h2><p>아직 등록된 글이 없습니다.</p></div>';
  }
  async function showMemberPost(id){
    const current=requestGate.capture('private-post'),version=routeVersion,revision=selector('#modal').dataset.revision;
    await sync();if(!current()||version!==routeVersion)return;
    if(!core.canParticipate(state)){await open(state.user?'account':'login');return;}
    const userId=state.user.id;
    const r=await client.from('biosem_posts').select('*').eq('id',id).maybeSingle();
    if(!current()||version!==routeVersion||state.user?.id!==userId||!core.canParticipate(state)||selector('#modal').dataset.revision!==revision)return;
    if(r.error||!r.data){notify('글을 확인할 수 없습니다. 회원 상태와 연결을 확인해 주세요.');return;}
    modal('<article class="article-content"><div class="eyebrow">'+e(r.data.category)+'</div><h2 id="modal-title">'+e(r.data.title)+'</h2><p class="review-detail">'+date(r.data.created_at)+' · 승인 회원 공개</p><div class="member-post-copy">'+e(r.data.body)+'</div></article>','article-modal');
  }
  async function route(){requestGate.invalidateAll();routeVersion++;const name=routeName();if(name==='account')await showAccount();else if(name==='admin'||name==='admin-preview')await showAdmin();else if(name==='community'&&pendingCategory){const category=pendingCategory;pendingCategory=null;const tab=[...document.querySelectorAll('[data-filter-group="community"] button')].find(b=>b.dataset.filter===category);if(tab)tab.click();}else if(name==='resources'){const section=selector('.page-body');if(selector('.member-private-board'))return;const block=document.createElement('div');block.className='member-private-board';block.innerHTML='<div class="community-top"><h2>회원 수업 자료</h2><button class="button small primary" data-member-action="resource-write">자료 글 등록</button></div><div id="member-resource-list"></div>';section.append(block);await loadPosts('교육 자료',selector('#member-resource-list'));}}
  document.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button)return;
    if(button.dataset.provider){button.disabled=true;try{const provider=button.dataset.provider;if(!client||!config.enabledProviders.includes(provider))return;const {error}=await client.auth.signInWithOAuth({provider,options:{redirectTo:location.origin+location.pathname}});if(error)throw error;}catch(error){showError(errorMessage(error));button.disabled=false;}return;}
    if(button.dataset.reviewId){reviewMember(button.dataset.reviewId);return;}
    if(button.dataset.reviewSubmit){await submitReview(button);return;}
    if(button.dataset.adminFilter){adminFilter=button.dataset.adminFilter;adminPage=0;document.querySelectorAll('[data-admin-filter]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});await loadAdminRows();return;}if(button.dataset.adminPage){adminPage+=button.dataset.adminPage==='next'?1:-1;await loadAdminRows();return;}
    if(button.dataset.memberPost){await showMemberPost(button.dataset.memberPost);return;}
    if(button.dataset.filter&&button.closest('[data-filter-group="community"]')){requestGate.invalidate('community-board');if(['자유 나눔','질문과 답변'].includes(button.dataset.filter)){postCategory=button.dataset.filter;await loadPosts(postCategory,selector('#community-results'));}return;}
    const action=button.dataset.memberAction;if(!action)return;
    if(action==='login')login();if(action==='account')await open('account');if(action==='join-info')await open('join');
    if(action==='begin-application'){if(!state.configured)window.BioSEMUI.openPreviewAuth('form');else{await sync();if(state.user)showApplication();else login();}}
    if(action==='refresh')await route();
    if(action==='write')await composer(postCategory);if(action==='resource-write')await composer('교육 자료');
    if(action==='logout'){button.disabled=true;if(client){const {error}=await client.auth.signOut({scope:'local'});if(error){notify('로그아웃하지 못했습니다. 다시 시도해 주세요.');button.disabled=false;return;}}syncVersion++;state.user=null;state.membership=null;state.isAdmin=false;state.error=null;adminRows=[];window.BioSEMUI.closeModal();updateHeader();location.hash='#/';notify('로그아웃했습니다.');}
  });
  document.addEventListener('input',event=>{if(event.target.id==='admin-search'){adminSearch=event.target.value;adminPage=0;requestGate.invalidate('admin-list');clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(['admin','admin-preview'].includes(routeName()))loadAdminRows();},250);}});
  document.addEventListener('submit',async event=>{const form=event.target;if(!['membership-application','member-post-form'].includes(form.id))return;event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;try{await sync();if(!state.user||state.error)throw {code:'42501'};const data=new FormData(form);let r;if(form.id==='membership-application'){if(!config.acceptingApplications||!validPrivacyUrl())throw {code:'42501'};const fields=core.validateApplication({...Object.fromEntries(data),consent:data.get('consent')==='on'});r=await client.from('biosem_memberships').insert({...fields,user_id:state.user.id}).select('status').single();}else{if(!core.canParticipate(state))throw {code:'42501'};r=await client.from('biosem_posts').insert({author_id:state.user.id,category:data.get('category'),title:String(data.get('title')).trim(),body:String(data.get('body')).trim()}).select('id').single();}if(r.error)throw r.error;const application=form.id==='membership-application';form.reset();window.BioSEMUI.closeModal();notify(application?'신청을 접수했습니다. 운영진 확인을 기다려 주세요.':'글을 게시했습니다.');if(application){location.hash='#/account';await showAccount();}else{const destination=data.get('category')==='교육 자료'?'resources':'community';if(destination==='community')pendingCategory=String(data.get('category'));if(routeName()===destination){window.BioSEMUI.render();await route();}else location.hash='#/'+destination;}}catch(error){showError(error instanceof Error&&!error.code&&/^이름|^소속|^전화번호|^관심|^참여|^개인정보/.test(error.message)?error.message:errorMessage(error));if(button.isConnected)button.disabled=false;}});
  window.BioSEMAuth={open};
  window.addEventListener('hashchange',route);
  async function initialize(){if(state.configured){try{client=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});client.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'){requestGate.invalidateAll();syncVersion++;state.user=null;state.membership=null;state.isAdmin=false;adminRows=[];window.BioSEMUI.closeModal();updateHeader();const board=selector('#community-results');if(board&&selector('[data-filter-group="community"] .active')?.dataset.filter!=='공지사항')board.innerHTML='';const resources=selector('#member-resource-list');if(resources)resources.innerHTML='';}setTimeout(async()=>{await sync();if(['account','admin'].includes(routeName()))await route();const board=selector('#community-results');const category=selector('[data-filter-group="community"] .active')?.dataset.filter;if(board&&['자유 나눔','질문과 답변'].includes(category))await loadPosts(category,board);const resources=selector('#member-resource-list');if(resources)await loadPosts('교육 자료',resources);},0);});}catch{state.error='인증 연결을 준비하지 못했습니다.';}}await sync();updateHeader();await route();}
  initialize();
})();
