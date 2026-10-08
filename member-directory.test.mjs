import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import core from './dist/membership-core.js';

const source=await readFile(new URL('./dist/membership.js',import.meta.url),'utf8');
const board={innerHTML:'',isConnected:true},login={dataset:{}},handlers={},timers=[];
let status='approved',user={id:'one'},directoryCalls=0,release,fail=false;
const client={auth:{getUser:async()=>({data:{user}}),onAuthStateChange(fn){handlers.auth=fn}},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{status}})}),rpc:async(name,{p_page}={})=>{
  if(name==='biosem_is_admin')return {data:true};
  assert.equal(name,'biosem_member_directory');directoryCalls++;
  if(release===true)await new Promise(resolve=>release=resolve);
  if(fail)return {error:{code:'42501'}};
  return {data:{total:25,rows:[{real_name:p_page?'둘째':'<script>unsafe</script>',institution:'학교',interest:'관찰',introduction:'소개'}]}};
}};
const elements={'#member-directory':board,'.login-button':login,'.admin-header-link':{remove(){}},'#community-results':null};
const context={console,URL,BioSEMMembership:core,BIOSEM_CONFIG:{supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'sb_publishable_test'},supabase:{createClient:()=>client},location:{hash:'#/members'},setTimeout:fn=>{timers.push(fn)},clearTimeout(){},document:{querySelector:s=>elements[s]||null,querySelectorAll:s=>s==='[data-content-board]'?[board]:[],addEventListener:(event,fn)=>handlers[event]=fn},addEventListener:(event,fn)=>handlers[event]=fn,BioSEMUI:{closeModal(){}},createBioSEMContent:()=>({invalidate(){},invalidateAuth(){}})};
context.window=context;
vm.runInNewContext(source,context);
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
await settle();
assert.match(board.innerHTML,/&lt;script&gt;unsafe/);
assert.doesNotMatch(board.innerHTML,/<script>/);
assert.equal(directoryCalls,1);
const click=dataset=>handlers.click({target:{closest:()=>({dataset})}});
await click({directoryPage:'1'});assert.match(board.innerHTML,/둘째/);
for(const value of ['pending','rejected','suspended']){status=value;await handlers.hashchange();assert.match(board.innerHTML,/승인된 회원만/);assert.doesNotMatch(board.innerHTML,/member-directory-card/);}
assert.equal(directoryCalls,2,'blocked viewers, even admins, must not request profiles');
status='approved';fail=true;await handlers.hashchange();assert.match(board.innerHTML,/role="alert"/);assert.doesNotMatch(board.innerHTML,/member-directory-card/);
fail=false;await handlers.hashchange();assert.match(board.innerHTML,/member-directory-card/);
release=true;const loading=handlers.hashchange();await settle();assert.equal(typeof release,'function');
user=null;handlers.auth('SIGNED_OUT');assert.equal(board.innerHTML,'');release();await loading;
while(timers.length)await timers.shift()();
assert.match(board.innerHTML,/승인된 회원만/);assert.doesNotMatch(board.innerHTML,/member-directory-card/);
console.log('PASS directory rendering, HTML escaping, pagination, denied states, server failure and late response after logout');
