# GlyphForge M3 Production Bootstrap

Updated: 2026-11-06 (Asia/Shanghai) — GitHub Pages deployment completed

## Supabase production project

- Organization: existing Free organization `luovkfunhcuqfeplnvaj`.
- Project: `glyphforge-m3-production`.
- Project ref: `gallindmwjiwsitczjzu`.
- Region: Singapore (`ap-southeast-1`).
- API URL: `https://gallindmwjiwsitczjzu.supabase.co`.
- Created successfully at 2026-11-06T11:56:33Z; status `ACTIVE_HEALTHY`.
- Project creation quote was confirmed at **$0/month**. No plan upgrade.
- `glyphforge-m3-test` (`rsntccggnvmuazvpxstf`) was paused with its database/auth data retained. It must be restored before any further test-project verification. The unrelated existing Supabase project was not modified.

## Database and Edge deployment

- Applied the two reviewed repository migrations in order:
  - `20261106132755 community_platform`
  - `20261106132801 community_storage_budget`
- Six public community tables exist and all six have RLS enabled.
- No anon/authenticated INSERT, UPDATE, or DELETE grants on the six community tables. Anon SELECT is limited to the three public-read tables; authenticated SELECT includes own likes/reports under RLS.
- Private `community_private` schema holds write budgets and moderator/control data; no client write grants.
- Deployed `community` Edge Function **v2 ACTIVE**, `verify_jwt=true`, using the reviewed local `index.ts` and generated `validator.js`.
- CORS permits localhost development origins and `https://guanyintu.github.io`. A real OPTIONS preflight from that GitHub Pages origin returned HTTP 204 with the exact allowed origin and POST/OPTIONS methods.
- The community write switch is enabled; the new production tables are empty. No synthetic business records were created in production.

## Local production build preparation

- Local-only `.env.production.local` contains the production project URL and public publishable key. The file is ignored by Git; no service-role key is present.
- A repository-subpath production build completed with `GLYPHFORGE_BASE=/GlyphForge-M3/`.
- Build output assertions confirmed the bundle references the new production project and publishable key, does not contain the service-role environment name, and uses the repository subpath.
- Existing Vite warnings remain: mixed static/dynamic imports and large chunks. They are not build failures.
- The current Edge function source includes the exact Pages origin `https://guanyintu.github.io`; if a different host is chosen, update CORS and redeploy.

## GitHub repository and Pages deployment — completed

- Public repository: https://github.com/guanyintu/GlyphForge-M3.
- Default branch: main; latest deployment workflow commit: 82b390a.
- GitHub Pages uses build_type=workflow; public site: https://guanyintu.github.io/GlyphForge-M3/.
- Successful workflow run: https://github.com/guanyintu/GlyphForge-M3/actions/runs/42243418707.
- CI passed: 422/422 Vitest, 38/38 community acceptance guard checks, 6/6 M3 Playwright browser checks (1280px and 375px, provider-disabled and OAuth-return error handling), production build, final asset/history scan, artifact upload, and deploy job.
- Live smoke check: site HTML HTTP 200; all 4 referenced JavaScript/CSS assets HTTP 200.
- Repository variables contain only the Supabase project URL and public publishable key. No service-role key, OAuth client secret, or local credential file is in the repository.
- The original verification-only pages-preview.yml remains separate; deploy-pages.yml is the production deployment workflow.

## Remaining before the cloud community can accept users

1. Create a GitHub OAuth App. Homepage URL: https://guanyintu.github.io/GlyphForge-M3/. Authorization callback URL: https://gallindmwjiwsitczjzu.supabase.co/auth/v1/callback.
2. In the production Supabase Dashboard → Authentication → Providers → GitHub, enable GitHub and enter the OAuth Client ID and Client Secret. Keep the secret only in Supabase Dashboard; never send it in ChatGPT, commit it, or put it in a public repository variable.
3. In production Supabase Authentication → URL Configuration, set Site URL to https://guanyintu.github.io/GlyphForge-M3/ and add that exact URL to Redirect URLs.
4. Verify a real GitHub OAuth/PKCE flow, callback exchange, session refresh, logout, RLS, and the server-side rejection of password login. A read-only check of production Auth settings currently returns github=false, email=true; cloud sign-in is therefore **not yet ready**.
5. Only after real GitHub OAuth passes, disable Email/Password Provider in the production project. The paused test project remains unchanged.
6. Finish production platform rate-limit/usage checks, hosted concurrency decision, retention/account-deletion policy, and final cost review.

**Current status:** the public static site is deployed and loads successfully. Full cloud-community launch remains partial/blocked until GitHub OAuth is configured and verified, then platform-level release gates are closed.
