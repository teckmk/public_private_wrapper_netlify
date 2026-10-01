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
2. **GitHub token**: create a fine-grained token:
   - Repository access: *Only select repositories* → the private repo
   - Permissions: *Contents: Read-only*
3. **Netlify**: connect *this* repo, then under *Site configuration → Environment variables* add:

   | Variable             | Value                                         | Notes                              |
   | -------------------- | --------------------------------------------- | ---------------------------------- |
   | `SOURCE_REPO_URL`    | `https://github.com/<owner>/<repo>.git`       | No credentials in the URL          |
   | `SOURCE_REPO_TOKEN`  | the fine-grained token                        | Mark as secret; scope: Builds      |
   | `SOURCE_REPO_BRANCH` | e.g. `main`                                   | Optional; defaults to repo default |
   | `NODE_VERSION`       | e.g. `20`                                     | Optional; match the private app    |

4. Trigger a deploy: *Deploys → Trigger deploy → Deploy site*.

After that, push to the private repo and trigger a deploy again. This repo doesn't need to change.
To deploy automatically, create a Netlify **build hook** and `POST` to it from a
GitHub Action in the private repo.

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
