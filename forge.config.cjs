/**
 * Electron Forge configuration.
 *
 * Project layout: main.js and preload.js live in ./src/. Entry paths are
 * absolute (resolved via path.join(__dirname, ...)) because the vite plugin
 * evaluates them from its own working directory, not the project root.
 *
 * Windows-only build: stripped down to just the Squirrel maker so we don't
 * need to install -zip, -deb, -dmg, -rpm packages we'll never use. If we
 * ever ship a Mac or Linux build later, re-add those makers + install
 * their npm packages.
 *
 * Icons: point at src/assets/icon (no extension) — Forge auto-picks
 * .icns / .ico / .png per target platform. The runtime code in main.js
 * loads from the same directory so dev mode and packaged builds share
 * one icon source of truth. The .ico is a proper multi-size build
 * (16/24/32/48/64/128/256) so Squirrel's installer-icon step won't
 * fatal-error like the old single-size one did.
 */
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

module.exports = {
  // packageAfterCopy: after Forge copies our source files into a
  // staging directory but BEFORE it asars/zips, install production
  // dependencies into that staging directory's node_modules.
  //
  // Why we need this: @electron-forge/plugin-vite assumes Vite's
  // main-process bundle has everything inlined, so it ships the
  // app WITHOUT a node_modules folder. That's fine for pure-JS
  // deps, but main.js uses dynamic ESM `import('sql.js/...')` and
  // `import('@ryuziii/discord-rpc')` which can't be inlined and
  // must resolve at runtime against node_modules. Without this
  // hook, the install crashes with "Cannot find package 'sql.js'"
  // the first time it tries to open the library DB.
  //
  // The npm install runs with `--omit=dev --no-package-lock` so
  // we get only the actual deps (no @electron-forge/*, no vite,
  // no electron-the-build-tool) and no lockfile churn.
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      // Copy our manifest into the staging dir (forge may rewrite it).
      const srcPkg = path.join(__dirname, 'package.json');
      const dstPkg = path.join(buildPath, 'package.json');
      fs.copyFileSync(srcPkg, dstPkg);

      console.log(`[forge hook] installing prod deps into ${buildPath}`);
      // --ignore-scripts: skip lifecycle hooks (postinstall etc) — our
      //   postinstall script downloads yt-dlp/ffmpeg binaries into the
      //   project's bin/ folder, which is irrelevant here (those are
      //   already bundled via extraResource) and would fail anyway
      //   since the scripts/ folder isn't in the staging dir.
      // --omit=dev: production deps only.
      // --no-package-lock: don't write a package-lock.json here.
      // --no-audit / --no-fund: quieter output.
      cp.execSync(
        'npm install --omit=dev --ignore-scripts --no-package-lock --no-audit --no-fund',
        { cwd: buildPath, stdio: 'inherit', shell: true }
      );
    },
  },
  packagerConfig: {
    // asar disabled. Reasoning: the main process uses dynamic ESM
    // `import()` for sql.js and @ryuziii/discord-rpc. Inside asar,
    // Node's ESM resolver can't find CJS packages by bare name —
    // observed as "Cannot find package 'sql.js'" at runtime. The
    // standard workaround is `asar.unpackDir` with a glob, but the
    // glob syntax is finicky and the failure mode is silent (it
    // unpacks nothing, the build looks fine, the runtime still
    // breaks). Disabling asar entirely makes module resolution
    // bulletproof: node_modules/ sits on disk as plain files and
    // both ESM and CJS resolvers find packages normally. The cost
    // is a slightly larger install footprint and a marginally
    // slower cold start — both negligible for a player app.
    asar: false,
    // No extension — packager appends the right one per platform.
    icon: path.join(__dirname, 'src', 'assets', 'icon'),
    appBundleId: 'com.immerse.player',
    appCategoryType: 'public.app-category.music',
    // Bundle yt-dlp.exe + ffmpeg.exe into the Windows installer ONLY.
    // The check uses the BUILD-HOST platform — works for the common
    // workflow where Windows installers are built on Windows.
    //
    // electron-packager's extraResource copies the source path into
    // resources/ and preserves only the LEAF segment. So bin/win-x64/
    // lands as resources/win-x64/ — binPaths.js handles that path
    // directly via process.resourcesPath/win-x64/ when app.isPackaged.
    extraResource: process.platform === 'win32'
      ? [path.join(__dirname, 'bin', 'win-x64')]
      : [],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'immerse',
        // Icon shown in the Squirrel installer UI + Add/Remove Programs entry.
        setupIcon: path.join(__dirname, 'src', 'assets', 'icon.ico'),
        // Create both Start Menu and Desktop shortcuts at install time.
        // Without this, Squirrel only creates the Start Menu entry.
        shortcutLocations: ['StartMenu', 'Desktop'],
      },
    },
  ],
  // GitHub Releases publisher. `npm run publish` uses this to upload
  // built installers + the RELEASES/latest.yml metadata files that
  // electron-updater reads to detect newer versions in-app.
  //
  // Requires the GH_TOKEN env var set to a personal access token with
  // 'repo' scope. Token lives on YOUR dev machine only — never gets
  // shipped to users (the updater itself reads releases anonymously
  // from the public repo).
  //
  // ⚠️ Replace YOUR_GITHUB_USERNAME with your actual GitHub username
  // before the first publish, or you'll get a 404 on upload.
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'ihatebray',
          name: 'immerse',
        },
        draft: false,
        prerelease: false,
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: path.join(__dirname, 'src', 'main.js'),
            config: path.join(__dirname, 'vite.main.config.mjs'),
            target: 'main',
          },
          {
            entry: path.join(__dirname, 'src', 'preload.js'),
            config: path.join(__dirname, 'vite.preload.config.mjs'),
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: path.join(__dirname, 'vite.renderer.config.mjs'),
          },
        ],
      },
    },
  ],
};
