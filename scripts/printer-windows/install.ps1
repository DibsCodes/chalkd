# Adds the "Chalkd" printer on Windows: anything printed to it opens as a new
# board in Chalkd. Chalkd runs this for you from Settings > Printing (Windows
# asks for admin permission first).
#
# How it works, since Windows has no CUPS:
#  - The printer uses Windows' own "Microsoft Print To PDF" driver, with a
#    port that is a file path, so each job is written to -SpoolFile (as the
#    user who printed) instead of asking where to save.
#  - The print service logs "document printed" (event 307) once a job is
#    done. A scheduled task for -User watches for that event on the Chalkd
#    printer and starts Chalkd with `--printed=<document title>`. A running
#    Chalkd hands that to its open window (one instance at a time).
#  - Chalkd then moves the file into its inbox and opens it as a board.
#
# Usage (as admin):
#   install.ps1 -SpoolFile <path> -Launch <chalkd.exe> [-LaunchArgs <args>] -User <DOMAIN\user>
#Requires -RunAsAdministrator
param(
  [Parameter(Mandatory)] [string] $SpoolFile,
  [Parameter(Mandatory)] [string] $Launch,
  [string] $LaunchArgs = '',
  [Parameter(Mandatory)] [string] $User
)
$ErrorActionPreference = 'Stop'

$PrinterName = 'Chalkd'
$Driver = 'Microsoft Print To PDF'
$Log = 'Microsoft-Windows-PrintService/Operational'
$UserName = ($User -split '\\')[-1]
$TaskName = "Chalkd printer ($UserName)"

if (-not (Get-PrinterDriver -Name $Driver -ErrorAction SilentlyContinue)) {
  throw "Windows' '$Driver' printer driver isn't installed. Turn on 'Microsoft Print to PDF' in Windows Features, then try again."
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $SpoolFile) | Out-Null

# Replace any earlier Chalkd printer, and its port if it pointed elsewhere.
$old = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if ($old) {
  Remove-Printer -Name $PrinterName
  if ($old.PortName -ne $SpoolFile) {
    Remove-PrinterPort -Name $old.PortName -ErrorAction SilentlyContinue
  }
}
if (-not (Get-PrinterPort -Name $SpoolFile -ErrorAction SilentlyContinue)) {
  Add-PrinterPort -Name $SpoolFile
}
Add-Printer -Name $PrinterName -DriverName $Driver -PortName $SpoolFile `
  -Comment 'Opens as a new board in Chalkd' -Location 'Chalkd whiteboard'

# The "document printed" events are off by default.
wevtutil set-log $Log /enabled:true

function Escape([string] $s) { [System.Security.SecurityElement]::Escape($s) }

$query = "*[System[EventID=307]] and *[UserData[DocumentPrinted[Param5='$PrinterName' and Param3='$UserName']]]"
$subscription = "<QueryList><Query Id=`"0`" Path=`"$Log`"><Select Path=`"$Log`">$query</Select></Query></QueryList>"
# $(Title) is filled in by Task Scheduler from the event, not by PowerShell.
$arguments = ("$LaunchArgs " + '--printed="$(Title)"').Trim()

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Opens Chalkd when something is printed to the Chalkd printer.</Description>
  </RegistrationInfo>
  <Triggers>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>$(Escape $subscription)</Subscription>
      <ValueQueries>
        <Value name="Title">Event/UserData/DocumentPrinted/Param2</Value>
      </ValueQueries>
    </EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(Escape $User)</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$(Escape $Launch)</Command>
      <Arguments>$(Escape $arguments)</Arguments>
    </Exec>
  </Actions>
</Task>
"@

Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null

Write-Output "Added the Chalkd printer. Print to it from any app and the pages open as a new board."
