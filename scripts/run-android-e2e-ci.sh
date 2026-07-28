#!/usr/bin/env bash

set -uo pipefail

readonly APPIUM_LOG_FILE=/tmp/appium.log
readonly APPIUM_STDOUT_FILE=/tmp/appium.stdout.log
readonly EMULATOR_SERIAL="emulator-${EMULATOR_PORT:-5554}"
readonly SPEC_PATH="${ANDROID_E2E_SPEC:-}"

validate_spec_path() {
  if [[ -z "$SPEC_PATH" ]]; then
    return 0
  fi

  case "$SPEC_PATH" in
    e2e/specs/shared/*.spec.ts|e2e/specs/android/*.spec.ts) ;;
    *)
      echo "::error::Invalid Android E2E spec path: $SPEC_PATH"
      return 2
      ;;
  esac

  if [[ ! -f "$SPEC_PATH" ]]; then
    echo "::error::Android E2E spec does not exist: $SPEC_PATH"
    return 2
  fi
}

wait_for_appium() {
  for _attempt in {1..30}; do
    if curl --fail --silent http://127.0.0.1:4723/status >/dev/null; then
      return 0
    fi

    if ! kill -0 "$appium_pid" 2>/dev/null; then
      echo "::error::Appium exited before becoming ready. See $APPIUM_STDOUT_FILE."
      return 1
    fi

    sleep 1
  done

  echo "::error::Appium did not become ready within 30 seconds. See $APPIUM_STDOUT_FILE."
  return 1
}

capture_failure_diagnostics() {
  adb devices -l > /tmp/android-devices.txt 2>&1 || true
  adb -s "$EMULATOR_SERIAL" shell dumpsys webviewupdate > /tmp/android-webview.txt 2>&1 || true
  adb -s "$EMULATOR_SERIAL" logcat -d > /tmp/android-logcat.txt 2>&1 || true
}

# Invoked indirectly by the EXIT trap installed after Appium starts.
# shellcheck disable=SC2329
cleanup() {
  if kill -0 "$appium_pid" 2>/dev/null; then
    kill "$appium_pid" 2>/dev/null || true
  fi
  wait "$appium_pid" 2>/dev/null || true
}

validate_spec_path || exit $?

# --allow-insecure lets Appium auto-fetch a chromedriver matching the device
# WebView. Keep Appium and the test command in this one shell so the PID and
# exit status remain available for reliable cleanup and failure reporting.
appium \
  --port 4723 \
  --allow-insecure=uiautomator2:chromedriver_autodownload \
  --log-level error:debug \
  --log "$APPIUM_LOG_FILE" \
  > "$APPIUM_STDOUT_FILE" 2>&1 &
appium_pid=$!

trap cleanup EXIT
trap 'exit 130' INT TERM

if ! wait_for_appium; then
  capture_failure_diagnostics
  exit 1
fi

status=0
if [[ -n "$SPEC_PATH" ]]; then
  npm run e2e:test:android -- --spec "$SPEC_PATH" || status=$?
else
  npm run e2e:test:android || status=$?
fi

if [[ "$status" -ne 0 ]]; then
  capture_failure_diagnostics
fi

exit "$status"
