param([string]$OutputPath = (Join-Path $PSScriptRoot 'linote.apk'))
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
$out = Join-Path $PSScriptRoot 'app\build\manual'
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
& node (Join-Path $webRoot 'scripts\generate-offline.mjs')
if ($LASTEXITCODE) { throw 'Offline page generation failed' }
foreach ($asset in @('android-offline.html','offline.html','app.js','styles.css','overrides.css','features.css','icon.png','manifest.webmanifest')) {
    Copy-Item -LiteralPath (Join-Path $webRoot "public\$asset") -Destination (Join-Path $assets $asset) -Force
}

& $aapt compile --dir (Join-Path $PSScriptRoot 'app\src\main\res') -o $compiled
if ($LASTEXITCODE) { throw 'aapt2 compile failed' }
& $aapt link -o $unsigned -I $platform --manifest (Join-Path $PSScriptRoot 'app\src\main\AndroidManifest.xml') --min-sdk-version 29 --target-sdk-version 35 $compiled
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

if (-not (Test-Path -LiteralPath $debugKey)) {
    & $keytool -genkeypair -keystore $debugKey -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=linote debug,O=linote,C=CN' -noprompt
    if ($LASTEXITCODE) { throw 'debug key creation failed' }
}
& $apksigner sign --ks $debugKey --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey --out $OutputPath $aligned
if ($LASTEXITCODE) { throw 'APK signing failed' }
& $apksigner verify --verbose $OutputPath
if ($LASTEXITCODE) { throw 'APK signature verification failed' }
$publicApk = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\linote.apk'
Copy-Item -LiteralPath $OutputPath -Destination $publicApk -Force
if ((Get-FileHash $OutputPath -Algorithm SHA256).Hash -ne (Get-FileHash $publicApk -Algorithm SHA256).Hash) { throw 'Hosted APK copy verification failed' }
Write-Output $OutputPath
