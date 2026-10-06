# Google Drive Photo Storage Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development. This plan follows the user's approved scope; credential entry/OAuth remains an external prerequisite.

**Goal:** Archive original member photos in jih751@gmail.com Drive, show only reduced viewing images on BioSEM, preserve all current permissions.

**Architecture / Spec:** Vercel Node endpoint talks to Google Drive using owner offline OAuth and drive.file scope. Originals, 2048px viewing images and 600px thumbnails are private Drive files. Supabase stores only encrypted Drive references, never OAuth tokens. Chunked 1MiB uploads avoid Vercel request limits. Media endpoint exposes only thumbnail/view variants, after Supabase RLS check, with no-store headers. No public Drive permissions or original download endpoint. Other documents keep current Supabase storage behavior. Existing photos remain readable. Feature remains off unless configured; credentials never enter Git or browser code.

**Tech stack:** Existing static JS frontend, Supabase SQL/RLS, Node built-ins on Vercel, Google Drive REST API. No new paid services.

## Interfaces
- DB: biosem_attachments.storage_provider ('supabase' default / 'drive'), drive_ref encrypted text. Owner of approved unpublished post/admin may update these two columns; anonymous column reads remain governed by existing image/public portfolio RLS.
- Env: GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID, DRIVE_ENCRYPTION_KEY (32-byte base64), SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY.
- /api/drive GET action=status -> {configured:boolean}; POST action=init JSON {attachmentId,displayBytes,thumbBytes} -> {sessions:{original:{ticket},display:{ticket},thumb:{ticket}}}; POST action=chunk binary with x-upload-ticket,x-upload-offset -> {complete:boolean}; POST action=complete {attachmentId}; GET action=media&id=&variant=thumb|display -> image; POST action=delete {attachmentId}. Errors JSON {error:string}, no credentials/provider internals.
- Init encrypts original/display/thumb file IDs and expected sizes using attachment ID as associated data; persists drive_ref BEFORE starting Drive resumable sessions. Failures retain discoverable draft for cleanup. No client-supplied file ID/URL.
- Every write verifies Supabase user, current approval/admin and owner; upload requires own unpublished post. Delete allows approved owner/admin. Every read uses Supabase row visibility; original variant forbidden. Preview uploads webp only, <=1MiB display and <=256KiB thumb.
- window.createBioSEMDrivePhotos({client}) -> status(), upload(attachment,File,onProgress), download(attachment,variant), remove(attachments). Client getSession() access token only in Authorization; never Google tokens. upload returns only after server completion checks.

## Tasks
- [x] Backend + mocked API security tests (api/drive.mjs, drive-server.mjs, drive-server.test.mjs).
- [x] Browser image resizing/chunk upload helper + tests (dist/drive-photos.js, drive-photos.test.mjs).
- [x] Attachment schema, main content integration, conditional privacy copy, regression tests. Live migration `biosem_drive_photo_storage` applied on 2026-10-06.
- [x] Local OAuth setup helper, deployment environment names, account verification logic, setup guide. Actual owner authorization remains pending.
- [x] Review and local unit/security/browser checks.
- [x] Owner authorization, Production-only sensitive environment variables, real private Drive upload/preview/delete verification (isolated membership mock; actual Google API).
- [x] Production deployment `dpl_GxMrSuzPmGz6Jv6nc1TDx9nJVj5k` READY, code commit `301fb40`. Public status/config and portfolio REST pass; original and anonymous writes denied. Runtime-log aggregation is unavailable (connector 403); direct HTTP checks passed.

## Review focus
- Pending/suspended cannot mutate public photos; anonymous sees opted-in photos only.
- No original file ID or OAuth/session secret in API output/errors/logs; encrypted upload tickets bound to user+attachment.
- Failed upload cleanup is retryable and does not orphan unknown original files.
- Vercel 4.5MB body cap: use <=1MiB chunks; generated viewing images <=1MiB.
- Auth/navigation races, legacy attachments and documents stay functional.

## Current prerequisites
Owner OAuth and Vercel configuration are complete. Confirm OAuth publishing status: a token issued in Testing can expire after seven days; reauthorize after switching to Production. Secrets are only in the central local secret file and Vercel Production variables.
