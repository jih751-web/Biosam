# BioSEM Google Drive 연결

대상 계정: jih751@gmail.com. 원본 및 두 종류의 화면용 사진은 이 계정의 비공개 전용 폴더에 저장합니다. OAuth 인증정보는 브라우저·Git에 넣지 않습니다. 별도 유료 서비스를 활성화하지 않습니다.

## 소유자가 준비할 것
1. Google Cloud Console에서 기존 Google 로그인용 프로젝트를 선택합니다. 기존 로그인 클라이언트는 수정하지 않습니다.
2. API 라이브러리에서 **Google Drive API**를 활성화합니다.
3. Google Auth Platform → 클라이언트에서 별도 **데스크톱 앱** OAuth 클라이언트를 만들고 JSON을 다운로드합니다. 프로젝트 폴더 밖에 보관합니다. 비밀키를 채팅에 붙이지 않습니다.
4. OAuth 동의 화면에 `https://www.googleapis.com/auth/drive.file` 범위를 사용합니다. 외부 앱이 테스트 상태라면 계정을 테스트 사용자에 추가해야 하며 갱신 토큰이 7일 뒤 만료될 수 있습니다. 지속 운영은 게시 상태와 계정 정책을 확인한 뒤 진행합니다.

## 로컬 승인
`node drive-oauth-setup.mjs <다운로드한 JSON의 절대 경로>`

출력되는 Google 링크를 열어 jih751@gmail.com으로 승인합니다. 도구는 상태 토큰·PKCE를 검증하고, 실제 Drive 계정을 확인한 뒤 비공개 BioSEM 폴더를 생성합니다. 인증정보는 워크스페이스 규칙에 따라 `~/.claude/secrets/.env`에 저장하며 콘솔에는 출력하지 않습니다. 기존 암호화 키는 보존합니다.

## 서버 설정
Vercel **Production 전용** 비밀 환경변수: GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID, DRIVE_ENCRYPTION_KEY.
서버용 Supabase 연결값: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. 서비스 역할 키는 필요하지 않습니다.

`DRIVE_STORAGE_ENABLED=true`일 때만 서버 업로드가 활성화됩니다. 프런트의 `BIOSEM_CONFIG.photoStorage`는 검증 전까지 `supabase`로 둡니다. 서버 설정 후 제어된 원본/미리보기 업로드·열람·삭제를 확인하고 `drive`로 전환해 배포합니다. 승인 전에는 실제 Drive 저장이 완료되었다고 보고하지 않습니다.

## 배포 순서
1. `drive-storage.sql` 추가 스키마와 RLS 적용 및 검증.
2. 서버 환경변수 등록, 원본 조회 금지·비회원 공개 사진 조회·문서 비공개·삭제 복구 테스트.
3. 서버 API 배포 후 실제 Drive 전송 확인.
4. `dist/config.js`의 `photoStorage`를 `drive`로 전환하고 사진 업로드 안내 및 개인정보 처리 안내를 최종 반영.

## 동작과 비용
- 원본 50MiB 이하, 게시글당 5파일 제한을 유지합니다. 원본은 변형하지 않습니다.
- 썸네일 최대 600px/256KiB, 열람용 최대 2048px/1MiB WebP. 작은 사진은 확대하지 않습니다.
- API 업로드는 1MiB 이하 조각을 사용합니다. Google OAuth 토큰·원본 파일 ID는 클라이언트에 전달하지 않습니다.
- 드라이브 파일은 공개 공유하지 않습니다. 서버가 Supabase의 최신 접근 권한을 확인해 화면용 이미지만 반환합니다.
- 화면용 사진도 Vercel 전송·함수 사용량과 Google API 사용량이 발생합니다. 무료 한도 내 운영을 목표로 하며 무제한·무과금을 보장하지 않습니다.
- 문서 및 기존 Supabase 사진은 기존 방식으로 유지합니다. 사진 원본 다운로드 버튼은 제공하지 않습니다.
- 게시글 삭제 시 Drive 파일을 먼저 정리하며 실패하면 기록을 남겨 재시도합니다. 업로드 실패 시 비공개 초안을 삭제해 정리할 수 있습니다.

현재 상태(2026-10-06): 소유자 OAuth, 운영 DB 마이그레이션과 Vercel Production 비밀 환경변수 등록 완료. `drive-live-check.mjs`에서 실제 Google Drive 원본·WebP 업로드, 비공개 권한, 축소 이미지 조회, 원본 조회 차단 및 테스트 파일 3개 삭제를 확인했습니다. 이 검사의 회원 인증·메타데이터만 메모리 모형을 사용하며 운영 회원 인증 검증과 구별합니다. 로컬 권한·브라우저 회귀 검사도 통과했습니다. `photoStorage`를 `drive`로 전환했으며 운영 배포를 준비합니다.

남은 운영 설정: Google OAuth 게시 상태를 확인해야 합니다. Testing에서 발급된 갱신 토큰은 일반적으로 7일 후 만료되므로 Production 전환 후 같은 로컬 도구로 재승인하고, 기존 폴더·암호화 키를 유지하면서 Vercel 갱신 토큰을 교체·재배포합니다.

운영 배포 결과: 코드 `301fb40`을 https://biosam.vercel.app 에 배포했고 Vercel READY를 확인했습니다. `/api/drive?action=status`는 configured=true, 원본 요청과 비로그인 쓰기는 403, 존재하지 않는 사진은 404입니다. 공개 포트폴리오의 새 컬럼 조회는 200입니다. 운영 회원의 로그인 세션을 이용한 전체 업로드는 별도 확인 대상입니다. Vercel 로그 집계는 연결 권한 오류(403)로 확인하지 못했으며 직접 HTTP 응답 검증과 구별합니다.

공식 설정 참고: [Google 데스크톱 OAuth 안내](https://developers.google.com/identity/protocols/oauth2/native-app), [Google Drive API 활성화](https://console.cloud.google.com/apis/library/drive.googleapis.com).
