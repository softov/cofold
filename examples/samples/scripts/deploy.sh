#!/bin/sh
# Stands in for a real deploy. The third argument is present only when --force
# was given, which is what { when: force } in the document produces.
echo "deploy: environment=$1 channel=$2 ${3:-}"
