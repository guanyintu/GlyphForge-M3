# GlyphForge M3 Production Bootstrap

Updated: 2026-11-06 (Asia/Shanghai)

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

## Still required before public launch

1. Create a GitHub repository for this source. The linked GitHub account is `guanyintu`; the connected repository list currently returns no accessible repositories, and no local Git remote exists. A public repository is required for the intended GitHub Pages deployment on the current Free setup. Do not push until the repo exists and the secret scan passes.
2. Confirm the final repository name/path. The current candidate is `GlyphForge-M3`, giving the expected Pages origin `https://guanyintu.github.io` and site URL `https://guanyintu.github.io/GlyphForge-M3/`.
3. Create a GitHub OAuth App. Its Authorization callback URL must be `https://gallindmwjiwsitczjzu.supabase.co/auth/v1/callback`. Put the OAuth Client ID and Secret only in the production Supabase Dashboard → Authentication → Providers → GitHub; never paste them into ChatGPT, source files, shell arguments, or Git.
4. Set the production Supabase Site URL to `https://guanyintu.github.io/GlyphForge-M3/` and add the exact matching redirect URL. If the repository name changes, update these values and rebuild with the correct `GLYPHFORGE_BASE`.
5. Verify real GitHub OAuth/PKCE, callback exchange, session refresh, logout, RLS and the server-side rejection of password login. Only after OAuth passes, disable Email/Password Provider in the production project. The test project remains paused and its Email Provider/data remain unchanged.
6. Enable GitHub Pages only after CI artifact checks and a final secret scan. The current workflow is still a verification-only artifact workflow; it does not deploy Pages.
7. Finish platform-level rate-limit/usage checks, retention/account deletion policy, and hosted concurrency decision. Public launch remains NO-GO until these gates are resolved.

No GitHub push, Pages deployment, OAuth secret configuration, or public launch has occurred in this bootstrap.
