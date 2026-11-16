package chatgpt.site.linote;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;
import android.widget.Toast;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;

public class MainActivity extends Activity {
    private static final String HOME = "https://linote-notes-20261103.thinmerit.chatgpt.site/";
    private static final String HOST = "linote-notes-20261103.thinmerit.chatgpt.site";
    private WebView webView;
    private FrameLayout root;
    private float touchStartX;
    private float touchStartY;
    private boolean swipeHandled;
    private Uri pendingApkUri;
    private ValueCallback<Uri[]> imagePickerCallback;
    private static final int IMAGE_PICKER_REQUEST = 7;

    private void applyAppearance(String color, boolean dark) {
        if (color == null || !color.matches("#[0-9a-fA-F]{6}")) return;
        int background = Color.parseColor(color);
        root.setBackgroundColor(background);
        webView.setBackgroundColor(background);
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);
        int flags = getWindow().getDecorView().getSystemUiVisibility();
        int lightBars = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(dark ? flags & ~lightBars : flags | lightBars);
    }

    public class AppearanceBridge {
        @JavascriptInterface
        public boolean isSystemDark() {
            return (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        }

        @JavascriptInterface
        public void setTheme(String color, boolean dark) {
            if (color == null || !color.matches("#[0-9a-fA-F]{6}")) return;
            runOnUiThread(() -> {
                applyAppearance(color, dark);
                getSharedPreferences("appearance", MODE_PRIVATE).edit().putString("color", color).putBoolean("dark", dark).apply();
            });
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(250, 250, 250));
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(250, 250, 250));
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                root.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return windowInsets;
            });
        }
        setContentView(root);
        android.content.SharedPreferences appearance = getSharedPreferences("appearance", MODE_PRIVATE);
        applyAppearance(appearance.getString("color", "#fcfcfc"), appearance.getBoolean("dark", false));
        webView.addJavascriptInterface(new AppearanceBridge(), "LinoteAppearance");

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setUserAgentString(settings.getUserAgentString() + " LinoteAndroid/10");
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        final float swipeThreshold = 64 * getResources().getDisplayMetrics().density;
        webView.setOnTouchListener((view, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    touchStartX = event.getX();
                    touchStartY = event.getY();
                    swipeHandled = false;
                    break;
                case MotionEvent.ACTION_MOVE:
                    if (!swipeHandled && event.getPointerCount() == 1) {
                        float dx = event.getX() - touchStartX;
                        float dy = touchStartY - event.getY();
                        if (dx > swipeThreshold && dx > Math.abs(dy) * 1.3f) {
                            swipeHandled = true;
                            webView.evaluateJavascript("window.linoteHandleSwipe && window.linoteHandleSwipe()", null);
                        }
                    }
                    break;
                case MotionEvent.ACTION_UP:
                    if (!swipeHandled && event.getPointerCount() == 1) {
                        float dx = event.getX() - touchStartX;
                        float dy = touchStartY - event.getY();
                        if (dx > swipeThreshold && dx > Math.abs(dy) * 1.3f)
                            webView.evaluateJavascript("window.linoteHandleSwipe && window.linoteHandleSwipe()", null);
                    }
                case MotionEvent.ACTION_CANCEL:
                    swipeHandled = false;
                    break;
            }
            return false;
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (imagePickerCallback != null) imagePickerCallback.onReceiveValue(null);
                imagePickerCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.setType("image/*");
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try { startActivityForResult(Intent.createChooser(pick, "选择图片"), IMAGE_PICKER_REQUEST); }
                catch (Exception error) { imagePickerCallback.onReceiveValue(null); imagePickerCallback = null; return false; }
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost()) || !"https".equals(uri.getScheme())) return null;
                String name;
                String path = uri.getPath();
                if ("/".equals(path) || "/offline.html".equals(path)) name = "android-offline.html";
                else if (path != null && path.matches("/(app\\.js|styles\\.css|overrides\\.css|features\\.css|icon\\.png|manifest\\.webmanifest)")) name = path.substring(1);
                else return null;
                try {
                    InputStream file = getAssets().open(name);
                    String mime = name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : name.endsWith(".png") ? "image/png" : name.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
                    WebResourceResponse response = new WebResourceResponse(mime, "UTF-8", file);
                    HashMap<String,String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-store");
                    response.setResponseHeaders(headers);
                    return response;
                } catch (Exception error) { return null; }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("linote".equals(uri.getScheme()) && "update".equals(uri.getHost())) {
                    // 单机版是刻意断网的（清单里没有 INTERNET 权限），检查更新必然失败，这里直接说明。
                    if (MainActivity.this.getPackageName().endsWith(".standalone")) {
                        Toast.makeText(MainActivity.this, "单机版不会联网检查更新，请从 GitHub Releases 手动下载新版",
                            Toast.LENGTH_LONG).show();
                    } else {
                        checkForUpdate();
                    }
                    return true;
                }
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())) return false;
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                }
                return true;
            }
        });
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                Uri uri = Uri.parse(url);
                if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())) return;
                String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request request = new DownloadManager.Request(uri);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                request.setMimeType(mimeType);
                request.setTitle(filename);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager != null) {
                    try {
                        manager.enqueue(request);
                        Toast.makeText(MainActivity.this, "正在导出笔记", Toast.LENGTH_SHORT).show();
                    } catch (RuntimeException error) {
                        Toast.makeText(MainActivity.this, "导出失败，请稍后重试", Toast.LENGTH_SHORT).show();
                    }
                }
            }
        });

        try (InputStream bundledPage = getAssets().open("android-offline.html")) {
            String html = new String(readBytes(bundledPage), StandardCharsets.UTF_8);
            webView.loadDataWithBaseURL(HOME, html, "text/html", "UTF-8", HOME);
        } catch (Exception error) {
            Toast.makeText(this, "无法打开应用页面，请重新安装", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != IMAGE_PICKER_REQUEST || imagePickerCallback == null) return;
        Uri[] selected = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                selected = new Uri[count];
                for (int i = 0; i < count; i++) selected[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) selected = new Uri[]{data.getData()};
        }
        imagePickerCallback.onReceiveValue(selected);
        imagePickerCallback = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("window.linoteSystemBack ? window.linoteSystemBack() : false", handled -> {
            if (!"true".equals(handled)) {
                if (webView.canGoBack()) webView.goBack();
                else MainActivity.super.onBackPressed();
            }
        });
    }

    private static byte[] readBytes(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toByteArray();
    }

    private void checkForUpdate() {
        Toast.makeText(this, "正在检查更新", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(HOME + "android-version.json").openConnection();
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(10000);
                if (connection.getResponseCode() != 200) throw new Exception("版本信息暂不可用");
                String json = new String(readBytes(connection.getInputStream()), StandardCharsets.UTF_8);
                JSONObject info = new JSONObject(json);
                int latest = info.getInt("versionCode");
                String versionName = info.getString("versionName");
                Uri apk = Uri.parse(info.getString("apkUrl"));
                if (!"https".equals(apk.getScheme()) || !HOST.equals(apk.getHost())) throw new Exception("更新地址无效");
                int installed = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
                runOnUiThread(() -> {
                    if (latest <= installed) Toast.makeText(this, "已经是最新版本", Toast.LENGTH_SHORT).show();
                    else new AlertDialog.Builder(this).setTitle("发现 linote " + versionName)
                        .setMessage("下载新版 APK 并在本机安装？笔记会继续与账号同步。")
                        .setNegativeButton("稍后", null)
                        .setPositiveButton("下载更新", (dialog, which) -> downloadUpdate(apk, latest)).show();
                });
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(this, error.getMessage() == null ? "检查更新失败" : error.getMessage(), Toast.LENGTH_LONG).show());
            } finally { if (connection != null) connection.disconnect(); }
        }).start();
    }

    private void downloadUpdate(Uri apk, int version) {
        try {
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) throw new Exception("下载服务不可用");
            DownloadManager.Request request = new DownloadManager.Request(apk);
            request.setTitle("linote " + version);
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "linote-update-" + version + ".apk");
            long id = manager.enqueue(request);
            Toast.makeText(this, "正在下载更新", Toast.LENGTH_SHORT).show();
            new Thread(() -> {
                for (int i = 0; i < 300; i++) {
                    try (android.database.Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
                        if (cursor != null && cursor.moveToFirst()) {
                            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                                Uri downloaded = manager.getUriForDownloadedFile(id);
                                runOnUiThread(() -> installUpdate(downloaded));
                                return;
                            }
                            if (status == DownloadManager.STATUS_FAILED) break;
                        }
                    }
                    try { Thread.sleep(1000); }
                    catch (InterruptedException error) { Thread.currentThread().interrupt(); break; }
                }
                runOnUiThread(() -> Toast.makeText(this, "下载失败，请重试", Toast.LENGTH_LONG).show());
            }).start();
        } catch (Exception error) { Toast.makeText(this, "无法开始下载更新", Toast.LENGTH_LONG).show(); }
    }

    private void installUpdate(Uri apk) {
        if (apk == null) { Toast.makeText(this, "无法打开安装包", Toast.LENGTH_LONG).show(); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            pendingApkUri = apk;
            Toast.makeText(this, "请允许 linote 安装应用，然后返回", Toast.LENGTH_LONG).show();
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            return;
        }
        pendingApkUri = null;
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(apk, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivity(install); }
        catch (Exception error) { Toast.makeText(this, "无法打开安装界面", Toast.LENGTH_LONG).show(); }
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new Event('linote-system-theme'))", null);
        if (pendingApkUri != null && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) installUpdate(pendingApkUri);
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
