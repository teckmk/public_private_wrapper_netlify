# Netlify Free Deployment with Private Source Repository

## 1. Problem

The application source code must remain in a **private Git repository**, while the deployed application should use **Netlify's Free plan** for static hosting and CDN delivery.

The constraint is that the desired Netlify Free setup cannot directly connect the site's Git integration to the private source repository.

We therefore need to separate:

1. The repository Netlify is connected to.
2. The repository containing the actual application source.

The deployment system must allow Netlify to build the latest private source without exposing that source publicly or requiring the private repository to be directly connected to Netlify.

---

## 2. Goals

The solution must:

* Keep the actual application source in a private Git repository.
* Use a public Git repository as the Netlify deployment repository.
* Allow the public repository to contain only deployment/build infrastructure.
* Allow Netlify to retrieve the private source during the build.
* Authenticate access to the private repository securely.
* Build the private Next.js application during the Netlify build.
* Deploy the resulting static output through Netlify CDN.
* Avoid storing the private source in the public repository.
* Avoid Git submodules.
* Allow a new deployment to build the latest private repository commit.
* Allow deployments to be manually triggered from Netlify after private-source changes.
* Require no server-side runtime for the resulting application.

---

## 3. Non-Goals

This solution does not attempt to:

* Make Netlify directly connected to the private source repository.
* Mirror the private repository into the public repository.
* Expose private source code to users.
* Store application source code in Netlify's deployed site.
* Build a general-purpose CI/CD system.
* Use Git submodules.

---

# 4. Proposed Solution

Use two Git repositories.

### Public Deployment Repository

This repository is connected to Netlify.

It contains only the deployment/build wrapper:

```text
public-deployment-repo/
├── scripts/
│   └── build-private.js
├── netlify.toml
├── package.json
└── .gitignore
```

### Private Source Repository

This contains the actual application:

```text
private-source-repo/
├── app/
├── components/
├── public/
├── scripts/
├── package.json
├── package-lock.json
├── next.config.ts
└── ...
```

The private repository remains private and is never connected to Netlify's Git integration.

---

# 5. Deployment Architecture

```text
                    GitHub
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
   Public Repository       Private Repository
   deployment wrapper       actual application
          │                       │
          │                       │
          ▼                       │
       Netlify                   │
          │                       │
          │   HTTPS authenticated│
          └──────────────────────►│
                                  │
                                  ▼
                         Private source checkout
                                  │
                                  ▼
                             npm ci
                                  │
                                  ▼
                           npm run build
                                  │
                                  ▼
                              /out
                                  │
                                  ▼
                           Netlify CDN
                                  │
                                  ▼
                              Visitors
```

---

# 6. Netlify Build Process

When a deployment is triggered, Netlify performs the following steps:

### Step 1 — Checkout public repository

Netlify checks out the public deployment repository.

### Step 2 — Execute deployment script

```bash
node scripts/build-private.js
```

### Step 3 — Authenticate with GitHub

The script retrieves:

```text
SOURCE_REPO_URL
SOURCE_REPO_TOKEN
```

from Netlify environment variables.

### Step 4 — Clone private repository

The script performs a shallow clone:

```bash
git clone --depth 1 <private-repository> .private-source
```

The clone uses the read-only GitHub token.

### Step 5 — Install dependencies

```bash
npm ci
```

executed inside the private source directory.

### Step 6 — Build application

```bash
npm run build
```

executed inside the private source directory.

### Step 7 — Publish static output

The private Next.js application is configured for static export:

```ts
const nextConfig = {
  output: "export",
};
```

The build produces:

```text
.private-source/out/
```

Netlify publishes this directory.

---

# 7. Repository Credentials

The public repository must never contain the GitHub authentication token.

Netlify environment variables contain:

```text
SOURCE_REPO_URL
SOURCE_REPO_TOKEN
```

Example:

```text
SOURCE_REPO_URL=https://github.com/company/private-app.git

SOURCE_REPO_TOKEN=<GitHub fine-grained token>
```

The GitHub token must have:

```text
Repository access:
  Selected private repository only

Permissions:
  Contents: Read-only
```

No write permissions are required.

---

# 8. Public Repository Specification

### `netlify.toml`

```toml
[build]
command = "node scripts/build-private.js"
publish = ".private-source/out"
```

### `.gitignore`

```gitignore
.private-source/
node_modules/
.netlify/
```

The `.private-source` directory must never be committed.

---

# 9. Private Repository Specification

The private application is an ordinary Next.js project.

It must provide:

```json
{
  "scripts": {
    "build": "next build"
  }
}
```

and configure Next.js for static export:

```ts
const nextConfig = {
  output: "export",
};

export default nextConfig;
```

The repository should contain its lockfile so that the deployment can use:

```bash
npm ci
```

instead of `npm install`.

---

# 10. Deployment Workflow

Initial setup:

```text
1. Create private application repository
2. Create public deployment repository
3. Add deployment script to public repository
4. Connect public repository to Netlify
5. Configure Netlify environment variables
6. Configure GitHub read-only token
7. Trigger first deployment
```

Normal development:

```text
Developer
    │
    ▼
Push changes
    │
    ▼
Private repository
```

Then:

```text
Netlify
   │
   ▼
Trigger deploy
   │
   ▼
Checkout public deployment repo
   │
   ▼
Clone latest private source
   │
   ▼
npm ci
   │
   ▼
npm run build
   │
   ▼
Deploy /out
```

No change to the public repository is required when application source changes.

---

# 11. Why Not Git Submodules?

Git submodules are intentionally not used.

A submodule would make the public repository reference a specific commit of the private repository:

```text
public repo
    │
    └── private repo @ abc123
```

If the private repository advances to:

```text
def456
```

the public repository would still reference `abc123` until its submodule pointer is updated.

That conflicts with the desired deployment workflow:

```text
Private repo changes
        ↓
Trigger Netlify build
        ↓
Build latest private source
```

The build-time clone instead always retrieves the latest commit from the configured branch.

---

# 12. Security Requirements

### Required

* GitHub token must be stored only as a Netlify secret/environment variable.
* Token must have read-only access.
* Token should be scoped to the single private repository.
* Token must never be committed to Git.
* Private source must never be copied into the public repository.
* `.private-source/` must be ignored.
* The authenticated Git URL should not be logged.
* Deployment logs must not print the token.
* The deployed `out/` directory must contain only files intended for the public website.

### Recommended

Use a dedicated GitHub fine-grained token specifically for this deployment rather than a personal token with broad repository access.

---

# 13. Failure Conditions

The build must fail when:

* `SOURCE_REPO_URL` is missing.
* `SOURCE_REPO_TOKEN` is missing.
* GitHub authentication fails.
* The private repository cannot be cloned.
* `npm ci` fails.
* `npm run build` fails.
* The expected static output directory does not exist.

A failed build must not result in a partial deployment.

---

# 14. Result

The final system provides this separation:

```text
PUBLIC
─────────────────────────────
Deployment configuration
Netlify configuration
Build script
No application source


PRIVATE
─────────────────────────────
Actual application
Components
Pages
Templates
Business logic
Build scripts
Configuration


DEPLOYED
─────────────────────────────
Static HTML
CSS
JavaScript
Images
Other public assets
```

The private repository remains the **single source of truth for the application**.

The public repository exists solely to satisfy the Netlify deployment integration and provide the mechanism for retrieving and building the private application.

## 15. Core Principle

> **Netlify integrates with the public deployment repository, while the build process retrieves the private application source as a build-time dependency.**

This allows the deployment infrastructure and application source to remain independently managed while still producing a normal static Netlify deployment.
