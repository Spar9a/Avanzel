# Releasing Avanzel for Mac

A release is five files on a GitHub release named `v<version>` in Spar9a/Avanzel:

- `Avanzel-<version>-arm64.dmg`, for a first install: open it and drag Avanzel to Applications.
- `Avanzel-<version>-arm64-mac.zip`, its `.blockmap` and `latest-mac.yml`, which the app's updater reads. It asks
  GitHub for the latest release that isn't a draft or a pre-release, reads its `latest-mac.yml`, and downloads the
  ZIP named there if the version is newer.
- `SHA256SUMS.txt`, the SHA-256 sum of each of the others.

`scripts/release.mjs` makes all of them in `apps/mac/release/<version>/`, signed with the Developer ID, notarized
by Apple and checked, and with `--publish` it puts them on GitHub.

## Once on each Mac you release from

1. The Developer ID Application certificate, in the login keychain. This shows it:
   `security find-identity -v -p codesigning`. The script takes the one Developer ID Application identity there; if
   there are several, set `AVANZEL_RELEASE_IDENTITY` to the SHA-1 of the one to use.
2. A notary profile named `avanzel-notary`, made with an app-specific password from appleid.apple.com:
   `xcrun notarytool store-credentials avanzel-notary --apple-id <your Apple ID> --team-id <your team ID>`.
   This checks it: `xcrun notarytool history --keychain-profile avanzel-notary`.
3. Xcode or its command line tools (swiftc builds the two native helpers), and `npm ci` at the repo root.

## Making a release

1. Set the version, then commit it:
   `npm version <x.y.z> -w @avanzel/mac --no-git-tag-version`. The app, its updater and the file names all take
   the version from `apps/mac/package.json`.
2. Build and check it, from `apps/mac`: `node scripts/release.mjs` (or `npm run release -w @avanzel/mac`). It
   refuses to start while the git tree has changes, so the release is exactly one commit. Then it:
   - builds the native helpers, the icon and the app's code;
   - signs the helpers, `avanzel-calltap` and `avanzel-cursor`, with the hardened runtime and a secure timestamp;
   - packages the app and signs it, everything inside included, with the hardened runtime;
   - sends the app to Apple to notarize and staples Apple's ticket to it;
   - makes the DMG and the ZIP from that stapled app, and `latest-mac.yml` from the ZIP;
   - signs the DMG, has Apple notarize it too, and staples it;
   - checks all of it (below), then writes `SHA256SUMS.txt`.

   Building takes about five minutes; the rest is waiting for Apple, usually a few minutes for each of the two
   submissions, though the very first one took half an hour. Without a working notary profile it still builds and
   checks, but nothing is notarized, so Gatekeeper rejects that build, and `--publish` refuses it.
3. Publish it. The script never makes or pushes a git ref, so push the commit and its tag first, naming the refs:
   `git tag v<x.y.z>` and `git push origin refs/heads/main:refs/heads/main refs/tags/v<x.y.z>:refs/tags/v<x.y.z>`.
   Then, from the tagged commit:
   `GH_TOKEN=<a token that may write the repo's releases> node scripts/release.mjs --publish --notes <notes.md>`.
   It builds and checks everything again, then:
   - stops before building if GitHub has no tag `v<version>`, if the tag isn't this commit, or if that version is
     released already;
   - makes the release as a draft, which nobody else sees, and uploads the five files;
   - checks GitHub holds each file at its size and downloads `latest-mac.yml` back to compare it byte for byte;
   - publishes the release, not as a pre-release, and marks it the latest;
   - asks GitHub, signed out as the updater is, for the latest release and its `latest-mac.yml`, and says so if it
     can't see them (when the repo isn't public, for example).

   If it stops halfway, the draft stays, and running it again uses that draft. Without `--notes`, the release says
   how to install Avanzel and where the sums are. The token is only read from `GH_TOKEN`, never passed to another
   command, and never printed.

## What the script checks

Every check prints `pass`, `fail` or `skip`, and one failure stops the release before anything is published.

- The app's signature holds, everything inside it included: `codesign --verify --deep --strict`.
- The app, Electron's four helper apps and both native helpers each have the hardened runtime, the right signer
  and team, a secure timestamp, and exactly their own entitlements.
- The app's designated requirement names `app.avanzel.mac` and the team. Updates must satisfy it, so only builds
  signed by the same team can update a release.
- Electron's fuses: `RunAsNode`, `NODE_OPTIONS` and the `--inspect` arguments off, and the app loaded only from its
  asar, whose integrity is checked.
- `Info.plist` has the bundle ID, the version and the asar's integrity hash.
- `Contents/Resources` has the repo's `LICENSE` and `NOTICE`, and `licenses/` has the licence texts of everything
  the app bundles.
- The ZIP unpacks, as the updater unpacks it, to the same app, its signature whole and its ticket stapled.
- The DMG is whole and signed, and holds the same app, stapled, with a link to Applications.
- `latest-mac.yml` names this version and this ZIP, with its exact sha512 and size; the ZIP has its blockmap.
- Gatekeeper accepts the app (`spctl -a -t exec -vv`) and the DMG
  (`spctl -a -t open --context context:primary-signature -vv`), and both carry their tickets
  (`xcrun stapler validate`).

## A dry run without the Developer ID: --local

`node scripts/release.mjs --local` builds the same release signed with Avanzel Local, the identity review builds
use (`npm run signing:setup -w @avanzel/mac` makes it once). It runs every check except the last group: Apple
notarizes Developer ID builds only, so nothing is notarized and Gatekeeper rejects the build. A self-made identity
has no Team ID, and the hardened runtime's library validation then refuses to load Electron's own framework, so a
`--local` build also has `com.apple.security.cs.disable-library-validation`. It goes to
`apps/mac/release/<version>-local/`, and `--publish` refuses it.

`--allow-dirty` lets either mode build with uncommitted changes, to try the script out. `--publish` refuses it.

## Why a release is built this way

**Review builds are left as they were.** `npm run dist` and the flight pack's review builds still make a plain
folder from `electron-builder.yml`, signed afterwards with Avanzel Local by `scripts/signing.mjs`, so macOS keeps
the permissions given to earlier review builds. A release is built from `electron-builder.release.yml`, which
extends that file. Review builds can't update themselves to a release: their signature isn't the Developer ID's.

**The entitlements are the fewest that work.** `build/entitlements.mac.plist`, for the app:
`com.apple.security.cs.allow-jit` for V8, also when Avanzel's own binary runs as Node for the engine's write guard;
`com.apple.security.device.audio-input` for the microphone; `com.apple.security.automation.apple-events` to ask the
browser in front which page it shows. `build/entitlements.mac.inherit.plist`, for Electron's helper apps and the
other binaries inside: `allow-jit` only. `allow-unsigned-executable-memory` isn't needed since Electron 12, and
`disable-library-validation` isn't needed when everything carries the same Team ID, as it does here: the
onnxruntime binaries in `app.asar.unpacked` are signed with the rest. `build/entitlements.calltap.plist` gives
`avanzel-calltap` `audio-input`, since it records the sound of calls; `avanzel-cursor` needs none. The script signs
the two helpers itself, before packaging, because electron-builder would give them the helper apps' set.

**Electron's fuses** are switches in its binary, set before signing. Releases and review builds both ignore
`NODE_OPTIONS`, load the app only from its asar and check the asar's integrity. Releases also ignore `--inspect`,
so nothing can attach a debugger to them. Review builds keep it, because Playwright drives a packaged app through
it: `e2e/packaged.spec.ts` runs against a review build (`npm run dist`), and can't attach to a release build.
`RunAsNode` is off in both, so no other program can run code as Avanzel, with its microphone and screen recording
permissions. The engine's write guard, which once needed it, is an HTTP hook on 127.0.0.1 now
(`packages/engine/src/core/guard-hook.ts`). A release also refuses to start with a DevTools port or pipe
(`src/main/debug-switches.ts`), which no fuse covers.

**Notarizing comes before the DMG and the ZIP.** The app is notarized and stapled first, so the ZIP the updater
downloads holds the stapled app, and `latest-mac.yml`, made from that ZIP, matches it. The DMG is signed and
notarized after it is made, which would leave a DMG entry in `latest-mac.yml` out of date, so the DMG has no entry
and no blockmap; the updater only reads the ZIP.

**The licence texts ship in the app.** `scripts/licenses.mjs` fills `Contents/Resources/licenses` while
electron-builder packages the app, for review builds too: Electron's licence and Chromium's (FFmpeg and the rest),
what is bundled into the app's code, what is in its `node_modules`, the fonts, and onnx-asr's notice, with a
`README.txt` that lists them. It stops the build if a text is missing, or if the app's code bundles a package it
doesn't list. ONNX Runtime's texts are kept in `apps/mac/licenses/`, because its npm packages carry none.

## When something goes wrong

- **Apple doesn't accept the app or the DMG.** The script prints Apple's log of the submission. To read it again:
  `xcrun notarytool log <submission id> --keychain-profile avanzel-notary`.
- **A check fails.** Nothing is published. The build stays in `apps/mac/release/<version>/` to look at.
- **The upload stops halfway.** The release is still a draft; run the same command again.
- **GitHub signed out doesn't show the release.** The repo may still be private: the updater reads releases signed
  out, so it sees nothing until the repo is public.
