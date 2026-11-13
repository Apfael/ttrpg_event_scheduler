[CmdletBinding()]
param(
    [ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start',
    [switch]$Lan,
    [switch]$NoBrowser,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

function Get-TextHash([string]$Text) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
function Get-FileDigest([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Quote-NativeArgument([string]$Value) {
    # Windows CommandLineToArgvW quoting; no shell evaluation or string-built commands.
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}
function Write-JsonFile([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8), $utf8)
}
function Read-State {
    if (-not [IO.File]::Exists($statePath)) { return $null }
    try { return ([IO.File]::ReadAllText($statePath) | ConvertFrom-Json) }
    catch { throw 'The local launcher state is damaged. Close this app, then remove its .tabletop-local folder and try again. Event data is kept separately in event-data.php.' }
}
function Get-OwnedProcess($State) {
    if ($null -eq $State) { return $null }
    try {
        if ($State.AppRoot -ne $appRoot) { return $null }
        $candidate = Get-Process -Id ([int]$State.ProcessId) -ErrorAction Stop
        if ($candidate.ProcessName -ne 'php' -or $candidate.Path -ne $State.Executable) { return $null }
        $expectedDirectory = [IO.Path]::GetFullPath($machineDirectory) + [IO.Path]::DirectorySeparatorChar
        if (-not [IO.Path]::GetFullPath($candidate.Path).StartsWith($expectedDirectory, [StringComparison]::OrdinalIgnoreCase)) { return $null }
        if ($candidate.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$State.StartTicks) { return $null }
        return $candidate
    } catch { return $null }
}
function Get-Health($State) {
    try {
        $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + [int]$State.Port + '/__tabletop/health') -TimeoutSec 2 -UseBasicParsing -Proxy $null
        if ($health.app -eq 'tabletop-portable' -and $health.instance -eq $State.Instance -and [int]$health.processId -eq [int]$State.ProcessId) { return $health }
    } catch {}
    return $null
}
function Get-ShareAddress {
    try {
        $active = @(Get-NetIPConfiguration -ErrorAction Stop | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Sort-Object { $_.NetIPv4Interface.InterfaceMetric })
        foreach ($configuration in $active) {
            foreach ($address in $configuration.IPv4Address) {
                if ($address.IPAddress -notmatch '^(127\.|169\.254\.)') { return [string]$address.IPAddress }
            }
        }
    } catch {}
    try {
        foreach ($address in [Net.Dns]::GetHostAddresses([Environment]::MachineName)) {
            if ($address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $address.IPAddressToString -notmatch '^(127\.|169\.254\.)') { return $address.IPAddressToString }
        }
    } catch {}
    throw 'No local network address is available. Connect to your network, or use Start Tabletop.cmd for this computer only.'
}
function Get-FreePort([int]$Preferred = 8787) {
    foreach ($port in (@($Preferred) + @(8787..8807) | Select-Object -Unique)) {
        $listener = $null
        try {
            $address = if ($Lan) { [Net.IPAddress]::Any } else { [Net.IPAddress]::Loopback }
            $listener = New-Object Net.Sockets.TcpListener($address, $port)
            $listener.Start(); return [int]$port
        } catch {} finally { if ($listener) { $listener.Stop() } }
    }
    throw 'No free local port was found between 8787 and 8807. Close another local app and try again.'
}
function Get-BundledRuntime {
    $bundleRoot = Join-Path $appRoot 'runtime'
    $manifest = [IO.File]::ReadAllText((Join-Path $bundleRoot 'manifest.json')) | ConvertFrom-Json
    $archivePath = Join-Path $bundleRoot $manifest.archive
    if ((Get-FileDigest $archivePath) -ne $manifest.archiveSha256) { throw 'The bundled PHP archive failed its integrity check. Restore the runtime folder from the repository.' }
    $runtimeDirectory = Join-Path $machineDirectory ('php-' + $manifest.archiveSha256.Substring(0, 12))
    $valid = [IO.Directory]::Exists($runtimeDirectory)
    if ($valid) {
        foreach ($file in $manifest.files) {
            $path = Join-Path $runtimeDirectory $file.path
            if (-not [IO.File]::Exists($path) -or (Get-FileDigest $path) -ne $file.sha256) { $valid = $false; break }
        }
    }
    if (-not $valid) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Directory]::CreateDirectory($runtimeDirectory) | Out-Null
        $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
        try {
            foreach ($entry in $archive.Entries) {
                $destination = [IO.Path]::GetFullPath((Join-Path $runtimeDirectory $entry.FullName))
                if (-not $destination.StartsWith($runtimeDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid path in bundled runtime.' }
                $allowed = @($manifest.files | Where-Object { $_.path -ceq $entry.FullName })
                if ($allowed.Count -ne 1) { throw 'Unexpected file in bundled runtime.' }
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
            }
        } finally { $archive.Dispose() }
        foreach ($file in $manifest.files) {
            $path = Join-Path $runtimeDirectory $file.path
            if (-not [IO.File]::Exists($path) -or (Get-FileDigest $path) -ne $file.sha256) { throw 'The extracted PHP runtime failed its integrity check.' }
        }
    }
    return (Join-Path $runtimeDirectory 'php.exe')
}
function Emit-Result($Result) {
    if ($Json) { $Result | ConvertTo-Json -Compress -Depth 5 }
    elseif ($Result.Running) {
        Write-Host ('Organizer: ' + $Result.OrganizerUrl)
        Write-Host ('Players:   ' + $Result.PlayerUrl)
        Write-Host 'Data saves beside the app in event-data.php. Use Stop Tabletop.cmd when finished.'
    } else { Write-Host 'Tabletop is stopped. Your event data is unchanged.' }
}

$mutex = $null
$hasMutex = $false
$startedProcess = $null
$launchSucceeded = $false
try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'The bundled runtime requires 64-bit Windows 10 or 11.' }
    foreach ($required in @('api.php', 'index.html', 'organizer.html', 'players.html')) {
        if (-not [IO.File]::Exists((Join-Path $appRoot $required))) { throw ('Missing ' + $required + '. Extract or sync the complete app folder before starting.') }
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try { $machineKey = (Get-TextHash ([Environment]::MachineName + ':' + $identity.User.Value)).Substring(0, 16) }
    finally { $identity.Dispose() }
    $machineDirectory = Join-Path (Join-Path $appRoot '.tabletop-local') $machineKey
    [IO.Directory]::CreateDirectory($machineDirectory) | Out-Null
    $statePath = Join-Path $machineDirectory 'server.json'
    $mutex = New-Object Threading.Mutex($false, ('Local\Tabletop-' + (Get-TextHash $appRoot.ToLowerInvariant()).Substring(0, 32)))
    try { $hasMutex = $mutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $hasMutex = $true }
    if (-not $hasMutex) { throw 'Another launcher is busy. Wait a moment, then try again.' }
    $previous = Read-State
    $owned = Get-OwnedProcess $previous
    if ($Action -eq 'Stop') {
        if ($owned) { $owned | Stop-Process -Force; $owned.WaitForExit(5000) | Out-Null }
        elseif ($previous -and (Get-Process -Id ([int]$previous.ProcessId) -ErrorAction SilentlyContinue)) { throw 'The saved process ID belongs to another process. It was not stopped.' }
        if ($previous) { $previous.Running = $false; Write-JsonFile $statePath $previous }
        Emit-Result ([pscustomobject]@{ Running = $false }); $launchSucceeded = $true
    } elseif ($Action -eq 'Status') {
        if ($owned -and (Get-Health $previous)) { Emit-Result $previous }
        else { Emit-Result ([pscustomobject]@{ Running = $false }) }
        $launchSucceeded = $true
    } elseif ($owned) {
        if (-not (Get-Health $previous)) { throw 'Tabletop is running but did not respond. Use Stop Tabletop.cmd, then start it again.' }
        if ([bool]$previous.Lan -ne [bool]$Lan) { throw 'Tabletop is already running in a different network mode. Use Stop Tabletop.cmd before switching between local and LAN mode.' }
        if (-not $NoBrowser) { Start-Process -FilePath $previous.OrganizerUrl | Out-Null }
        Emit-Result $previous; $launchSucceeded = $true
    } else {
        $php = Get-BundledRuntime
        $version = & $php -n -r 'echo PHP_VERSION;' 2>&1
        if ($LASTEXITCODE -ne 0 -or [string]$version -notmatch '^8\.') { throw 'The bundled PHP runtime could not start. Check that the full runtime folder is available offline and Windows has not blocked it.' }
        $shareAddress = if ($Lan) { Get-ShareAddress } else { '127.0.0.1' }
        $preferredPort = if ($previous) { [int]$previous.Port } else { 8787 }
        $port = Get-FreePort $preferredPort
        $sessionDirectory = Join-Path $machineDirectory 'sessions'
        [IO.Directory]::CreateDirectory($sessionDirectory) | Out-Null
        $instance = [Guid]::NewGuid().ToString('N')
        $bindAddress = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
        $phpArguments = @('-n', '-d', 'display_errors=0', '-d', 'log_errors=1', '-d', ('session.save_path="' + $sessionDirectory.Replace('\', '/') + '"'), '-S', ($bindAddress + ':' + $port), '-t', $appRoot, (Join-Path $PSScriptRoot 'router.php'))
        $environmentKeys = @('TABLETOP_APP_ROOT', 'TABLETOP_INSTANCE_ID', 'TABLETOP_SHARE_HOST')
        $environmentValues = @($appRoot, $instance, $shareAddress)
        $savedEnvironment = @{}
        try {
            for ($i = 0; $i -lt $environmentKeys.Count; $i++) {
                $key = $environmentKeys[$i]; $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
                [Environment]::SetEnvironmentVariable($key, $environmentValues[$i], 'Process')
            }
            $startedProcess = Start-Process -FilePath $php -ArgumentList (($phpArguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ') -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $machineDirectory 'server.stdout.log') -RedirectStandardError (Join-Path $machineDirectory 'server.stderr.log')
        } finally { foreach ($key in $environmentKeys) { [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process') } }
        $state = [pscustomobject]@{
            Running = $true; AppRoot = $appRoot; ProcessId = $startedProcess.Id; StartTicks = $startedProcess.StartTime.ToUniversalTime().Ticks.ToString()
            Executable = $php; Port = $port; Lan = [bool]$Lan; Instance = $instance
            OrganizerUrl = ('http://' + $shareAddress + ':' + $port + '/organizer.html'); PlayerUrl = ('http://' + $shareAddress + ':' + $port + '/players.html')
        }
        $ready = $false
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            $startedProcess.Refresh()
            if ($startedProcess.HasExited) { break }
            if (Get-Health $state) { $ready = $true; break }
            Start-Sleep -Milliseconds 150
        }
        if (-not $ready) { throw ('The local server did not start. See ' + (Join-Path $machineDirectory 'server.stderr.log')) }
        Write-JsonFile $statePath $state
        if (-not $NoBrowser) { Start-Process -FilePath $state.OrganizerUrl | Out-Null }
        Emit-Result $state; $launchSucceeded = $true
    }
} catch { Write-Error $_ -ErrorAction Continue }
finally {
    if (-not $launchSucceeded -and $startedProcess) { try { if (-not $startedProcess.HasExited) { $startedProcess | Stop-Process -Force } } catch {} }
    if ($hasMutex -and $mutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
if (-not $launchSucceeded) { exit 1 }
