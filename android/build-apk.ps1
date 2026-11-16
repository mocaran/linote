param([string]$OutputPath, [switch]$Standalone)
if (!$OutputPath) { $OutputPath = Join-Path $PSScriptRoot $(if ($Standalone) { 'linote-standalone.apk' } else { 'linote.apk' }) }
$ErrorActionPreference = 'Stop'

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$jdk = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Android\Android Studio\jbr' }
$tools = Join-Path $sdk 'build-tools\36.1.0'
$platform = Join-Path $sdk 'platforms\android-36.1\android.jar'
$aapt = Join-Path $tools 'aapt2.exe'
$d8 = Join-Path $tools 'd8.bat'
$zipalign = Join-Path $tools 'zipalign.exe'
$apksigner = Join-Path $tools 'apksigner.bat'
$javac = Join-Path $jdk 'bin\javac.exe'
$keytool = Join-Path $jdk 'bin\keytool.exe'
$jar = Join-Path $jdk 'bin\jar.exe'
$out = Join-Path $PSScriptRoot $(if ($Standalone) { 'app\build\standalone' } else { 'app\build\manual' })
$compiled = Join-Path $out 'resources.zip'
$unsigned = Join-Path $out 'unsigned.apk'
$aligned = Join-Path $out 'aligned.apk'
$classes = Join-Path $out 'classes'
$dex = Join-Path $out 'dex'
$debugKey = Join-Path $PSScriptRoot 'debug.keystore'
$assets = Join-Path $out 'assets'
$webRoot = Split-Path $PSScriptRoot -Parent

foreach ($path in @($aapt,$d8,$zipalign,$apksigner,$javac,$keytool,$jar,$platform)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing Android build tool: $path" }
}
New-Item -ItemType Directory -Force -Path $out,$classes,$dex,$assets | Out-Null
$manifest = Join-Path $PSScriptRoot 'app\src\main\AndroidManifest.xml'
$generatorArgs = @()
if ($Standalone) {
    [xml]$xml = Get-Content -LiteralPath $manifest -Raw
    $ns = 'http://schemas.android.com/apk/res/android'
    $xml.manifest.package = 'chatgpt.site.linote.standalone'
    foreach ($permission in @($xml.manifest.SelectNodes('uses-permission'))) {
        [void]$xml.manifest.RemoveChild($permission)
    }
    [void]$xml.manifest.application.SetAttribute('label', $ns, ('linote ' + [char]0x5355 + [char]0x673A + [char]0x7248))
    [void]$xml.manifest.application.activity.SetAttribute('name', $ns, 'chatgpt.site.linote.MainActivity')
    $manifest = Join-Path $out 'AndroidManifest.xml'
    $xml.Save($manifest)
    $generatorArgs = @((Join-Path $assets 'android-offline.html'))
}
& node (Join-Path $webRoot 'scripts\generate-offline.mjs') @generatorArgs
if ($LASTEXITCODE) { throw 'Offline page generation failed' }
foreach ($asset in @('android-offline.html','offline.html','app.js','styles.css','overrides.css','features.css','theme.css','theme.js','icon.png','manifest.webmanifest')) {
    if ($Standalone -and $asset -eq "android-offline.html") { continue }
    Copy-Item -LiteralPath (Join-Path $webRoot "public\$asset") -Destination (Join-Path $assets $asset) -Force
}

& $aapt compile --dir (Join-Path $PSScriptRoot 'app\src\main\res') -o $compiled
if ($LASTEXITCODE) { throw 'aapt2 compile failed' }
& $aapt link -o $unsigned -I $platform --manifest $manifest --min-sdk-version 29 --target-sdk-version 35 $compiled
if ($LASTEXITCODE) { throw 'aapt2 link failed' }
& $jar uf $unsigned -C $out assets
if ($LASTEXITCODE) { throw 'APK web assets failed' }

& $javac -encoding UTF-8 -source 17 -target 17 -classpath $platform -d $classes (Join-Path $PSScriptRoot 'app\src\main\java\chatgpt\site\linote\MainActivity.java')
if ($LASTEXITCODE) { throw 'javac failed' }
$activityClasses = @(Get-ChildItem -LiteralPath (Join-Path $classes 'chatgpt\site\linote') -Filter 'MainActivity*.class' -File | ForEach-Object FullName)
& $d8 --lib $platform --output $dex $activityClasses
if ($LASTEXITCODE) { throw 'd8 failed' }
& $jar uf $unsigned -C $dex classes.dex
if ($LASTEXITCODE) { throw 'APK assembly failed' }
& $zipalign -f 4 $unsigned $aligned
if ($LASTEXITCODE) { throw 'zipalign failed' }

# ── 签名 ──────────────────────────────────────────────────────────────────
# 优先用私有 release key：android/keystore.properties（不入库）或环境变量
# LINOTE_KEYSTORE / LINOTE_KEYSTORE_PASSWORD / LINOTE_KEY_ALIAS / LINOTE_KEY_PASSWORD。
# 都找不到才退回调试 key —— debug key 是公开的通用密钥，任何人都能签出“同名同签名”的
# APK 冒充本应用的更新，所以对外发布务必配置 release key。
$ksProps = Join-Path $PSScriptRoot 'keystore.properties'
$keyStore = $env:LINOTE_KEYSTORE
$keyStorePass = $env:LINOTE_KEYSTORE_PASSWORD
$keyAlias = $env:LINOTE_KEY_ALIAS
$keyPass = $env:LINOTE_KEY_PASSWORD
if (Test-Path -LiteralPath $ksProps) {
    $props = @{}
    foreach ($line in Get-Content -LiteralPath $ksProps) {
        $text = $line.Trim()
        if ($text.Length -eq 0 -or $text.StartsWith('#') -or $text.StartsWith('!')) { continue }
        $pair = $text.Split('=', 2)
        if ($pair.Length -ne 2) { continue }
        $props[$pair[0].Trim()] = $pair[1].Trim()
    }
    if ($props['storeFile']) { $keyStore = $props['storeFile'] }
    if ($props['storePassword']) { $keyStorePass = $props['storePassword'] }
    if ($props['keyAlias']) { $keyAlias = $props['keyAlias'] }
    if ($props['keyPassword']) { $keyPass = $props['keyPassword'] }
}

if ($keyStore -and $keyStorePass -and $keyAlias -and (Test-Path -LiteralPath $keyStore)) {
    if (!$keyPass) { $keyPass = $keyStorePass }
    & $apksigner sign --ks $keyStore --ks-pass pass:$keyStorePass --key-pass pass:$keyPass --ks-key-alias $keyAlias --out $OutputPath $aligned
    if ($LASTEXITCODE) { throw 'APK signing failed' }
    Write-Host "已用私有 release key 签名：$keyAlias"
} else {
    Write-Warning '未找到 release key，退回调试签名（仅供本机调试，不要对外发布）'
    if (-not (Test-Path -LiteralPath $debugKey)) {
        & $keytool -genkeypair -keystore $debugKey -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=linote debug,O=linote,C=CN' -noprompt
        if ($LASTEXITCODE) { throw 'debug key creation failed' }
    }
    & $apksigner sign --ks $debugKey --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey --out $OutputPath $aligned
    if ($LASTEXITCODE) { throw 'APK signing failed' }
}
& $apksigner verify --verbose $OutputPath
if ($LASTEXITCODE) { throw 'APK signature verification failed' }
if (!$Standalone) {
    $publicApk = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\linote.apk'
    Copy-Item -LiteralPath $OutputPath -Destination $publicApk -Force
    if ((Get-FileHash $OutputPath -Algorithm SHA256).Hash -ne (Get-FileHash $publicApk -Algorithm SHA256).Hash) { throw 'Hosted APK copy verification failed' }
}
Write-Output $OutputPath
