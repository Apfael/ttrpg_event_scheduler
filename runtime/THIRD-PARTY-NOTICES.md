# Bundled runtime notices

This product includes PHP software, freely available from <https://www.php.net/software/>.

The archive contains unmodified `php.exe` and `php8.dll` from the official PHP
8.4.27-1 NTS Windows x64 distribution. The original PHP license and bundled-code
notices are included as `license.txt` and `readme-redist-bins.txt` inside the
archive. PHP remains licensed under the PHP License 3.01; the application does
not claim ownership of PHP or its included third-party components.

The app-local `vcruntime140.dll` is unmodified Microsoft distributable code from
the x64 Visual Studio 2022 Community MSVC REDIST directory, not a debug runtime.
Copyright Microsoft Corporation. All rights reserved. It is supplied solely to
support this application, subject to the applicable Microsoft Software License
Terms. It does not install or modify the computer's system runtime.

- PHP binary source: https://downloads.php.net/~windows/releases/php-8.4.27-1-nts-Win32-vs17-x64.zip
- PHP license: https://www.php.net/license/3_01.txt
- Microsoft redistribution documentation: https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files
- Microsoft REDIST list: https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution
- Visual Studio Community terms: https://visualstudio.microsoft.com/license-terms/vs2022-ga-community/

Version, upstream checksum, archive checksum, and individual file checksums are
recorded in `manifest.json`. Neither runtime extraction nor launching downloads
anything. To rebuild the archive, use `scripts/package-runtime.ps1` with the
pinned upstream PHP ZIP and distributable code from a licensed Visual Studio
installation. Keep these notices with the runtime when redistributing it.
