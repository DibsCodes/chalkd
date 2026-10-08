# Removes the "Chalkd" printer, its port, and the tasks that open Chalkd when
# something is printed (see install.ps1). Needs admin rights.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$PrinterName = 'Chalkd'

$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if ($printer) {
  Remove-Printer -Name $PrinterName
  Remove-PrinterPort -Name $printer.PortName -ErrorAction SilentlyContinue
}
Get-ScheduledTask -TaskName 'Chalkd printer (*)' -ErrorAction SilentlyContinue |
  Unregister-ScheduledTask -Confirm:$false

Write-Output 'Removed the Chalkd printer.'
