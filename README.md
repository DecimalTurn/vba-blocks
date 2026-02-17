# vbapm

A package manager and build tool for VBA.

## Installation

Requires [Node.js](https://nodejs.org/) v18 or later.

```txt
npm install -g vbapm
```

**Mac:** For more recent versions of Office for Mac, you will need to trust access to the VBA project object model for vbapm to work correctly:

<details>
  <summary>Trust access to the VBA project object model</summary>
  <ol>
    <li>Open Excel</li>
    <li>Click "Excel" in the menu bar</li>
    <li>Select "Preferences" in the menu</li>
    <li>Click "Security" in the Preferences dialog</li>
    <li>Check "Trust access to the VBA project object model" in the Security dialog</li>
 </ol>
</details>

:rocket: You're ready to go! Open a new command-line session (cmd / terminal) and try `vba --help`

### Programmatic Usage

You can also use `vbapm` as a library (e.g. from a VS Code extension):

```js
const { buildProject, loadProject, env } = require("vbapm");

// Override working directory
env.cwd = "/path/to/project";

const project = await loadProject();
await buildProject(project);
```

## Usage

### `new`

Create a new folder with a blank/generated vbapm project inside

Create a folder "project-name" with a blank xlsm project:

```txt
vba new project-name.xlsm
```

(equivalent to above)

```txt
vba new project-name --target xlsm
```

Create a folder "from-existing" with a project from an existing workbook:

```txt
vba new from-existing --from existing.xlsm
```

Create a blank package for sharing as a library between projects:

```txt
vba new json-converter --package
```

### `init`

Create a blank/generated vbapm project in the current folder

Create a blank xlsm project with the current folder's name:

```txt
vba init --target xlsm
```

Create a project from an existing workbook:

```txt
vba init --from existing.xlsm
```

Create a blank package:

```txt
vba init --package
```

### `build`

Build an Excel workbook from the project's source. The built file is located in the `build/` folder and if a previously built file is found it is moved to `/.backup` to protect against losing any previously saved work.

Build a project:

```txt
vba build
```

Build and open a project for editing:

```txt
vba build --open
```

Build a package using a blank target:

```txt
vba build --target xlsm
```

Build a project, excluding any development src, dependencies, or references:

```txt
vba build --release
```

### `export`

Once you've completed your edits and are ready to commit your changes, export your project with `vba export`.

Export a project:

```txt
vba export
```

Export a previously-built package:

```txt
vba export --target xlsm
```

### `run`

`vba run` is a useful utility function for running a public macro in the given workbook, passing up to 10 arguments, and if it returns a string value, outputing it to the console.

```vb
' (Module: Messages.bas)
Public Function SayHi(Name As Variant) As String
  SayHi = "Howdy " & Name & "!"
End Function
```

```txt
vba run Messages.SayHi Tim
Howdy Tim!
```

## Manifest (vba-block.toml)

### [project] or [package]

- `name` (_required_)
- `version` (_required_ for `[package]`)
- `authors` (_required_ for `[package]`)
- `target` (_required_ for `[project]`)

```toml
[project]
name = "awesome-excel-project"
target = "xlsm"
```

```toml
[package]
name = "awesome-vba-package"
authors = ["Me <me@email.com>"]
version = "0.1.0"
```

### [src]

`name = "path"` or

- `path`

```toml
[src]
A = "src/A.bas"
B = "src/B.cls"
C = { path = "src/C.bas" }
```

### [dependencies]

`name = "version"` or

- `version`
- `path`
- `git` (and `branch`, `tag`, or `rev`)

```toml
[dependencies]
a = "1" # Equivalent to ^1
b = "=2.0.0" # Precisely 2.0.0
c = { version = "3" }

d = { path = "./packages/d" }

e = { git = "https://..." } # master
f = { git = "https://...", branch = "dev" }
g = { git = "https://", tag = "bugfix" }
h = { git = "https://", rev = "abc1234" }
```

### [references]

- `version` (`"MAJOR.MINOR"`)
- `guid` (`"{...}"`)

```toml
[references]
Scripting = { version = "1.0", guid = "{...}" }
```

### [dev-src,dependencies,references]

`[dev-src]`, `[dev-dependencies]`, and `[dev-references]` are included during development and are excluded when building with the `--release` flag (i.e. `vba build --release`)

## Development

### Prerequisites

1. `git clone` this repo
2. Install [Node.js](https://nodejs.org/) v18 or later

### Build

1. Run `npm install`
2. Run `npm run build`
3. Run `npm run build:addins`

### Test

1. Run `npm test`
2. Run `npm run test:e2e`

### Release

1. Run `npm version patch` (or `minor`/`major`)
2. Run `npm publish --access public`
