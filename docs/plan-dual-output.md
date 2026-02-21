# Plan: Dual Output — Standalone CLI + npm Package (`vbapm`)

## Goal

The project currently builds a **standalone CLI** that ships with a vendored Node binary (in `vendor/`) and platform-specific shell wrappers (in `bin/`), so users don't need Node installed.

We want to **also** publish the same project as an **npm package** named `vbapm` that can be installed via `npm install -g vbapm` (requiring the user's own Node runtime). Both distribution channels share a single `package.json` and the same `lib/` output — no separate subdirectory needed.

This plan is inspired by commit `d5257712f1e55554b0fa7260d655e1e68b5b673a`, which converted the project *entirely* to an npm package. Here we adapt that approach to keep the standalone output while enabling npm publishing alongside it.

### Why a single `package.json` is enough

- The **standalone distribution** (GitHub releases) is created by `scripts/create-packages.js`, which zips up `lib/`, `bin/`, `vendor/`, `addins/build/`, and `run-scripts/`. It doesn't care about the `name` field in `package.json`.
- The **npm distribution** uses `npm publish`, where the `files` field controls what gets included. We simply exclude `bin/` and `vendor/` from the npm tarball.
- Both channels consume the exact same `lib/` build output.

---

## Summary of Changes

| # | Area | What to do |
|---|------|-----------|
| 1 | `package.json` | Rename to `vbapm`, add `types`/`exports`/`files`/`engines` fields, add shebang-bearing `bin` entries, update build scripts |
| 2 | `rollup.config.js` | Add shebang plugin so `lib/vba-blocks.js` gets `#!/usr/bin/env node` and is executable |
| 3 | `tsconfig.build.json` | Create for `.d.ts` generation |
| 4 | `src/installer.ts` | Make update-check work for both distribution channels (npm registry + GitHub releases) |
| 5 | `src/bin/vba-blocks.ts` | Context-aware update message (npm update vs website) |
| 6 | `src/env.ts` | No changes — `env.bin` stays as standalone detection mechanism |
| 7 | Build scripts | Keep `ensure-vendor` + `create-packages.js`; adjust `build`/`version` scripts |
| 8 | CI/CD | Add `npm publish` step to release workflow |

---

## Detailed Steps

### 1. `package.json` — rename & add npm fields

Rename the package and add fields needed for npm publishing. The standalone build pipeline is unaffected since it never reads the `name` field.

```jsonc
{
  "name": "vbapm",
  "version": "0.6.0",
  "description": "A package manager and build tool for VBA",
  "repository": "https://github.com/vbapm/core.git",
  "author": "Tim Hall <tim.hall.engr@gmail.com> (https://github.com/timhall)",
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  },
  // npm bin entries — these use #!/usr/bin/env node (added by shebang plugin)
  // The standalone build ignores these and uses its own bin/ wrappers + vendored node
  "bin": {
    "vba-blocks": "lib/vba-blocks.js",
    "vba": "lib/vba-blocks.js"
  },
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": {
      "require": "./lib/index.js",
      "types": "./lib/index.d.ts"
    }
  },
  // Only these files go into the npm tarball.
  // bin/ and vendor/ are excluded — they're only for the standalone distribution.
  "files": [
    "lib/",
    "addins/build/",
    "run-scripts/",
    "LICENSE",
    "README.md"
  ],
  "scripts": {
    "format": "prettier --write \"**/*.{ts,js}\"",
    "test": "jest --runInBand",
    "typecheck": "tsc",
    "test:e2e": "jest --config e2e.config.js --runInBand",
    // Core build: rollup + type declarations (used by both channels)
    "build": "rimraf lib && rollup -c && tsc -p tsconfig.build.json",
    // Standalone build: also fetch vendored node
    "build:standalone": "npm run build && node scripts/ensure-vendor",
    "build:dev": "cross-env NODE_ENV=development rollup -c",
    "build:addins": "cd addins && node --no-warnings ../scripts/build-addins",
    "build:bootstrap": "cd scripts/bootstrap && node --no-warnings ../../lib/vba-blocks build",
    // prepublishOnly ensures lib/ is fresh before npm publish
    "prepublishOnly": "npm run build",
    // Standalone release: build everything + create platform archives
    "version": "npm run build:standalone && npm run build:addins && node scripts/create-packages",
    "postversion": "git push && git push --tags",
    "clean": "rimraf lib && rimraf dist && rimraf addins/build"
  },
  // ... dependencies unchanged ...
}
```

Key points:
- `"build"` now does rollup + `.d.ts` generation (no `ensure-vendor`).
- `"build:standalone"` does `build` + `ensure-vendor` for the standalone pipeline.
- `"prepublishOnly"` runs the core build before `npm publish`.
- `"version"` uses `build:standalone` for creating GitHub release archives.
- `"files"` ensures `npm publish` excludes `bin/`, `vendor/`, `scripts/`, `src/`, etc.

### 2. `rollup.config.js` — add shebang plugin

Add the shebang plugin so that `lib/vba-blocks.js` starts with `#!/usr/bin/env node` and is `chmod +x`. This is needed for the npm `bin` entries to work. The standalone build ignores this shebang because it invokes `lib/vba-blocks.js` explicitly via the vendored node binary.

```js
// Add this function to rollup.config.js
function shebang() {
  return {
    name: "shebang",
    renderChunk(code, chunk) {
      if (chunk.facadeModuleId && chunk.facadeModuleId.includes("vba-blocks.ts")) {
        return "#!/usr/bin/env node\n" + code;
      }
      return null;
    },
    writeBundle(options, bundle) {
      const fs = require("fs");
      const path = require("path");
      for (const [fileName] of Object.entries(bundle)) {
        if (fileName === "vba-blocks.js") {
          const filePath = path.resolve(options.dir, fileName);
          try {
            fs.chmodSync(filePath, 0o755);
          } catch (e) {
            // Ignore chmod errors on Windows
          }
        }
      }
    }
  };
}

// Then add shebang() to the plugins array:
plugins: [
  // ... existing plugins ...
  workerThreads(),
  shebang()     // <-- add here
]
```

> **Note:** The shebang is harmless for the standalone build — the `bin/vba` wrappers run `vendor/node lib/vba-blocks.js`, and Node ignores leading shebangs.

### 3. `tsconfig.build.json` — type declarations

Create at the project root (not in a subdirectory):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationOnly": true,
    "declarationDir": "lib",
    "emitDeclarationOnly": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "tests/**/*.ts", "src/**/__mocks__/*", "src/**/__helpers__/*"]
}
```

This emits `.d.ts` files alongside the rollup output in `lib/`, so npm consumers get type information.

### 4. `src/installer.ts` — dual update checking

The standalone CLI checks for updates via GitHub releases. When installed via npm, it should check the npm registry instead. Use `env.bin` existence as the detection mechanism:

```typescript
import fetch from "node-fetch";
import { existsSync } from "fs";

const IS_STANDALONE = existsSync(env.bin);
const NPM_PACKAGE_NAME = "vbapm";

export async function checkForUpdate(): Promise<boolean> {
  // ... existing rate-limiting logic unchanged ...

  try {
    let latestVersion: string;

    if (IS_STANDALONE) {
      // Standalone: check GitHub releases
      const { tag_name } = await getLatestRelease({
        owner: "vbapm",
        repo: "core"
      });
      latestVersion = tag_name;
    } else {
      // npm install: check npm registry
      const response = await fetch(
        `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`
      );
      const data: any = await response.json();
      latestVersion = data.version;
    }

    cache.latest_version = latestVersion;
    return semverGreaterThan(latestVersion, currentVersion);
  } catch (error) {
    debug("Error checking for update");
    debug(error);
    return false;
  }
}
```

### 5. `src/bin/vba-blocks.ts` — context-aware update message

```typescript
const updateAvailableMessage = () => {
  const isStandalone = require("fs").existsSync(env.bin);
  if (isStandalone) {
    return dedent`
      \n${greenBright("New Update!")} ${updateVersion()!}

      A new version of vba-blocks is available.
      Visit https://vba-blocks.com/update for more information.`;
  }
  return dedent`
    \n${greenBright("New Update!")} ${updateVersion()!}

    A new version of vba-blocks is available.
    Run "npm update -g vbapm" to update.`;
};
```

### 6. `src/env.ts` — no changes

Keep `env.bin` as-is (`join(root, "bin")`). When installed via npm, the `bin/` directory won't exist, so `existsSync(env.bin)` returns `false` — this is the detection mechanism.

### 7. Build scripts — minimal changes

| Script | Status |
|--------|--------|
| `scripts/ensure-vendor.js` | **Keep** — only used for standalone builds |
| `scripts/create-packages.js` | **Keep** — creates `.zip`/`.tar.gz` for GitHub releases |
| `scripts/release.js` | **Modify** — optionally add `npm publish` step |

No new helper scripts needed since there's no separate package directory to populate.

### 8. CI/CD — add npm publish

Add an npm publish step to the release workflow:

```yaml
# After the existing standalone release steps
- name: Publish to npm
  run: npm publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Since `files` in `package.json` controls the tarball contents, this just works — `npm publish` from the root includes only `lib/`, `addins/build/`, `run-scripts/`, `LICENSE`, `README.md`.

---

## File Change Summary

| File | Action |
|------|--------|
| `package.json` | **Modify** — rename to `vbapm`, add `types`/`exports`/`files`/`engines`, restructure scripts |
| `rollup.config.js` | **Modify** — add shebang plugin |
| `tsconfig.build.json` | **Create** — `.d.ts` generation config |
| `src/installer.ts` | **Modify** — dual update-check logic |
| `src/bin/vba-blocks.ts` | **Modify** — context-aware update message |

Only 3 files modified and 1 file created. No new directories or package structures needed.

---

## How the two distribution channels work

```
                    ┌─── npm publish ───────────────────────────────────┐
                    │  Tarball includes (via "files" field):            │
                    │    lib/          (bundled JS + .d.ts + sourcemaps)│
                    │    addins/build/ (Excel add-ins)                  │
                    │    run-scripts/  (AppleScript / PowerShell)       │
                    │    LICENSE, README.md                             │
 ┌──────────┐       │  npm creates bin symlinks from "bin" field        │
 │ src/**   │       │  → lib/vba-blocks.js (has #!/usr/bin/env node)   │
 │          ├─build─┤                                                  │
 │          │       ├─── create-packages ──────────────────────────────┐│
 └──────────┘       │  Zip/tar.gz includes:                           ││
                    │    lib/          (same bundled JS)               ││
                    │    bin/          (shell/cmd/ps1 wrappers)        ││
                    │    vendor/       (vendored Node binary)          ││
                    │    addins/build/ (Excel add-ins)                 ││
                    │    run-scripts/  (AppleScript / PowerShell)      ││
                    └─────────────────────────────────────────────────┘│
                                                                       │
                    npm users: `npm install -g vbapm`                   │
                    Standalone users: download zip from GitHub releases │
```

---

## Open Questions

1. **Package name:** `vbapm` (unscoped) vs `@vbapm/core` (scoped)? Scoped requires npm org setup but avoids name squatting risk. `vbapm` is simpler for `npm install -g vbapm`.
2. **Version sync:** The same `package.json` version is used for both channels, so they're always in sync — no extra tooling needed.
