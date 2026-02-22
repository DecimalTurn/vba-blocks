# Plan: Dual Output — Standalone CLI + npm Package (`vbapm`)

## Goal

The project currently builds a **standalone CLI** that ships with a vendored Node binary (in `vendor/`) and platform-specific shell wrappers (in `bin/`), so users don't need Node installed.

We want to **also** publish the same project as an **npm package** named `vbapm` that can be installed via `npm install -g vbapm` (requiring the user's own Node runtime). Both distribution channels share a single `package.json` and the same `lib/` output — no separate subdirectory needed.

### Why a single `package.json` is enough

- The **standalone distribution** (GitHub releases) is created by `scripts/create-packages.js`, which zips up `lib/`, `bin/`, `vendor/`, `addins/build/`, and `run-scripts/`. It doesn't care about the `name` field in `package.json`.
- The **npm distribution** uses `npm publish`, where the `files` field controls what gets included. We simply exclude `bin/` and `vendor/` from the npm tarball.
- Both channels consume the exact same `lib/` build output.

---

## Summary of Changes

| # | Area | What to do |
|---|------|-----------|
| 1 | `package.json` | Add `types`/`exports`/`files` fields, add npm `bin` entries, restructure build scripts |
| 2 | `rollup.config.js` | Add shebang plugin so `lib/vbapm.js` gets `#!/usr/bin/env node` and is executable |
| 3 | `tsconfig.build.json` | Create for `.d.ts` generation |
| 4 | `src/installer.ts` | Make update-check work for both distribution channels (npm registry + GitHub releases) |
| 5 | `src/bin/vbapm.ts` | Context-aware update message (npm update vs website) |
| 6 | `src/env.ts` | No changes — `env.bin` stays as standalone detection mechanism |
| 7 | Build scripts | Keep `ensure-vendor` + `create-packages.js`; adjust `build`/`version` scripts |
| 8 | CI/CD | Add npm package e2e workflow; add `npm publish` step to release workflow |

---

## Detailed Steps

### 1. `package.json` — add npm fields

Most fields are already correct since the rename to `vbapm`. Add fields needed for npm publishing. The standalone build pipeline is unaffected since it never reads the `name` field.

**Current state** (already on main2):
```jsonc
{
  "name": "vbapm",         // ✅ already correct
  "version": "0.6.5",     // ✅ already correct
  "bin": "lib/vbapm.js",  // ⚠️ needs to become an object with aliases
  "main": "lib/index.js", // ✅ already correct
  "engines": { "node": "^22.0.0" } // ⚠️ should be relaxed for npm users
}
```

**Target state** — changes needed:
```jsonc
{
  "name": "vbapm",
  "version": "0.6.5",
  "engines": {
    "node": ">=18.0.0"           // Loosen to support more npm users
  },
  // npm bin entries — use #!/usr/bin/env node (added by shebang plugin)
  // The standalone build ignores these and uses its own bin/ wrappers + vendored node
  "bin": {
    "vbapm": "lib/vbapm.js",
    "vba": "lib/vbapm.js"
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
    // ... existing scripts stay ...
    // Core build: rollup + type declarations (used by both channels)
    "build": "rimraf lib && rollup -c && tsc -p tsconfig.build.json",
    // Standalone build: also fetch vendored node
    "build:standalone": "npm run build && node scripts/ensure-vendor",
    // prepublishOnly ensures lib/ is fresh before npm publish
    "prepublishOnly": "npm run build",
    // Standalone release: build everything + create platform archives
    "version": "npm run build:standalone && npm run build:addins && node scripts/create-packages"
  }
}
```

Key points:
- `"bin"` becomes an object with both `vbapm` and `vba` aliases pointing to `lib/vbapm.js`.
- `"build"` now does rollup + `.d.ts` generation (no `ensure-vendor`).
- `"build:standalone"` does `build` + `ensure-vendor` for the standalone pipeline.
- `"prepublishOnly"` runs the core build before `npm publish`.
- `"version"` uses `build:standalone` for creating GitHub release archives.
- `"files"` ensures `npm publish` excludes `bin/`, `vendor/`, `scripts/`, `src/`, etc.
- `"types"` and `"exports"` enable TypeScript consumers to import from the npm package.

### 2. `rollup.config.js` — add shebang plugin

Add the shebang plugin so that `lib/vbapm.js` starts with `#!/usr/bin/env node` and is `chmod +x`. This is needed for the npm `bin` entries to work. The standalone build ignores this shebang because it invokes `lib/vbapm.js` explicitly via the vendored node binary.

```js
// Add this function to rollup.config.js
function shebang() {
  return {
    name: "shebang",
    renderChunk(code, chunk) {
      if (chunk.facadeModuleId && chunk.facadeModuleId.includes("vbapm.ts")) {
        return { code: "#!/usr/bin/env node\n" + code, map: null };
      }
      return null;
    },
    writeBundle(options, bundle) {
      const fs = require("fs");
      const path = require("path");
      for (const [fileName] of Object.entries(bundle)) {
        if (fileName === "vbapm.js") {
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

> **Note:** The shebang is harmless for the standalone build — the `bin/vbapm` wrappers run `vendor/node lib/vbapm.js`, and Node ignores leading shebangs.

### 3. `tsconfig.build.json` — type declarations

Create at the project root (not in a subdirectory):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationDir": "lib",
    "emitDeclarationOnly": true,
    "useUnknownInCatchVariables": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "tests/**/*.ts", "src/**/__mocks__/*", "src/**/__helpers__/*"]
}
```

This emits `.d.ts` files alongside the rollup output in `lib/`, so npm consumers get type information.

### 4. `src/installer.ts` — dual update checking

The standalone CLI checks for updates via GitHub releases. When installed via npm, it should check the npm registry instead. Use `env.bin` existence as the detection mechanism:

```typescript
import { existsSync } from "fs";
import fetch from "node-fetch";

const IS_STANDALONE = existsSync(env.bin);
const NPM_PACKAGE_NAME = "vbapm";

export async function checkForUpdate(): Promise<boolean> {
  // ... existing rate-limiting logic unchanged ...

  try {
    let latestVersion: string;

    if (IS_STANDALONE) {
      // Standalone: check GitHub releases (existing logic)
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

### 5. `src/bin/vbapm.ts` — context-aware update message

```typescript
const updateAvailableMessage = () => {
  const isStandalone = require("fs").existsSync(env.bin);
  if (isStandalone) {
    return dedent`
      \n${greenBright("New Update!")} ${updateVersion()!}

      A new version of vbapm is available.
      Visit https://vba-blocks.com/update for more information.`;
  }
  return dedent`
    \n${greenBright("New Update!")} ${updateVersion()!}

    A new version of vbapm is available.
    Run "npm update -g vbapm" to update.`;
};
```

### 6. `src/env.ts` — no changes

Keep `env.bin` as-is (`join(root, "bin")`). When installed via npm, the `bin/` directory won't exist inside `node_modules/vbapm/`, so `existsSync(env.bin)` returns `false` — this is the detection mechanism.

### 7. Build scripts — minimal changes

| Script | Status |
|--------|--------|
| `scripts/ensure-vendor.js` | **Keep** — only used for standalone builds via `build:standalone` |
| `scripts/create-packages.js` | **Keep** — creates `.zip`/`.tar.gz` for GitHub releases |
| `scripts/release.js` | **Modify** — optionally add `npm publish` step |

No new helper scripts needed since there's no separate package directory to populate.

### 8. CI/CD

#### 8a. Add npm package E2E workflow

Create `.github/workflows/windows-package-e2e-test.yml` that:
1. Checks out the repo
2. Installs dependencies and builds (`npm install && npm run build && npm run build:addins`)
3. Installs globally from local build (`npm install -g .`)
4. Configures VBA runtime (setup-vba, VBOM access, add-in shortcuts)
5. Verifies `vba --version` works
6. Runs e2e tests

This proves the npm package distribution works end-to-end with Excel.

#### 8b. Test infrastructure changes

The e2e tests currently import from relative paths. For the npm package e2e workflow, they need to be able to resolve `vbapm` as a module. Changes needed:

- **`e2e.config.js`**: Add `moduleNameMapper` to map `vbapm` → `<rootDir>/src/index.ts`, plus `ts-jest` config pointing at `tests/tsconfig.json`.
- **`tests/tsconfig.json`**: Add `baseUrl` + `paths` for `vbapm` module resolution. Set `module: "commonjs"` for Jest compatibility.

#### 8c. Release workflow

Add an npm publish step:

```yaml
- name: Publish to npm
  run: npm publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Since `files` in `package.json` controls the tarball contents, this just works.

---

## How the two distribution channels work

```
                    ┌─── npm publish ─────────────────────────────────┐
                    │  Tarball includes (via "files" field):          │
                    │    lib/          (bundled JS + .d.ts + maps)    │
                    │    addins/build/ (Excel add-ins)                │
                    │    run-scripts/  (AppleScript / PowerShell)     │
                    │    LICENSE, README.md                           │
 ┌──────────┐       │  npm creates bin symlinks from "bin" field      │
 │ src/**   │       │  → lib/vbapm.js (has #!/usr/bin/env node)      │
 │          ├─build─┤                                                │
 │          │       ├─── create-packages ────────────────────────────┐│
 └──────────┘       │  Zip/tar.gz includes:                         ││
                    │    lib/          (same bundled JS)             ││
                    │    bin/          (shell/cmd/ps1 wrappers)      ││
                    │    vendor/       (vendored Node binary)        ││
                    │    addins/build/ (Excel add-ins)               ││
                    │    run-scripts/  (AppleScript / PowerShell)    ││
                    └───────────────────────────────────────────────┘│
                                                                     │
                    npm users: `npm install -g vbapm`                │
                    Standalone users: download zip from GitHub       │
                    └────────────────────────────────────────────────┘
```

---

## Standalone detection mechanism

When installed via npm, the package layout is:
```
node_modules/vbapm/
  lib/vbapm.js      ← entry point
  addins/build/     ← exists
  run-scripts/      ← exists
  # No bin/ directory — that's only in the standalone zip
```

`env.bin` resolves to `join(__dirname, "../bin")` which would be `node_modules/vbapm/bin/` — this path doesn't exist for npm installs. So `existsSync(env.bin)` is `false` for npm, `true` for standalone. This is used to select the correct update-check strategy and update message.

---

## File Change Summary

| File | Action |
|------|--------|
| `package.json` | **Modify** — add `types`/`exports`/`files`/`bin` object, restructure scripts |
| `rollup.config.js` | **Modify** — add shebang plugin |
| `tsconfig.build.json` | **Create** — `.d.ts` generation config |
| `src/installer.ts` | **Modify** — dual update-check logic |
| `src/bin/vbapm.ts` | **Modify** — context-aware update message |
| `e2e.config.js` | **Modify** — module resolution for `vbapm` |
| `tests/tsconfig.json` | **Modify** — paths + commonjs for Jest |
| `.github/workflows/windows-package-e2e-test.yml` | **Create** — npm package e2e test |

Only 5 files modified and 2 files created. No new directories or package structures needed.

---

## Implementation Order

1. **`tsconfig.build.json`** — create the declaration config (no dependencies)
2. **`rollup.config.js`** — add the shebang plugin (no dependencies)
3. **`package.json`** — restructure scripts and add npm fields (depends on 1, 2)
4. **`src/installer.ts`** — dual update-check (independent)
5. **`src/bin/vbapm.ts`** — context-aware update message (independent)
6. **`e2e.config.js` + `tests/tsconfig.json`** — test infra (independent)
7. **`.github/workflows/windows-package-e2e-test.yml`** — CI workflow (depends on 3, 6)
8. **Verify**: `npm run dev` passes, `npm pack --dry-run` shows correct files

## Open Questions

- Should `engines.node` be `>=18.0.0` or stay at `^22.0.0`? (The standalone build vendors Node 22, but npm users might have an older Node.)
- Should the types entry be `"lib/index.d.ts"` (assuming declaration emits match rollup output structure)?
- Do we want to add `"vba-blocks"` as an additional `bin` alias in the npm package for backward compatibility?
