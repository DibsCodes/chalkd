import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import pkg from './package.json' with { type: 'json' };

const isWindows = process.platform === 'win32';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Chalkd',
    executableName: 'chalkd',
    asar: true,
    // Packager adds the extension for each OS (.ico on Windows).
    icon: 'packaging/icons/chalkd',
    // The Windows printer's scripts run outside the app, so they ship as
    // plain files in resources/printer-windows.
    extraResource: isWindows ? ['scripts/printer-windows'] : [],
    win32metadata: {
      CompanyName: 'Dibs',
      FileDescription: 'Chalkd',
      ProductName: 'Chalkd',
    },
  },
  rebuildConfig: {},
  makers: [
    // Windows: Chalkd-<version>-Setup.exe installs for the current user,
    // without admin rights, and adds Start menu and desktop shortcuts.
    new MakerSquirrel({
      name: 'chalkd',
      authors: 'Dibs',
      description: pkg.description,
      setupExe: `Chalkd-${pkg.version}-Setup.exe`,
      setupIcon: 'packaging/icons/chalkd.ico',
      // Shown in Settings › Apps; it has to be a URL.
      iconUrl:
        'https://raw.githubusercontent.com/DibsCodes/chalkd/main/packaging/icons/chalkd.ico',
      noMsi: true,
      // Signing, when there's a certificate: set WINDOWS_CERTIFICATE_FILE
      // and WINDOWS_CERTIFICATE_PASSWORD (see packaging/windows/README.md).
      ...(process.env.WINDOWS_CERTIFICATE_FILE
        ? {
            certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
            certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
          }
        : {}),
    }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
