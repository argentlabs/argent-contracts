#!/bin/bash

for file in $(git diff --cached --name-only | grep -E '^contracts/.*\.sol$')

do
  echo "Checking $file"
  git show ":$file" | node_modules/.bin/solium --stdin "$file" # we only want to lint the staged changes, not any un-staged changes
  if [ $? -ne 0 ]; then
    echo "ethlint failed on staged file '$file'."
    exit 1 # exit with failure status
  fi
done
