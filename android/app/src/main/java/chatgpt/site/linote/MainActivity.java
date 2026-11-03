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
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private static final String HOME = "https://linote-notes-20261103.thinmerit.chatgpt.site/";
    private static final String HOST = "linote-notes-20261103.thinmerit.chatgpt.site";
    private WebView webView;
    private float touchStartX;
    private float touchStartY;
    private boolean swipeHandled;
    private Uri pendingApkUri;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(250, 250, 250));
        FrameLayout root = new FrameLayout(this);
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

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setUserAgentString(settings.getUserAgentString() + " LinoteAndroid/3");
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
                        float dx = touchStartX - event.getX();
                        float dy = touchStartY - event.getY();
                        if (Math.abs(dx) > swipeThreshold && Math.abs(dx) > Math.abs(dy) * 1.3f
                                && (dx > 0 || touchStartX < 32 * getResources().getDisplayMetrics().density)) {
                            swipeHandled = true;
                            webView.evaluateJavascript("window.linoteHandleSwipe && window.linoteHandleSwipe()", null);
                        }
                    }
                    break;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    swipeHandled = false;
                    break;
            }
            return false;
        });

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("linote".equals(uri.getScheme()) && "update".equals(uri.getHost())) {
                    checkForUpdate();
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

        if (savedInstanceState == null) webView.loadUrl(HOME);
        else webView.restoreState(savedInstanceState);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("window.linoteNavigateBack ? window.linoteNavigateBack() : false", handled -> {
            if (!"true".equals(handled)) {
                if (webView.canGoBack()) webView.goBack();
                else MainActivity.super.onBackPressed();
            }
        });
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
                String json = new String(connection.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
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
        if (pendingApkUri != null && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) installUpdate(pendingApkUri);
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
