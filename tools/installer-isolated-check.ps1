# 受控隔离 NSIS 验收。仅对当前用户没有 .gsp/.ngsp 键的机器运行；已有产品不受影响。
# 暂未完成最终 release 验收；仅在检查过生成的 NSIS 脚本及完整回滚范围后运行。
$ErrorActionPreference = 'Stop'
$token = [guid]::NewGuid().ToString('N').Substring(0,12)
$name = "GSP验收-$token"
$base = Join-Path ([IO.Path]::GetTempPath()) "gsp-install-$token"
$source = Resolve-Path 'src-tauri/target/release/nsis/x64'
$compiler = Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe'
$install = Join-Path $base 'installed'
$keys = @('HKCU\Software\Classes\.gsp','HKCU\Software\Classes\.ngsp',"HKCU\Software\Classes\原版课件-$token","HKCU\Software\Classes\新版课件-$token","HKCU\Software\example\$name","HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\$name")
$shortcuts = @((Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk"), (Join-Path ([Environment]::GetFolderPath('Programs')) "$name.lnk"))
if (Test-Path -LiteralPath $base) { throw '临时路径已存在' }
foreach ($shortcut in $shortcuts) { if (Test-Path -LiteralPath $shortcut) { throw "快捷方式已存在：$shortcut" } }
foreach ($key in $keys) { & reg.exe query $key *> $null; if ($LASTEXITCODE -eq 0) { throw "注册表项已存在：$key" } }
New-Item -ItemType Directory -Path $base | Out-Null
$marker = Join-Path $base 'owner.txt'
Set-Content -LiteralPath $marker -Value $token -Encoding ascii
$uninstallerHash = $null
try {
  Copy-Item -LiteralPath $source -Destination (Join-Path $base 'nsis') -Recurse
  $script = Join-Path $base 'nsis/installer.nsi'
  $text = Get-Content -LiteralPath $script -Raw
  foreach ($expected in @('!define PRODUCTNAME "新版"','!define BUNDLEID "org.example.newgsp"','"原版课件"','"新版课件"','!define OUTFILE "nsis-output.exe"')) {
    if (!$text.Contains($expected)) { throw "安装器模板与验收脚本不匹配：$expected" }
  }
  $text = $text.Replace('!define PRODUCTNAME "新版"', "!define PRODUCTNAME `"$name`"")
  $text = $text.Replace('!define BUNDLEID "org.example.newgsp"', "!define BUNDLEID `"org.example.newgsp.test.$token`"")
  $text = $text.Replace('"原版课件"', "`"原版课件-$token`"").Replace('"新版课件"', "`"新版课件-$token`"")
  $text = $text.Replace('!define OUTFILE "nsis-output.exe"', "!define OUTFILE `"$base\setup.exe`"")
  # NSIS 按 BOM 识别 UTF-8；无 BOM 会误解码中文并遗留不可预料的键。
  Set-Content -LiteralPath $script -Value $text -Encoding utf8BOM
  $p = Start-Process -FilePath $compiler -ArgumentList @('"'+$script+'"') -WorkingDirectory (Join-Path $base 'nsis') -WindowStyle Hidden -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "编译失败：$($p.ExitCode)" }
  $p = Start-Process -FilePath (Join-Path $base 'setup.exe') -ArgumentList @('/S',"/D=$install") -WindowStyle Hidden -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "安装失败：$($p.ExitCode)" }
  $exe = Join-Path $install 'new-gsp.exe'
  if (!(Test-Path $exe) -or !(Test-Path (Join-Path $install 'uninstall.exe'))) { throw '安装文件不完整' }
  $uninstallerHash = (Get-FileHash (Join-Path $install 'uninstall.exe') -Algorithm SHA256).Hash
  foreach ($ext in @('gsp','ngsp')) {
    $expected = if ($ext -eq 'gsp') { "原版课件-$token" } else { "新版课件-$token" }
    $value = (Get-Item -LiteralPath "Registry::HKCU\Software\Classes\.$ext").GetValue('')
    if ($value -ne $expected) { throw "关联不符：$ext" }
  }
  Write-Host '安装主程序 SHA256：' (Get-FileHash $exe -Algorithm SHA256).Hash
  & npx.cmd tsx tools/desktop-save-smoke.ts $exe
  if ($LASTEXITCODE -ne 0) { throw '桌面冒烟失败' }
} finally {
  if (Test-Path (Join-Path $install 'uninstall.exe')) {
    $p = Start-Process -FilePath (Join-Path $install 'uninstall.exe') -ArgumentList @('/S',"_?=$install") -WindowStyle Hidden -Wait -PassThru
    if ($p.ExitCode -ne 0) { Write-Warning "卸载失败：$($p.ExitCode)" }
  }
  # NSIS 的卸载宏会留下扩展名的空默认值及备份值；只有内容完全符合本测试时才清理。
  $classes = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes', $true)
  foreach ($ext in @('gsp','ngsp')) {
    $className = if ($ext -eq 'gsp') { "原版课件-$token" } else { "新版课件-$token" }
    $key = $classes.OpenSubKey(".$ext", $true)
    if ($null -eq $key) { continue }
    try {
      $names = @($key.GetValueNames())
      $valid = $key.SubKeyCount -eq 0 -and $names.Count -le 2
      foreach ($n in $names) { if ($n -notin @('', "${className}_backup") -or $key.GetValue($n) -ne '') { $valid = $false } }
      if (!$valid) { throw "卸载后 .$ext 包含非本测试数据，停止清理" }
      foreach ($n in $names) { $key.DeleteValue($n) }
    } finally { $key.Dispose() }
    $classes.DeleteSubKey(".$ext", $true)
  }
  $classes.Dispose()
  $manufacturer = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\example', $true)
  if ($manufacturer) {
    $product = $manufacturer.OpenSubKey($name, $true)
    if ($product) {
      try {
        $names = @($product.GetValueNames())
        if ($product.SubKeyCount -ne 0 -or $names.Count -ne 1 -or $names[0] -ne '' -or $product.GetValue('') -ne $install) { throw '产品键包含非本测试数据' }
        $product.DeleteValue('')
      } finally { $product.Dispose() }
      $manufacturer.DeleteSubKey($name, $true)
    }
    $manufacturer.Dispose()
  }
  foreach ($key in $keys) { & reg.exe query $key *> $null; if ($LASTEXITCODE -eq 0) { throw "卸载后注册表仍存在：$key" } }
  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcut in $shortcuts) {
    if (Test-Path -LiteralPath $shortcut) {
      $target = $shell.CreateShortcut($shortcut).TargetPath
      if ($target -ne (Join-Path $install 'new-gsp.exe')) { throw "快捷方式不属于本测试：$shortcut" }
      Remove-Item -LiteralPath $shortcut -Force
    }
  }
  if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne $token -or !([IO.Path]::GetFullPath($base).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase))) { throw '拒绝清理非本测试目录' }
  $uninstaller = Join-Path $install 'uninstall.exe'
  if (Test-Path -LiteralPath $uninstaller) {
    if (!$uninstallerHash -or (Get-FileHash $uninstaller -Algorithm SHA256).Hash -ne $uninstallerHash) { throw '卸载程序指纹不符，停止清理' }
    Remove-Item -LiteralPath $uninstaller -Force
  }
  if (Test-Path -LiteralPath $install) {
    if (@(Get-ChildItem -LiteralPath $install -Force).Count -ne 0) { throw "安装目录不为空，请核对：$install" }
    Remove-Item -LiteralPath $install
  }
  $nsisDir = Join-Path $base 'nsis'
  $ownedNames = @('installer.nsi','FileAssociation.nsh','SimpChinese.nsh','utils.nsh')
  foreach ($file in @(Get-ChildItem -LiteralPath $nsisDir -Force)) {
    if ($file.PSIsContainer -or $file.Name -notin $ownedNames) { throw "构建目录含未知文件：$($file.FullName)" }
  }
  foreach ($name in $ownedNames) { $file = Join-Path $nsisDir $name; if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force } }
  Remove-Item -LiteralPath $nsisDir
  $setup = Join-Path $base 'setup.exe'; if (Test-Path -LiteralPath $setup) { Remove-Item -LiteralPath $setup -Force }
  Remove-Item -LiteralPath $marker -Force
  if (@(Get-ChildItem -LiteralPath $base -Force).Count -ne 0) { throw "临时目录含未知文件：$base" }
  Remove-Item -LiteralPath $base
  Write-Host '卸载及临时文件清理完成'
}
