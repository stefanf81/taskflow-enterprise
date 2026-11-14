#!/usr/bin/env bash
# Observation only (docs/agents/ci.md): report whether a pull request changes the
# inputs of the native builds, next to what the current path/branch rule decided.
#
# The native build gate runs the iOS and Android debug builds for same-repo
# Renovate / expo-maintenance pull requests whose changed paths match the mobile
# filter. With one root lockfile every npm update matches that filter, so a
# frontend-only update builds both apps; and a native dependency added on any
# other branch builds neither, while both required contexts still report success.
#
# Expo's native fingerprint is the hash the Detox jobs already key their app
# caches on: the config, config plugins, native dependencies and autolinking —
# not the JavaScript. Comparing the base's hash with the head's therefore answers
# "does this pull request change the native build" directly. This prints that
# comparison so a handful of pull requests can show whether it agrees with the
# current rule before the rule is replaced by it.
#
# Usage: native-fingerprint-report.sh <base-dir> <head-dir>
# Each directory holds <platform>.json from `fingerprint fingerprint:generate`.
set -uo pipefail

base_dir="${1:?usage: native-fingerprint-report.sh <base-dir> <head-dir>}"
head_dir="${2:?usage: native-fingerprint-report.sh <base-dir> <head-dir>}"
out="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
diff_cli="${FINGERPRINT_CLI:-node_modules/.bin/fingerprint}"

hash_of() {
  [[ -s "$1" ]] || return 1
  node -e 'const f=require("fs");process.stdout.write(JSON.parse(f.readFileSync(process.argv[1],"utf8")).hash)' "$1"
}

changed=false
unknown=false
rows=""
details=""

for platform in android ios; do
  base_file="${base_dir}/${platform}.json"
  head_file="${head_dir}/${platform}.json"
  base_hash="$(hash_of "$base_file")" || base_hash=""
  head_hash="$(hash_of "$head_file")" || head_hash=""

  if [[ -z "$base_hash" || -z "$head_hash" ]]; then
    unknown=true
    rows+="| ${platform} | ${base_hash:0:12}${base_hash:+…} | ${head_hash:0:12}${head_hash:+…} | not computed |"$'\n'
    continue
  fi

  if [[ "$base_hash" == "$head_hash" ]]; then
    rows+="| ${platform} | \`${base_hash:0:12}\` | \`${head_hash:0:12}\` | unchanged |"$'\n'
    continue
  fi

  changed=true
  rows+="| ${platform} | \`${base_hash:0:12}\` | \`${head_hash:0:12}\` | **changed** |"$'\n'

  # Which sources moved; the file paths are relative to mobile/.
  sources="$("$diff_cli" fingerprint:diff "$base_file" "$head_file" 2>/dev/null \
    | node -e '
        let raw = "";
        process.stdin.on("data", (chunk) => { raw += chunk; });
        process.stdin.on("end", () => {
          let entries = [];
          try { entries = JSON.parse(raw); } catch { return; }
          const label = (entry) => {
            const source = entry.afterSource ?? entry.beforeSource ?? entry.source ?? {};
            return source.filePath ?? source.id ?? source.packageName ?? source.type ?? "?";
          };
          for (const entry of entries.slice(0, 10)) {
            console.log(`${entry.op ?? "changed"} ${label(entry)}`);
          }
          if (entries.length > 10) console.log(`… and ${entries.length - 10} more`);
        });
      ')"
  if [[ -n "$sources" ]]; then
    details+="<details><summary>${platform}: changed fingerprint sources</summary>"$'\n\n```\n'
    details+="${sources}"$'\n```\n\n</details>\n\n'
  fi
done

if [[ "$changed" == true ]]; then
  verdict="the native build inputs **changed**"
elif [[ "$unknown" == true ]]; then
  verdict="**not determined** (a fingerprint is missing)"
else
  verdict="the native build inputs are **unchanged**"
fi

{
  echo "### Native fingerprint: base vs head"
  echo
  echo "| Platform | Base | Head | |"
  echo "| :--- | :--- | :--- | :--- |"
  printf '%s' "$rows"
  echo
  echo "Expo's fingerprint says ${verdict}."
  echo
  if [[ -n "${CURRENT_RULE_BUILDS:-}" ]]; then
    echo "The rule in force built the native apps for this pull request: **${CURRENT_RULE_BUILDS}**"
    echo "(same-repo \`renovate/*\` or \`maintenance/expo-sdk\` branch whose paths match the mobile filter)."
    echo
    if [[ "$changed" == true && "$CURRENT_RULE_BUILDS" == no ]]; then
      echo "> The rule skipped a pull request that changes the native build."
    elif [[ "$changed" == false && "$unknown" == false && "$CURRENT_RULE_BUILDS" == yes ]]; then
      echo "> The rule built native apps this pull request does not change."
    else
      echo "> The rule and the fingerprint agree."
    fi
    echo
  fi
  printf '%s' "$details"
  echo "Nothing is gated on this yet; see docs/agents/ci.md."
} >> "$out"
