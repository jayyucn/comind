# PowerShell wrapper for brainstorming server
# Workaround for the bash start-server.sh on Windows: handles env vars, creates session dir, runs node server in this shell.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File d:\comind\.trae\scripts\Start-BrainstormServer.ps1 -ProjectDir d:\comind

param(
    [Parameter(Mandatory = $true)][string]$ProjectDir
)

$ErrorActionPreference = 'Stop'

# Skill location
$SkillDir = 'C:\Users\jay\.trae-cn\skills\brainstorming\scripts'
$ServerCjs = Join-Path $SkillDir 'server.cjs'

# Session directory under .superpowers/brainstorm/<pid>-<timestamp>
$SessionId = "$PID-$( [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() )"
$SessionDir = Join-Path $ProjectDir ".superpowers/brainstorm/$SessionId"
$ContentDir = Join-Path $SessionDir 'content'
$StateDir   = Join-Path $SessionDir 'state'

New-Item -ItemType Directory -Force -Path $ContentDir | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir   | Out-Null

# Persist info so caller can read it after the script returns
$InfoFile = Join-Path $StateDir 'server-info.json'
$env:BRAINSTORM_DIR       = $SessionDir
$env:BRAINSTORM_HOST      = '127.0.0.1'
$env:BRAINSTORM_URL_HOST  = 'localhost'

# Run server in foreground; this script is itself backgrounded by the caller (RunCommand blocking:false)
Write-Output ("SESSION_DIR={0}" -f $SessionDir)
node $ServerCjs
