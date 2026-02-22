#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

& "$basedir/../vendor/node.exe" --no-warnings "$basedir/../lib/vbapm.js" $args
exit $LASTEXITCODE
