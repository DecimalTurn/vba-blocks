# Registry URL Migration Plan: vba-blocks → vbapm

## Overview

The tool has been renamed from `vba-blocks` to `vbapm`, but the registry infrastructure
still uses `vba-blocks` domain names and GitHub organization. This document outlines the
steps needed to migrate the registry to the `vbapm` namespace.

## Current State

| Component | Current Value |
|---|---|
| npm package name | `vbapm` |
| CLI command | `vbapm` / `vba` |
| Config directory | `~/.vbapm` (via `env-paths`) |
| Registry name (config key) | `"vba-blocks"` |
| Registry index (Git repo) | `https://github.com/vba-blocks/registry` |
| Package download URL | `https://packages.vba-blocks.com/{name}-v{version}.block` |
| Lock file source format | `registry+vba-blocks#sha256-{hash}` |

## Target State

| Component | Target Value |
|---|---|
| Registry name (config key) | `"vbapm"` |
| Registry index (Git repo) | `https://github.com/vbapm/registry` |
| Package download URL | `https://packages.vbapm.com/{name}-v{version}.block` |
| Lock file source format | `registry+vbapm#sha256-{hash}` |

---

## Phase 1: Infrastructure Setup

### 1.1 DNS & Hosting for packages.vbapm.com

- [ ] Choose hosting provider (e.g., AWS S3 + CloudFront, Cloudflare R2, or similar)
- [ ] Create the `packages.vbapm.com` DNS record (CNAME or A record)
- [ ] Provision TLS certificate (Let's Encrypt or AWS ACM)
- [ ] Configure CORS headers for `.block` file downloads
- [ ] **Mirror all existing `.block` files** from `packages.vba-blocks.com` to the new host
- [ ] Verify downloads work: `curl -I https://packages.vbapm.com/dictionary-v1.4.1.block`

### 1.2 Registry Index Repository

- [ ] Create `https://github.com/vbapm/registry` repository
- [ ] Copy contents from `https://github.com/vba-blocks/registry`
  (or fork + transfer if appropriate)
- [ ] Ensure the NDJSON index files are identical
- [ ] Set up any CI/CD that the old registry repo had (publish scripts, validation)

### 1.3 Registry Website (Optional)

- [ ] Plan a web frontend at `https://vbapm.com` or `https://registry.vbapm.com`
- [ ] Features: package search, version listing, README display, download stats
- [ ] Consider using a static site generator that reads the NDJSON index

---

## Phase 2: Dual-Registry Support (Backward Compatibility)

Before switching the default, ensure existing lock files and projects still work.

### 2.1 Code Changes — Support Multiple Registries

**File: `src/config.ts`**

Add a second registry entry so both `"vba-blocks"` and `"vbapm"` are recognized:

```typescript
registries: {
  "vbapm": {
    index: "https://github.com/vbapm/registry",
    packages: "https://packages.vbapm.com"
  },
  "vba-blocks": {
    index: "https://github.com/vba-blocks/registry",
    packages: "https://packages.vba-blocks.com"
  }
}
```

### 2.2 Lock File Compatibility

- Lock files with `registry+vba-blocks#...` must continue to resolve during the
  transition period
- Lock files generated after migration will use `registry+vbapm#...`
- Consider adding a migration command: `vbapm migrate` that rewrites lock file sources

### 2.3 Default Registry Change

**File: `src/manifest/dependency.ts`**

Change the default registry from `"vba-blocks"` to `"vbapm"`:

```typescript
// Before
registry = "vba-blocks"
// After
registry = "vbapm"
```

---

## Phase 3: Cutover

### 3.1 Publish New Version

- [ ] Release a new version of `vbapm` with both registries configured
- [ ] New projects will use `registry = "vbapm"` by default
- [ ] Existing projects with `registry+vba-blocks` in lock files still work

### 3.2 Redirect Old URLs (Optional)

- [ ] Configure `packages.vba-blocks.com` to 301-redirect to `packages.vbapm.com`
- [ ] Archive the old `vba-blocks/registry` repo with a pointer to `vbapm/registry`

### 3.3 Update Published Packages

- [ ] Re-publish any addins (vbapm.xlam) with updated registry references
- [ ] Update any documentation referencing `vba-blocks` URLs

---

## Phase 4: Deprecation of vba-blocks Registry

After sufficient time (suggest 6+ months):

- [ ] Emit a deprecation warning when `registry+vba-blocks` is encountered
- [ ] Eventually remove the `"vba-blocks"` registry entry from config
- [ ] Shut down `packages.vba-blocks.com` (or keep redirects permanently)

---

## Files to Update at Migration Time

| File | Change |
|---|---|
| `src/config.ts` | Add `"vbapm"` registry, keep `"vba-blocks"` for compat |
| `src/manifest/dependency.ts` | Default registry → `"vbapm"` |
| `scripts/lib/git.js` | Registry remote → `vbapm/registry.git` |
| `scripts/publish.js` | Package URL → `packages.vbapm.com` |
| `addins/vba_package.lock` | Source strings → `registry+vbapm#...` |
| `addins/vba-installer/vba_package.lock` | Source strings → `registry+vbapm#...` |
| `scripts/bootstrap/vba_package.lock` | Source strings → `registry+vbapm#...` |
| `src/sources/__tests__/sources.test.ts` | Mock registry key → `"vbapm"` |
| `tests/__fixtures__/.vbapm/` | Subdirs `registry/vbapm/`, `sources/vbapm/`, `packages/vbapm/` |
| Snapshot files | Updated paths and registry names |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| DNS propagation delay for `packages.vbapm.com` | Test from multiple regions before cutover |
| Existing lock files break | Dual-registry support in Phase 2 |
| Old `vba-blocks` packages no longer downloadable | Mirror all `.block` files first; keep old domain alive with redirects |
| Community confusion about two registry names | Clear release notes, deprecation warnings, migration command |
| Package hash mismatches | `.block` files are immutable; byte-for-byte copies ensure same SHA-256 |

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2025-01-XX | Keep `vba-blocks` registry URLs for now | `packages.vbapm.com` doesn't exist yet; CI fails with ENOTFOUND |
| TBD | Set up `packages.vbapm.com` | Required before any URL migration |
| TBD | Add dual-registry support | Backward compatibility for existing projects |
| TBD | Switch default to `"vbapm"` | Clean break for new projects |
