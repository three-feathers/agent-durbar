#!/usr/bin/env bash
# Creates (or reuses) the org Project "Agent Durbar board", sets the Status options and the custom fields, and adds the
# open issues with Status, Spec ID and Area filled from their labels. Safe to re-run.
#
# Needs: `gh` logged in with the `project` token scope (read:project is not enough) and org permission to create projects.
# Grant it yourself in your own terminal: `gh auth refresh -s project`. This script never refreshes or prints tokens.
# Not scriptable (do in the Project's web UI, Settings > Workflows): auto-add new issues, auto-set Status when a PR is
# opened/merged or an issue is closed.
set -euo pipefail
OWNER="${OWNER:-three-feathers}"; REPO="${REPO:-three-feathers/agent-durbar}"; TITLE="Agent Durbar board"

if ! gh auth status 2>&1 | grep -q "'project'"; then
  echo "The gh token lacks the 'project' scope. Run: gh auth refresh -s project   (then re-run this script)" >&2; exit 1
fi

num="$(gh project list --owner "$OWNER" --format json --jq ".projects[] | select(.title==\"$TITLE\") | .number" | head -n 1)"
if [ -z "$num" ]; then
  num="$(gh project create --owner "$OWNER" --title "$TITLE" --format json --jq .number)"
  echo "created project #$num"
else echo "project #$num exists"; fi
pid="$(gh project view "$num" --owner "$OWNER" --format json --jq .id)"
gh project link "$num" --owner "$OWNER" --repo "$REPO" >/dev/null 2>&1 || true

fields() { gh project field-list "$num" --owner "$OWNER" --format json; }

# Status: replace the default options (Todo, In Progress, Done) with ours.
status_id="$(fields | jq -r '.fields[] | select(.name=="Status") | .id')"
gh api graphql -f query='
mutation($field:ID!){ updateProjectV2Field(input:{fieldId:$field, singleSelectOptions:[
  {name:"Todo",color:GRAY,description:"Open, nobody has it"},
  {name:"Claimed",color:YELLOW,description:"Assigned + status:claimed, not started"},
  {name:"In progress",color:ORANGE,description:"Branch exists"},
  {name:"In review",color:BLUE,description:"PR open"},
  {name:"Done",color:GREEN,description:"Merged / closed"}]}){ projectV2Field{ ... on ProjectV2SingleSelectField{ id } } } }' -f field="$status_id" >/dev/null
echo "Status options set"

has() { fields | jq -e --arg n "$1" '.fields[] | select(.name==$n)' >/dev/null; }
has "Spec ID" || gh project field-create "$num" --owner "$OWNER" --name "Spec ID" --data-type TEXT >/dev/null
has "Owner"   || gh project field-create "$num" --owner "$OWNER" --name "Owner" --data-type TEXT >/dev/null
has "Area"    || gh project field-create "$num" --owner "$OWNER" --name "Area" --data-type SINGLE_SELECT \
  --single-select-options "ui,adapters,permissions,mcp,usage,packaging,platform,docs,ci,harness" >/dev/null

F="$(fields)"
fid() { printf '%s' "$F" | jq -r --arg n "$1" '.fields[] | select(.name==$n) | .id'; }
oid() { printf '%s' "$F" | jq -r --arg n "$1" --arg o "$2" '.fields[] | select(.name==$n) | .options[]? | select(.name==$o) | .id'; }

gh issue list --repo "$REPO" --state open --limit 200 --json number,url,labels,assignees | jq -c '.[]' | while read -r issue; do
  url="$(jq -r .url <<<"$issue")"
  item="$(gh project item-add "$num" --owner "$OWNER" --url "$url" --format json --jq .id)"
  labels="$(jq -r '[.labels[].name]|join(" ")' <<<"$issue")"
  status="Todo"; case " $labels " in *" status:claimed "*) status="Claimed";; esac
  gh project item-edit --id "$item" --project-id "$pid" --field-id "$(fid Status)" --single-select-option-id "$(oid Status "$status")" >/dev/null
  spec="$(printf '%s' "$labels" | tr ' ' '\n' | sed -n 's/^spec:\([0-9]\{3\}\)$/\1/p' | head -n 1)"
  [ -z "$spec" ] || gh project item-edit --id "$item" --project-id "$pid" --field-id "$(fid "Spec ID")" --text "$spec" >/dev/null
  owner="$(jq -r '.assignees[0].login // empty' <<<"$issue")"
  [ -z "$owner" ] || gh project item-edit --id "$item" --project-id "$pid" --field-id "$(fid Owner)" --text "$owner" >/dev/null
  area="$(printf '%s' "$labels" | tr ' ' '\n' | sed -n 's/^area:\(.*\)$/\1/p' | head -n 1)"
  if [ -n "$area" ] && [ -n "$(oid Area "$area")" ]; then
    gh project item-edit --id "$item" --project-id "$pid" --field-id "$(fid Area)" --single-select-option-id "$(oid Area "$area")" >/dev/null
  fi
  echo "added $url (Status $status, spec ${spec:--})"
done
echo "Board: https://github.com/orgs/$OWNER/projects/$num"
