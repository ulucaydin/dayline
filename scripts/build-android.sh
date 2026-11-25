#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK directory}"
: "${DAYLINE_ANDROID_KEYSTORE:?Set the release PKCS12 keystore path}"
: "${DAYLINE_ANDROID_KEY_PASSWORD_FILE:?Set the path to the keystore password file}"
tools="$ANDROID_HOME/build-tools/36.0.0"
platform="$ANDROID_HOME/platforms/android-36/android.jar"
javac="${JAVA_HOME:+$JAVA_HOME/bin/}javac"
export JAVA_HOME
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
output="$root/public/download/Dayline.apk"

mkdir -p "$work/res/drawable-xxxhdpi" "$work/classes" "$(dirname "$output")"
cp "$root/public/icons/icon-192.png" "$work/res/drawable-xxxhdpi/dayline.png"
"$tools/aapt2" compile --dir "$work/res" -o "$work/resources.zip"
"$tools/aapt2" link -I "$platform" --manifest "$root/android/AndroidManifest.xml" \
  -o "$work/unsigned.apk" "$work/resources.zip"
"$javac" --release 11 -classpath "$platform" -d "$work/classes" \
  "$root/android/src/site/angledecay/dayline/DaylineActivity.java"
"$tools/d8" --min-api 26 --lib "$platform" --output "$work" \
  "$work/classes/site/angledecay/dayline/DaylineActivity.class"
(cd "$work" && zip -q unsigned.apk classes.dex)
"$tools/zipalign" -f 4 "$work/unsigned.apk" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$DAYLINE_ANDROID_KEYSTORE" --ks-key-alias dayline \
  --ks-pass "file:$DAYLINE_ANDROID_KEY_PASSWORD_FILE" --v4-signing-enabled false \
  --out "$work/Dayline.apk" "$work/aligned.apk"
"$tools/apksigner" verify --verbose "$work/Dayline.apk"
"$tools/zipalign" -c 4 "$work/Dayline.apk"
install -m 0644 "$work/Dayline.apk" "$output"
printf '%s\n' "$output"
