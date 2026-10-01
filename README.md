# Public deployment wrapper (Netlify)

This repo contains **no application source**. It only tells Netlify how to fetch
and build a private Next.js repository at build time, then publishes the static export.

```
Netlify → checkout this repo → node scripts/build-private.js
        → git clone --depth 1 <private repo> .private-source   (token via HTTP header)
        → npm ci → npm run build → publish .private-source/out
```

## Setup

1. **Private repo**: Next.js app with `output: "export"` in `next.config.*`,
   a `build` script (`next build`), and a committed `package-lock.json`.
   See [Private app requirements](#private-app-requirements-static-export).
2. **GitHub token**: create a fine-grained token (see [Creating the GitHub token](#creating-the-github-token)).
3. **Netlify**: connect *this* repo, then under *Site configuration → Environment variables* add:

   | Variable             | Value                                         | Notes                              |
   | -------------------- | --------------------------------------------- | ---------------------------------- |
   | `SOURCE_REPO_URL`    | `https://github.com/<owner>/<repo>.git`       | No credentials in the URL          |
   | `SOURCE_REPO_TOKEN`  | the fine-grained token                        | Mark as secret; scope: Builds      |
   | `SOURCE_REPO_BRANCH` | e.g. `main`                                   | Optional; defaults to repo default |
   | `NEXT_PUBLIC_SITE_URL` | e.g. `https://example.com`                  | Optional; defaults to Netlify's `URL` |
   | `NODE_VERSION`       | e.g. `20`                                     | Optional; match the private app    |

4. Trigger a deploy: *Deploys → Trigger deploy → Deploy site*.

After that, push to the private repo and trigger a deploy again. This repo doesn't need to change.
To deploy automatically, create a Netlify **build hook** and `POST` to it from a
GitHub Action in the private repo.

## Private app requirements (static export)

- Set `output: "export"` in `next.config.*`.
- Every route must be static (no `ƒ (Dynamic)` in the `next build` output):
  - Routes with known params: export `generateStaticParams()`.
  - Routes with IDs known only in the browser: use a query param (`/page?id=…`) and read it with `useSearchParams()` inside `<Suspense>`.
- Add `export const dynamic = "force-static";` to `robots.ts` and `sitemap.ts`.
- Don't use API routes, server actions, middleware, `cookies()` or `headers()`.
- Serve `out/` locally (e.g. `npx serve out`); `next start` doesn't work with a static export.
- Put Netlify `_redirects` / `_headers` files in `public/`.
- Check locally: `npm run build` must create `out/`.

## Creating the GitHub token

1. GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*.
2. **Resource owner**: the account or organisation that **owns the private repo**.
   If the repo belongs to an organisation (e.g. `lumicrafte`), pick that organisation, not your
   personal account. A token owned by your personal account can't read an organisation's private repos.
3. **Repository access**: *Only select repositories* → the private repo.
4. **Permissions → Repository permissions → Contents**: *Read-only*. Nothing else is needed.
   (*Metadata: Read-only* is added automatically.)
5. If the organisation requires approval for fine-grained tokens, an org owner must approve it
   under *Organisation settings → Personal access tokens → Pending requests*.
6. Copy the token into Netlify as `SOURCE_REPO_TOKEN`, and into a local `.env` if you test locally.

### Testing locally

```sh
node --env-file=.env scripts/build-private.js
```

### Troubleshooting clone errors

| Error                                                         | Meaning                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `401` / `Invalid username or token`                           | Token is wrong, expired, or revoked.                                                          |
| `403` / `Write access to repository not granted`              | Token is valid but can't access this repo: wrong resource owner, repo not selected, or org approval pending. GitHub's wording is misleading; read access is all that's needed. |
| `404` / `Repository not found`                                | Same causes as 403, or a typo in `SOURCE_REPO_URL`.                                           |

## Security behaviour

- The token is passed to `git` as an `Authorization` header via `GIT_CONFIG_*`
  environment variables. It never appears in the URL, the process argv, `.git/config`, or the logs.
  Git output is redacted as a second safeguard.
- The token is removed from the environment before `npm ci` / `npm run build`,
  so private-app scripts can't read it.
- The build fails (and the previous deploy stays live) if env vars are missing,
  the clone or authentication fails, there's no lockfile, `npm ci` or the build fails, or
  `.private-source/out` is missing or empty.
- `.private-source/` is git-ignored and must never be committed.
- Only `out/` is published, so check that the private app doesn't put sensitive files in `public/`.
