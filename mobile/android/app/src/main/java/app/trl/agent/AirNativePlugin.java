package app.trl.agent;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.KeyStore;
import java.util.ArrayList;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Native helpers for the phone app:
 *  - secure storage: values are AES-GCM encrypted with a non-exportable key that lives in the Android Keystore
 *  - share-to-app: files/text shared from other apps are copied into the app cache and handed to the web layer
 *  - keep-alive: a foreground service so the encrypted link survives while the app is in the background
 */
@CapacitorPlugin(name = "AirNative")
public class AirNativePlugin extends Plugin {
    private static final String ALIAS = "trl_agent_key";
    private static final String PREFS = "trl_secure";
    private static final long MAX_SHARE_BYTES = 30L * 1024 * 1024;
    private JSObject pendingShare = null;

    @Override
    public void load() {
        JSObject s = readShare(getActivity() != null ? getActivity().getIntent() : null);
        if (s != null) pendingShare = s;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject s = readShare(intent);
        if (s != null) {
            pendingShare = null;
            notifyListeners("shareReceived", s, true);
        }
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject o = new JSObject();
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String model = Build.MODEL == null ? "Android" : Build.MODEL;
        o.put("model", (model.toLowerCase().startsWith(maker.toLowerCase()) ? model : (maker + " " + model)).trim());
        call.resolve(o);
    }

    // ---------- secure storage ----------
    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            return kg.generateKey();
        }
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        try {
            String k = call.getString("key");
            String v = call.getString("value");
            if (k == null || v == null) { call.reject("missing key/value"); return; }
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(v.getBytes("UTF-8"));
            byte[] all = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, all, 0, iv.length);
            System.arraycopy(ct, 0, all, iv.length, ct.length);
            prefs().edit().putString(k, Base64.encodeToString(all, Base64.NO_WRAP)).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("secureSet failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        JSObject o = new JSObject();
        try {
            String k = call.getString("key");
            String b = k == null ? null : prefs().getString(k, null);
            if (b == null) { o.put("value", JSObject.NULL); call.resolve(o); return; }
            byte[] all = Base64.decode(b, Base64.NO_WRAP);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, all, 0, 12));
            o.put("value", new String(c.doFinal(all, 12, all.length - 12), "UTF-8"));
            call.resolve(o);
        } catch (Exception e) {
            o.put("value", JSObject.NULL); // unreadable (e.g. restored on another phone): treat as not paired
            call.resolve(o);
        }
    }

    @PluginMethod
    public void secureDelete(PluginCall call) {
        String k = call.getString("key");
        if (k != null) prefs().edit().remove(k).apply();
        call.resolve();
    }

    // ---------- share to app ----------
    @PluginMethod
    public void getPendingShare(PluginCall call) {
        JSObject o = pendingShare == null ? new JSObject() : pendingShare;
        pendingShare = null;
        call.resolve(o);
    }

    @SuppressWarnings({"deprecation", "unchecked"})
    private JSObject readShare(Intent it) {
        try {
            if (it == null) return null;
            String a = it.getAction();
            if (!Intent.ACTION_SEND.equals(a) && !Intent.ACTION_SEND_MULTIPLE.equals(a)) return null;
            JSObject o = new JSObject();
            String text = it.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) o.put("text", text);
            ArrayList<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND.equals(a)) {
                Uri u = (Uri) it.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) uris.add(u);
            } else {
                ArrayList<Uri> l = it.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (l != null) uris.addAll(l);
            }
            JSArray files = new JSArray();
            File dir = new File(getContext().getCacheDir(), "shared");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            ContentResolver cr = getContext().getContentResolver();
            int n = 0;
            for (Uri u : uris) {
                if (n++ >= 10) break;
                String name = "shared-" + System.currentTimeMillis();
                try (Cursor c = cr.query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (c != null && c.moveToFirst()) name = c.getString(0);
                } catch (Exception ignored) { }
                name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                File out = new File(dir, System.currentTimeMillis() + "-" + name);
                long total = 0;
                try (InputStream in = cr.openInputStream(u); OutputStream os = new FileOutputStream(out)) {
                    if (in == null) continue;
                    byte[] buf = new byte[64 * 1024];
                    int r;
                    while ((r = in.read(buf)) > 0) {
                        total += r;
                        if (total > MAX_SHARE_BYTES) break;
                        os.write(buf, 0, r);
                    }
                }
                if (total > MAX_SHARE_BYTES) { //noinspection ResultOfMethodCallIgnored
                    out.delete(); continue; }
                JSObject f = new JSObject();
                f.put("name", name);
                f.put("mime", cr.getType(u));
                f.put("path", out.getAbsolutePath());
                files.put(f);
            }
            o.put("files", files);
            it.setAction(Intent.ACTION_MAIN); // consumed: do not process the same share again
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- keep-alive foreground service ----------
    @PluginMethod
    public void startKeepAlive(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i); else getContext().startService(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("keep-alive failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopKeepAlive(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), KeepAliveService.class));
        } catch (Exception ignored) { }
        call.resolve();
    }
}
