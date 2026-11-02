#!/usr/bin/env bash
# Copies Bootstrap, Bootstrap Icons and Chart.js into the app so it also works with no internet.
set -e
mkdir -p www/vendor/fonts
cp node_modules/bootstrap/dist/css/bootstrap.min.css www/vendor/
cp node_modules/bootstrap-icons/font/bootstrap-icons.min.css www/vendor/
cp node_modules/bootstrap-icons/font/fonts/* www/vendor/fonts/
if [ -f node_modules/chart.js/dist/chart.umd.js ]; then cp node_modules/chart.js/dist/chart.umd.js www/vendor/chart.umd.js; else cp node_modules/chart.js/dist/chart.umd.min.js www/vendor/chart.umd.js; fi
for f in www/index.html www/learn-more.html; do
  sed -i \
    -e 's#https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css#vendor/bootstrap.min.css#g' \
    -e 's#https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css#vendor/bootstrap-icons.min.css#g' \
    -e 's#https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js#vendor/chart.umd.js#g' "$f"
done
ls -la www/vendor www/vendor/fonts
if grep -q "cdn.jsdelivr.net" www/index.html; then echo "WARNING: a CDN link is still in www/index.html"; fi
