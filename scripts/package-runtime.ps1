[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PhpArchive,
    [Parameter(Mandatory = $true)][string]$VcRedistDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$upstreamHash = 'dbae154a0a89791f36c3d48e68bae797878333e7d6cb5721e74617de59b63ab7'
if ((Get-FileHash -LiteralPath $PhpArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $upstreamHash) { throw 'PHP ZIP does not match the pinned official Windows x64 release checksum.' }
$vcDll = Join-Path $VcRedistDirectory 'vcruntime140.dll'
if ($VcRedistDirectory -match 'debug_nonredist' -or $VcRedistDirectory -notmatch 'x64[\\/]Microsoft\.VC\d+\.CRT[\\/]?$') { throw 'Use the x64 Microsoft.VC143.CRT directory from a licensed Visual Studio REDIST installation.' }
$signature = Get-AuthenticodeSignature -LiteralPath $vcDll
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') { throw 'The Microsoft runtime signature could not be verified.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$target = Join-Path $root 'runtime'
[IO.Directory]::CreateDirectory($target) | Out-Null
$source = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($PhpArchive))
$contents = @{}
try {
    foreach ($name in @('php.exe', 'php8.dll', 'license.txt', 'readme-redist-bins.txt')) {
        $entry = $source.GetEntry($name)
        if (-not $entry) { throw ('Missing upstream file: ' + $name) }
        $stream = $entry.Open(); $memory = New-Object IO.MemoryStream
        try { $stream.CopyTo($memory); $contents[$name] = $memory.ToArray() }
        finally { $stream.Dispose(); $memory.Dispose() }
    }
} finally { $source.Dispose() }
$contents['vcruntime140.dll'] = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($vcDll))
$contents['THIRD-PARTY-NOTICES.md'] = [IO.File]::ReadAllBytes((Join-Path $target 'THIRD-PARTY-NOTICES.md'))
$archiveName = 'php-windows-x64.zip'
$file = [IO.File]::Open((Join-Path $target $archiveName), [IO.FileMode]::Create)
$zip = New-Object IO.Compression.ZipArchive($file, [IO.Compression.ZipArchiveMode]::Create)
$files = @()
try {
    foreach ($name in @($contents.Keys | Sort-Object)) {
        $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
        $stream = $entry.Open()
        try { $stream.Write($contents[$name], 0, $contents[$name].Length) } finally { $stream.Dispose() }
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try { $hash = ([BitConverter]::ToString($algorithm.ComputeHash($contents[$name]))).Replace('-', '').ToLowerInvariant() }
        finally { $algorithm.Dispose() }
        $files += [ordered]@{ path = $name; size = $contents[$name].Length; sha256 = $hash }
    }
} finally { $zip.Dispose(); $file.Dispose() }
$manifest = [ordered]@{
    phpVersion = '8.4.27'; upstreamBuild = '8.4.27-1'; platform = 'windows-x64'; minimumOs = 'Windows 10 x64'
    upstreamUrl = 'https://downloads.php.net/~windows/releases/php-8.4.27-1-nts-Win32-vs17-x64.zip'
    upstreamSha256 = $upstreamHash; vcRuntimeVersion = (Get-Item -LiteralPath $vcDll).VersionInfo.FileVersion
    archive = $archiveName; archiveSha256 = (Get-FileHash -LiteralPath (Join-Path $target $archiveName) -Algorithm SHA256).Hash.ToLowerInvariant()
    files = $files
}
[IO.File]::WriteAllText((Join-Path $target 'manifest.json'), ($manifest | ConvertTo-Json -Depth 8) + "`n", (New-Object Text.UTF8Encoding($false)))
Write-Host ('Packaged portable Windows runtime: ' + (Join-Path $target $archiveName))
