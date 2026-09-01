<#
.SYNOPSIS
  Start, stop or check the local development PostgreSQL cluster.

.DESCRIPTION
  Development uses a portable PostgreSQL install (the EDB binaries zip, no
  installer and no admin rights), so there is no Windows service to start.
  This wraps pg_ctl against that install.

  Override the locations with FLORAYN_PG_BIN and FLORAYN_PG_DATA if yours are
  somewhere else.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/pg.ps1 start
#>
param(
  [ValidateSet("start", "stop", "status", "psql")]
  [string]$Action = "start"
)

$bin = if ($env:FLORAYN_PG_BIN) { $env:FLORAYN_PG_BIN } else { "$env:USERPROFILE\pgsql-root\pgsql\bin" }
$data = if ($env:FLORAYN_PG_DATA) { $env:FLORAYN_PG_DATA } else { "$env:USERPROFILE\pgsql-data" }
$log = "$data.log"

if (-not (Test-Path "$bin\pg_ctl.exe")) {
  Write-Error "pg_ctl not found at $bin. Set FLORAYN_PG_BIN to your PostgreSQL bin directory."
  exit 1
}

switch ($Action) {
  "start" {
    & "$bin\pg_ctl.exe" -D $data -l $log -o "-p 5432" start
  }
  "stop" {
    & "$bin\pg_ctl.exe" -D $data -m fast stop
  }
  "status" {
    & "$bin\pg_ctl.exe" -D $data status
  }
  "psql" {
    & "$bin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d florayn
  }
}
