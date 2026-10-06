// Local owner-only setup. Never deploy this script or the downloaded OAuth JSON.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';

const clientFile=process.argv[2];
if(!clientFile){console.error('Usage: node drive-oauth-setup.mjs <Google Desktop OAuth client JSON path>');process.exit(1);}
const owner='jih751@gmail.com',scope='https://www.googleapis.com/auth/drive.file';
let credentials;
try{credentials=JSON.parse(await readFile(resolve(clientFile),'utf8')).installed;}
catch{console.error('OAuth JSON 파일을 읽지 못했습니다. 내려받은 원본 파일의 경로와 형식을 확인해 주세요.');process.exit(1);}
if(!credentials?.client_id||!credentials?.client_secret)throw Error('Google Cloud에서 데스크톱 앱 유형의 OAuth 클라이언트 JSON을 선택해 주세요.');
const secretDir=join(homedir(),'.claude','secrets'),secretFile=join(secretDir,'.env');
let previous='';try{previous=await readFile(secretFile,'utf8');}catch(err){if(err.code!=='ENOENT')throw err;}
function existing(key){const line=previous.split(/\r?\n/).find(s=>s.startsWith(key+'='));if(!line)return '';const value=line.slice(key.length+1);try{return value.startsWith('"')?JSON.parse(value):value;}catch{return '';}}
const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
let used=false,timeout,redirectUri;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='GET'||url.pathname!=='/callback'){res.writeHead(404).end('Not found');return;}
  const received=Buffer.from(url.searchParams.get('state')||''),expected=Buffer.from(state);
  if(used||received.length!==expected.length||!timingSafeEqual(received,expected)){res.writeHead(400).end('유효하지 않은 연결 요청입니다.');return;}
  used=true;
  try{
    if(url.searchParams.has('error')||!url.searchParams.get('code'))throw Error('Google 승인이 완료되지 않았습니다.');
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:credentials.client_id,client_secret:credentials.client_secret,code:url.searchParams.get('code'),redirect_uri:redirectUri,grant_type:'authorization_code',code_verifier:verifier}),signal:AbortSignal.timeout(20000)});
    if(!tokenResponse.ok)throw Error('인증 코드 교환에 실패했습니다. 설정을 확인한 뒤 다시 실행해 주세요.');
    const tokens=await tokenResponse.json();
    if(!tokens.refresh_token||!tokens.scope?.split(' ').includes(scope))throw Error('지속 연결 권한을 받지 못했습니다. 다시 승인해 주세요.');
    const headers={Authorization:'Bearer '+tokens.access_token};
    const aboutResponse=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota',{headers,signal:AbortSignal.timeout(20000)});
    if(!aboutResponse.ok)throw Error('Drive API가 활성화되어 있는지 확인해 주세요.');
    const about=await aboutResponse.json();
    if(about.user?.emailAddress?.toLowerCase()!==owner)throw Error('지정한 jih751@gmail.com 계정으로 다시 연결해 주세요.');
    let folderId=existing('GOOGLE_DRIVE_FOLDER_ID');
    if(folderId){
      const r=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(folderId)+'?fields=id,mimeType,trashed',{headers,signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw Error('기존 BioSEM 폴더 접근을 확인하지 못했습니다. 기존 연결을 확인해 주세요.');
      const folder=await r.json();if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder')throw Error('기존 BioSEM 폴더가 유효하지 않습니다.');
    }else{
      const r=await fetch('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:'BioSEM 사진 보관함',mimeType:'application/vnd.google-apps.folder',description:'BioSEM 원본·열람용 이미지. 공개 링크를 만들지 마세요.'}),signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw Error('BioSEM 보관 폴더를 만들지 못했습니다.');folderId=(await r.json()).id;
    }
    const encryptionKey=existing('DRIVE_ENCRYPTION_KEY')||randomBytes(32).toString('base64');
    if(Buffer.from(encryptionKey,'base64').length!==32)throw Error('기존 암호화 키 형식을 확인해 주세요. 키를 임의로 교체하지 마세요.');
    const updates={GOOGLE_DRIVE_CLIENT_ID:credentials.client_id,GOOGLE_DRIVE_CLIENT_SECRET:credentials.client_secret,GOOGLE_DRIVE_REFRESH_TOKEN:tokens.refresh_token,GOOGLE_DRIVE_FOLDER_ID:folderId,DRIVE_ENCRYPTION_KEY:encryptionKey};
    let lines=previous.split(/\r?\n/);for(const [key,value] of Object.entries(updates)){lines=lines.filter(line=>!line.startsWith(key+'='));lines.push(key+'='+JSON.stringify(value));}
    await mkdir(secretDir,{recursive:true});await writeFile(secretFile,lines.filter((line,i)=>line||i>0).join('\n')+'\n',{mode:0o600});
    console.log('Google Drive owner verified: '+owner);console.log('OAuth credentials saved securely in the central secrets file. No credentials printed.');
    console.log('Next: copy named values securely to Vercel Production env and verify a controlled upload before enabling Drive photo storage.');
    res.end('BioSEM 드라이브 연결 승인이 완료되었습니다. 이 창을 닫고 Codex로 돌아가세요.');
  }catch(error){console.error(error.message);res.writeHead(400).end(error.message);process.exitCode=1;}
  finally{clearTimeout(timeout);server.close();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
redirectUri='http://127.0.0.1:'+server.address().port+'/callback';
const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
for(const [k,v] of Object.entries({client_id:credentials.client_id,redirect_uri:redirectUri,response_type:'code',scope,access_type:'offline',prompt:'consent',login_hint:owner,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))auth.searchParams.set(k,v);
console.log('Open this Google authorization link in your browser:');console.log(auth.href);
timeout=setTimeout(()=>{console.error('Authorization timed out. Run setup again when ready.');server.close();process.exitCode=1;},10*60*1000);
