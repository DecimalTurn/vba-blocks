#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$vendorNode = Join-Path $basedir "../vendor/node.exe"
if (Test-Path $vendorNode) {
  & $vendorNode --no-warnings "$basedir/../lib/vbapm.js" $args
} else {
  & node --no-warnings "$basedir/../lib/vbapm.js" $args
}
exit $LASTEXITCODE
