(function(root){
  'use strict';
  const interests=['SEM 기초 및 관찰','식물 미세구조','동물 미세구조','미생물 관찰','생물 수업 활용'];
  const transitions={pending:['approved','rejected'],approved:['suspended'],suspended:['approved'],rejected:['pending']};
  function escape(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
  function validateApplication(input){
    const fields={real_name:String(input.real_name??'').trim(),institution:String(input.institution??'').trim(),interest:String(input.interest??'').trim(),introduction:String(input.introduction??'').trim()};
    if(fields.real_name.length<2||fields.real_name.length>40)throw Error('이름은 2~40자로 입력해 주세요.');
    if(fields.institution.length<2||fields.institution.length>100)throw Error('소속은 2~100자로 입력해 주세요.');
    if(!interests.includes(fields.interest))throw Error('관심 분야를 선택해 주세요.');
    if(fields.introduction.length>500)throw Error('참여 소개는 500자 이내로 입력해 주세요.');
    if(input.consent!==true)throw Error('개인정보 처리 안내를 확인하고 동의해 주세요.');
    return {...fields,consent_version:'2026-10-06'};
  }
  function configured(config){try{const u=new URL(config?.supabaseUrl);return u.protocol==='https:'&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&String(config.supabasePublishableKey||'').startsWith('sb_publishable_');}catch{return false;}}
  function createRequestGate(){let epoch=0;const revisions=new Map();return Object.freeze({
    capture(key){const revision=(revisions.get(key)||0)+1;revisions.set(key,revision);const currentEpoch=epoch;return ()=>currentEpoch===epoch&&revisions.get(key)===revision;},
    invalidate(key){revisions.set(key,(revisions.get(key)||0)+1);},
    invalidateAll(){epoch++;revisions.clear();}
  });}
  const api=Object.freeze({escape,validateApplication,configured,interests,transitions,createRequestGate,
    labels:{pending:'승인 대기',approved:'승인 완료',rejected:'신청 반려',suspended:'이용 정지'},
    canParticipate:state=>Boolean(state.user&&!state.error&&(state.isAdmin||state.membership?.status==='approved'))});
  root.BioSEMMembership=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
