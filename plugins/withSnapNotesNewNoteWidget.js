const fs = require('node:fs/promises');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const RECEIVER_NAME = 'NewNoteWidgetProvider';
const PROVIDER_RESOURCE = '@xml/snapnotes_new_note_widget_info';
const UPDATE_ACTION = 'android.appwidget.action.APPWIDGET_UPDATE';

function withSnapNotesWidgetManifest(config) {
  return withAndroidManifest(config, next => {
    const application = next.modResults.manifest.application?.[0];
    if (!application) throw new Error('SnapNotes New Note widget requires an Android application manifest.');
    const receivers = application.receiver ?? (application.receiver = []);
    const packageName = next.android?.package;
    if (!packageName) throw new Error('SnapNotes New Note widget requires android.package in app config.');
    const qualifiedName = `${packageName}.${RECEIVER_NAME}`;
    const existing = receivers.find(receiver => receiver.$?.['android:name'] === qualifiedName);
    if (!existing) {
      receivers.push({
        $: {
          'android:name': qualifiedName,
          'android:label': 'SnapNotes New Note',
          'android:enabled': 'true',
          'android:exported': 'true',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': UPDATE_ACTION } }] }],
        'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': PROVIDER_RESOURCE } }],
      });
    }
    return next;
  });
}

function withSnapNotesWidgetResources(config) {
  return withDangerousMod(config, [
    'android',
    async next => {
      const packageName = next.android?.package;
      if (!packageName) throw new Error('SnapNotes New Note widget requires android.package in app config.');
      const androidRoot = next.modRequest.platformProjectRoot;
      const javaDirectory = path.join(androidRoot, 'app/src/main/java', ...packageName.split('.'));
      const layoutDirectory = path.join(androidRoot, 'app/src/main/res/layout');
      const drawableDirectory = path.join(androidRoot, 'app/src/main/res/drawable');
      const xmlDirectory = path.join(androidRoot, 'app/src/main/res/xml');
      const valuesDirectory = path.join(androidRoot, 'app/src/main/res/values');
      await Promise.all([javaDirectory, layoutDirectory, drawableDirectory, xmlDirectory, valuesDirectory]
        .map(directory => fs.mkdir(directory, { recursive: true })));

      await fs.writeFile(path.join(javaDirectory, `${RECEIVER_NAME}.kt`), `package ${packageName}

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.RemoteViews

class ${RECEIVER_NAME} : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetIds.forEach { appWidgetId -> updateWidget(context, manager, appWidgetId) }
  }

  private fun updateWidget(context: Context, manager: AppWidgetManager, appWidgetId: Int) {
    val views = RemoteViews(context.packageName, R.layout.snapnotes_new_note_widget)
    val launch = Intent(context, MainActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      data = Uri.parse("snapnotes://widget/new-note")
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val immutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    val pendingIntent = PendingIntent.getActivity(
      context,
      appWidgetId,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag,
    )
    views.setOnClickPendingIntent(R.id.snapnotes_new_note_widget, pendingIntent)
    manager.updateAppWidget(appWidgetId, views)
  }
}
`);

      await fs.writeFile(path.join(layoutDirectory, 'snapnotes_new_note_widget.xml'), `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/snapnotes_new_note_widget"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="horizontal"
    android:gravity="center_vertical"
    android:paddingStart="16dp"
    android:paddingEnd="16dp"
    android:background="@drawable/snapnotes_new_note_widget_background"
    android:contentDescription="@string/snapnotes_new_note_widget_description">
    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="+"
        android:textColor="#3B7F16"
        android:textSize="30sp"
        android:textStyle="bold"
        android:includeFontPadding="false"
        android:layout_marginEnd="12dp" />
    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="New Note"
        android:textColor="#20351D"
        android:textSize="16sp"
        android:textStyle="bold"
        android:includeFontPadding="false" />
</LinearLayout>
`);

      await fs.writeFile(path.join(drawableDirectory, 'snapnotes_new_note_widget_background.xml'), `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FFFFFF" />
    <corners android:radius="16dp" />
    <stroke android:width="1dp" android:color="#E2E8DE" />
</shape>
`);

      await fs.writeFile(path.join(xmlDirectory, 'snapnotes_new_note_widget_info.xml'), `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="144dp"
    android:minHeight="48dp"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/snapnotes_new_note_widget"
    android:resizeMode="none"
    android:widgetCategory="home_screen"
    android:description="@string/snapnotes_new_note_widget_description" />
`);

      await fs.writeFile(path.join(valuesDirectory, 'snapnotes_new_note_widget_strings.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="snapnotes_new_note_widget_description">Quickly open a blank local note in SnapNotes Mobile.</string>
</resources>
`);
      return next;
    },
  ]);
}

function withSnapNotesNewNoteWidget(config) {
  return withSnapNotesWidgetResources(withSnapNotesWidgetManifest(config));
}

module.exports = withSnapNotesNewNoteWidget;
