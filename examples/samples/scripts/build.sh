#!/bin/sh
# Stands in for a real build, and prints what it was given so the example is
# worth running.
echo "build: environment=$1"
shift
for target in "$@"; do
  echo "build: target=$target"
done
