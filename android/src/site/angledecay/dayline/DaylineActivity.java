package site.angledecay.dayline;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

public final class DaylineActivity extends Activity {
    private static final Uri DAYLINE = Uri.parse("https://your-dayline-site.example/");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent tab = new Intent(Intent.ACTION_VIEW, DAYLINE);
        tab.addCategory(Intent.CATEGORY_BROWSABLE);

        // Request a persistent browser Custom Tab so sign-in and site data use the browser's profile.
        Bundle options = new Bundle();
        options.putBinder("android.support.customtabs.extra.SESSION", null);
        options.putInt("android.support.customtabs.extra.TOOLBAR_COLOR", 0xfff8f9f5);
        options.putInt("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
        options.putBoolean("android.support.customtabs.extra.ENABLE_URLBAR_HIDING", true);
        tab.putExtras(options);

        try {
            startActivity(tab);
            finish();
        } catch (ActivityNotFoundException error) {
            new AlertDialog.Builder(this)
                .setTitle("Open Dayline")
                .setMessage("Enable a web browser on this device to open your Dayline workspace.")
                .setPositiveButton(android.R.string.ok, (dialog, which) -> finish())
                .setOnCancelListener(dialog -> finish())
                .show();
        }
    }
}
