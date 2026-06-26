# daytona-npm-watch

`daytona-npm-watch` is a small TypeScript CLI prototype for defensive npm install analysis. It runs `npm install <package>` inside a disposable Daytona sandbox, captures install artifacts, applies simple heuristics, and prints a plain JSON report.

This is a wrapper/demo. It does not modify npm.

## Modes

`observe` creates a Daytona sandbox, creates a temporary npm project under `/tmp/npm-watch/project`, runs `npm init -y`, and installs the target package with lifecycle scripts enabled:

```sh
npm install <package> --foreground-scripts --loglevel=silly
```

When `strace` is available in the sandbox, the install is wrapped with:

```sh
strace -f -o /tmp/npm-watch/npm.strace -e trace=process,network,file ...
```

`safe` creates the same temporary project but installs with lifecycle scripts disabled:

```sh
npm install <package> --ignore-scripts --no-audit --no-fund
```

It then scans installed `package.json` files under `node_modules` for lifecycle scripts and suspicious script content.

## Signals

The prototype flags simple indicators, including:

- lifecycle scripts such as `preinstall`, `install`, `postinstall`, `prepare`, and in safe mode `prepublish`
- spawned shells such as `sh`, `bash`, and `zsh`
- inline execution such as `node -e`, `python -c`, and `perl -e`
- network syscalls such as `connect(...)` when `strace` is available
- download tools such as `curl`, `wget`, and `Invoke-WebRequest`
- permission changes such as `chmod`, `fchmod`, and `fchmodat`
- strings such as `base64`, `eval`, and `child_process`
- files created under `.ssh`, `.npmrc`, or outside the temporary project directory

## Setup

Install dependencies:

```sh
npm install
```

Set your Daytona API key:

```sh
export DAYTONA_API_KEY="your-api-key"
```

Or copy `.env.example` to `.env` and set `DAYTONA_API_KEY` there. The CLI loads `.env` from the current working directory and does not override already exported environment variables.

Run in development:

```sh
npm run dev -- observe lodash
```

Build the CLI:

```sh
npm run build
```

## Commands

```sh
daytona-npm-watch observe <package-or-tarball>
daytona-npm-watch safe <package-or-tarball>
```

Options:

- `--timeout <seconds>` sets the install timeout, default `60`
- `--keep-sandbox` leaves the Daytona sandbox running for manual inspection
- `--json` prints plain JSON output, default `true`
- `--verbose` prints progress messages to stderr

Examples:

```sh
npm run dev -- observe lodash
npm run dev -- safe lodash --timeout 90
npm run dev -- observe ./examples/malvared-demo/malvared-demo-1.0.0.tgz --keep-sandbox
```

## Demo Malicious Package

A local fake package is included under `examples/malvared-demo`. It contains a `postinstall` script that demonstrates suspicious behavior for training output only. Do not publish it to npm.

Pack it locally:

```sh
npm pack ./examples/malvared-demo --pack-destination .
```

Run it through safe mode:

```sh
npm run dev -- safe ./malvared-demo-1.0.0.tgz
```

Run it through observe mode:

```sh
npm run dev -- observe ./malvared-demo-1.0.0.tgz
```

## Website Demo Presentation

A static presentation site is included in `docs/`. It is dependency-free and ready for GitHub Pages.

Preview locally by opening:

```text
docs/index.html
```

To host on GitHub Pages:

- Push this repository to GitHub.
- Open repository Settings.
- Go to Pages.
- Set the source to the `docs` folder on your main branch.
- Save and wait for GitHub to publish the site.

## Harmless Shai-Hulud-Style Simulation

`examples/shai-hulud-sim` is a local-only training package. Its `postinstall` script writes a marker file to `/tmp/daytona-npm-watch-shai-hulud-sim.txt`, uses a harmless shell print, and includes suspicious strings as inert text. It does not read credentials, contact the network, persist, evade tools, or publish anything.

Pack it locally:

```sh
npm pack ./examples/shai-hulud-sim --pack-destination .
```

Install it only in a disposable local test project if you want to see the benign lifecycle script run on your machine:

```sh
mkdir -p /tmp/daytona-npm-watch-local-test
cd /tmp/daytona-npm-watch-local-test
npm init -y
npm install /path/to/shai-hulud-sim-1.0.0.tgz --foreground-scripts
```

Example JSON shape:

```json
{
  "package": "./malvared-demo-1.0.0.tgz",
  "mode": "observe",
  "suspicious": true,
  "signalCount": 5,
  "signals": [
    "npm lifecycle script mentioned",
    "shell spawned",
    "inline execution observed",
    "curl or wget observed",
    "network connect syscall"
  ],
  "sandboxId": "abc123",
  "installExitCode": 0,
  "artifacts": {
    "npmLog": "/tmp/npm-watch/npm.log",
    "strace": "/tmp/npm-watch/npm.strace",
    "straceStatus": "/tmp/npm-watch/strace.status",
    "beforeSnapshot": "/tmp/npm-watch/files.before",
    "afterSnapshot": "/tmp/npm-watch/files.after",
    "projectDir": "/tmp/npm-watch/project"
  }
}
```

## Security Limitations

This is a demo-friendly defensive prototype, not a complete malware sandbox.

- The heuristics are string and syscall based and will miss many behaviors.
- If `strace` is unavailable, runtime process, file, and network visibility is reduced.
- Network behavior depends on Daytona sandbox networking and package registry availability.
- A 60-second timeout can miss delayed behavior.
- npm install failures still produce a report when artifacts are available, but failed installs can reduce analysis coverage.
- The JSON report contains artifact paths inside the sandbox. Unless `--keep-sandbox` is used, the sandbox is deleted in a `finally` block after the run.
- Do not use this to execute untrusted packages outside an isolated sandbox.
