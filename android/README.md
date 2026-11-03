# linote for Android

This Android app opens the production linote site in a WebView. It uses the same account, notes, tags, review history, and AI insight history as the web version. An internet connection is required. Website updates appear in the app without installing a new APK; native shell changes require a new APK.

The checked-in `build-apk.ps1` script builds and signs a debug APK with the installed Android SDK (build tools 36.1, platform 36) and Android Studio JDK. Run it from PowerShell with `ANDROID_HOME` and `JAVA_HOME` set if the defaults are not available. It also copies the signed file to `public/linote.apk` for the stable download URL. The resulting APK can be installed on Android 10 or newer. The debug signing key stays local and is ignored by Git. Keep that key so future APKs can update an existing installation.

The web and APK versions use separate device cookies, so sign in to the same linote account on each device. The DeepSeek key is encrypted in the account database and is shared automatically after sign-in.
