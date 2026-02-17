param(
    [Parameter(Position=0)]
    [string]$AppName,

    [Parameter(Position=1)]
    [string]$File,

    [Parameter(Position=2)]
    [string]$Command,

    [Parameter(Position=3, ValueFromRemainingArguments=$true)]
    [string[]]$MacroArgs
)

$ErrorActionPreference = 'Stop'

if (-not $AppName -or -not $File -or -not $Command) {
    Fail "ERROR #1: Invalid Input (appname, file, and macro are required)"
}

if ($MacroArgs.Count -gt 10) {
    Fail "ERROR #2: Invalid Input (only 10 arguments are supported)"
}

# Unescape arguments
$UnescapedArgs = @()
foreach ($arg in $MacroArgs) {
    $UnescapedArgs += Unescape $arg
}

Run $AppName $File $Command $UnescapedArgs
exit 0

# -------
# Run
# -------

function Run {
    param(
        [string]$AppName,
        [string]$File,
        [string]$Command,
        [string[]]$Args
    )

    switch ($AppName) {
        "excel" {
            $excel = [Excel]::new()
            try {
                $result = $excel.Run($File, $Command, $Args)
            } finally {
                $excel.Dispose()
            }
        }
        default {
            Fail "ERROR #3: Unsupported App `"$AppName`""
        }
    }

    PrintLn $result
}

# -------
# Excel
# -------

class Excel {
    hidden [object]$App
    hidden [bool]$ExcelWasOpen = $false
    hidden [object]$Workbook
    hidden [bool]$WorkbookWasOpen = $false

    Excel() {
        $this.OpenExcel()
    }

    [string] Run([string]$File, [string]$Command, [string[]]$Args) {
        $this.OpenWorkbook($File)
        $result = RunMacro $this.App $Command $Args

        return $result
    }

    hidden [void] OpenExcel() {
        try {
            $this.App = [System.Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
            $this.ExcelWasOpen = $true
        } catch {
            try {
                $this.App = New-Object -ComObject "Excel.Application"
                $this.App.Visible = $false
            } catch {
                Fail "ERROR #5: Failed to open Excel - $($_.Exception.Message)"
            }
        }
    }

    hidden [void] OpenWorkbook([string]$Path) {
        $fileName = GetFileName $Path
        $fileBase = GetFileBase $Path

        # Check add-ins first
        try {
            $addin = $this.App.AddIns($fileName)
            if ($addin.IsOpen) {
                $this.Workbook = $addin
                $this.WorkbookWasOpen = $true
                return
            }
        } catch {
            # Not found in add-ins, continue
        }

        # Check already-open workbooks
        try {
            $this.Workbook = $this.App.Workbooks($fileBase)
            $this.WorkbookWasOpen = $true
            return
        } catch {
            # Not already open, continue
        }

        # Open the workbook
        try {
            $this.Workbook = $this.App.Workbooks.Open($Path)
        } catch {
            Fail "ERROR #6: Failed to open workbook - $($_.Exception.Message)"
        }
    }

    [void] Dispose() {
        if (-not $this.WorkbookWasOpen -and $null -ne $this.Workbook) {
            $this.Workbook.Close($true)
            $this.Workbook = $null
        }
        if (-not $this.ExcelWasOpen -and $null -ne $this.App) {
            $this.App.Quit()
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($this.App) | Out-Null
            $this.App = $null
        }
    }
}

# -------
# Run Macro
# -------

function RunMacro {
    param(
        [object]$App,
        [string]$Command,
        [string[]]$Args
    )

    $numArgs = $Args.Count
    switch ($numArgs) {
        0  { return $App.Run($Command) }
        1  { return $App.Run($Command, $Args[0]) }
        2  { return $App.Run($Command, $Args[0], $Args[1]) }
        3  { return $App.Run($Command, $Args[0], $Args[1], $Args[2]) }
        4  { return $App.Run($Command, $Args[0], $Args[1], $Args[2], $Args[3]) }
        5  { return $App.Run($Command, $Args[0], $Args[1], $Args[2], $Args[3], $Args[4]) }
        6  { return $App.Run($Command, $Args[0], $Args[1], $Args[2], $Args[3], $Args[4], $Args[5]) }
        7  { return $App.Run($Command, $Args[0], $Args[1], $Args[2], $Args[3], $Args[4], $Args[5], $Args[6]) }
        8  { return $App.Run($Command, $Args[0], $Args[1], $Args[2], $Args[3], $Args[4], $Args[5], $Args[6], $Args[7]) }
        9  { return $App.Run($Command, $Args[0], $Args[1], $Args[2], $Args[3], $Args[4], $Args[5], $Args[6], $Args[7], $Args[8]) }
        10 { return $App.Run($Command, $Args[0], $Args[1], $Args[2], $Args[3], $Args[4], $Args[5], $Args[6], $Args[7], $Args[8], $Args[9]) }
    }

    return $null
}

# -------
# Helpers
# -------

function Unescape {
    param([string]$Value)
    return $Value -replace '\^q', '"'
}

function GetFileBase {
    param([string]$Path)
    return [System.IO.Path]::GetFileName($Path)
}

function GetFileName {
    param([string]$Path)
    return [System.IO.Path]::GetFileNameWithoutExtension($Path)
}

function Fail {
    param([string]$Message)
    PrintLn "{`"success`":false,`"errors`":[`"$Message`"]}"
    exit 1
}

function Print {
    param([string]$Message)
    [Console]::Out.Write($Message)
}

function PrintLn {
    param([string]$Message)
    [Console]::Out.WriteLine($Message)
}

function PrintErr {
    param([string]$Message)
    [Console]::Error.Write($Message)
}
