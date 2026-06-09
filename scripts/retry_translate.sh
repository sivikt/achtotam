#!/bin/bash
cd "$(dirname "$0")/.."
while true; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=lt&tl=en&dt=t&q=test')
  if [ "$code" = "200" ]; then
    echo "google reachable ($code) — running full build"
    .venv/bin/python scripts/2_build_ontology.py > build/build.log 2>&1
    echo "BUILD COMPLETE: $(tail -1 build/build.log)"
    break
  fi
  echo "$(date +%H:%M) google blocked ($code); retry in 15m"
  sleep 900
done
