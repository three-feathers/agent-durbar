#!/usr/bin/env bash
# Creates (or reuses) the org Project "Agent Durbar board", sets the Status options and the custom fields (Spec ID, Owner,
# Area), links it to the repo, makes it public, and adds the open issues with Status, Spec ID, Owner and Area filled from
# their labels and assignees. Safe to re-run: it never resets a Status that someone already moved, and it only rewrites the
# Status options when they differ (rewriting them would drop every item's Status).
#
# Needs: `gh` logged in with the `project` token scope (read:project is not enough) and org permission to create projects.
# Grant it yourself in your own terminal: `gh auth refresh -s project`. This script never refreshes or prints tokens.
# Env: OWNER, REPO, VISIBILITY (PUBLIC default, or PRIVATE).
# Not scriptable (GitHub has no API to enable or edit them; do in the Project's web UI, Settings > Workflows): auto-add new
# issues, and auto-set Status when an issue is closed, a PR is linked or a PR is merged. The end of this script prints
# which built-in workflows are currently on.
set -euo pipefail
OWNER="${OWNER:-three-feathers}"; REPO="${REPO:-three-feathers/agent-durbar}"; TITLE="Agent Durbar board"
VISIBILITY="${VISIBILITY:-PUBLIC}"
STATUSES='["Todo","Claimed","In progress","In review","Done"]'
AREAS="ui,adapters,permissions,mcp,usage,packaging,platform,docs,ci,harness"

if ! gh auth status 2>&1 | grep -q "'project'"; then
  echo "The gh token lacks the 'project' scope. Run: gh auth refresh -s project   (then re-run this script)" >&2; exit 1
fi

num="$(gh project list --owner "$OWNER" --limit 100 --format json --jq ".projects[] | select(.title==\"$TITLE\") | .number" | head -n 1 || true)"
if [ -z "$num" ]; then
  num="$(gh project create --owner "$OWNER" --title "$TITLE" --format json --jq .number)"
  echo "created project #$num"
else echo "project #$num exists"; fi
pid="$(gh project view "$num" --owner "$OWNER" --format json --jq .id)"

# Link to the repo (so it shows in the repo's Projects tab). Errors other than "already linked" are shown.
linked="$(gh api graphql -f query='query($o:String!,$r:String!){repository(owner:$o,name:$r){projectsV2(first:50){nodes{number}}}}' \
  -f o="${REPO%%/*}" -f r="${REPO##*/}" --jq ".data.repository.projectsV2.nodes[] | select(.number==$num) | .number" || true)"
if [ -z "$linked" ]; then gh project link "$num" --owner "$OWNER" --repo "$REPO" && echo "linked to $REPO"; else echo "already linked to $REPO"; fi

# Visibility: the repo is public, so the board is too. An org can forbid public projects; then this only warns.
if gh project edit "$num" --owner "$OWNER" --visibility "$VISIBILITY" >/dev/null; then echo "visibility $VISIBILITY"
else echo "warning: could not set visibility $VISIBILITY (org policy?)" >&2; fi

fields() { gh project field-list "$num" --owner "$OWNER" --limit 100 --format json; }
F="$(fields)"

# Status: replace the default options (Todo, In Progress, Done) with ours, only when they differ.
status_id="$(jq -r '.fields[] | select(.name=="Status") | .id' <<<"$F")"
if [ "$(jq -c '[.fields[] | select(.name=="Status") | .options[].name]' <<<"$F")" != "$STATUSES" ]; then
  gh api graphql -f query='
  mutation($field:ID!){ updateProjectV2Field(input:{fieldId:$field, singleSelectOptions:[
    {name:"Todo",color:GRAY,description:"Open, nobody has it"},
    {name:"Claimed",color:YELLOW,description:"Assigned + status:claimed, not started"},
    {name:"In progress",color:ORANGE,description:"Branch exists"},
    {name:"In review",color:BLUE,description:"PR open"},
    {name:"Done",color:GREEN,description:"Merged / closed"}]}){ projectV2Field{ ... on ProjectV2SingleSelectField{ id } } } }' \
    -f field="$status_id" >/dev/null
  echo "Status options set"
else echo "Status options already set"; fi

has() { jq -e --arg n "$1" '.fields[] | select(.name==$n)' <<<"$F" >/dev/null; }
has "Spec ID" || gh project field-create "$num" --owner "$OWNER" --name "Spec ID" --data-type TEXT >/dev/null
has "Owner"   || gh project field-create "$num" --owner "$OWNER" --name "Owner" --data-type TEXT >/dev/null
has "Area"    || gh project field-create "$num" --owner "$OWNER" --name "Area" --data-type SINGLE_SELECT \
  --single-select-options "$AREAS" >/dev/null

F="$(fields)"
fid() { jq -r --arg n "$1" '.fields[] | select(.name==$n) | .id' <<<"$F"; }
oid() { jq -r --arg n "$1" --arg o "$2" '.fields[] | select(.name==$n) | .options[]? | select(.name==$o) | .id' <<<"$F"; }

# Existing items (issue number -> item id, current Status), so a re-run does not move cards someone already moved.
items="$(gh project item-list "$num" --owner "$OWNER" --limit 500 --format json)"

gh issue list --repo "$REPO" --state open --limit 200 --json number,url,labels,assignees | jq -c '.[]' | while read -r issue; do
  n="$(jq -r .number <<<"$issue")"; url="$(jq -r .url <<<"$issue")"
  item="$(jq -r --argjson n "$n" '.items[] | select(.content.number==$n) | .id' <<<"$items" | head -n 1)"
  cur="$(jq -r --argjson n "$n" '.items[] | select(.content.number==$n) | .status // empty' <<<"$items" | head -n 1)"
  [ -n "$item" ] || item="$(gh project item-add "$num" --owner "$OWNER" --url "$url" --format json --jq .id </dev/null)"
  labels="$(jq -r '[.labels[].name]|join(" ")' <<<"$issue")"
  status="${cur:-Todo}"
  if [ -z "$cur" ]; then
    case " $labels " in *" status:claimed "*) status="Claimed";; esac
    gh project item-edit --id "$item" --project-id "$pid" --field-id "$(fid Status)" --single-select-option-id "$(oid Status "$status")" >/dev/null </dev/null
  fi
  spec="$(printf '%s' "$labels" | tr ' ' '\n' | sed -n 's/^spec:\([0-9]\{3\}\)$/\1/p' | head -n 1)"
  [ -z "$spec" ] || gh project item-edit --id "$item" --project-id "$pid" --field-id "$(fid "Spec ID")" --text "$spec" >/dev/null </dev/null
  owner="$(jq -r '.assignees[0].login // empty' <<<"$issue")"
  [ -z "$owner" ] || gh project item-edit --id "$item" --project-id "$pid" --field-id "$(fid Owner)" --text "$owner" >/dev/null </dev/null
  area="$(printf '%s' "$labels" | tr ' ' '\n' | sed -n 's/^area:\(.*\)$/\1/p' | head -n 1)"
  if [ -n "$area" ] && [ -n "$(oid Area "$area")" ]; then
    gh project item-edit --id "$item" --project-id "$pid" --field-id "$(fid Area)" --single-select-option-id "$(oid Area "$area")" >/dev/null </dev/null
  fi
  echo "#$n on the board (Status $status, spec ${spec:--})"
done

echo "Built-in workflows (on/off; switch them in the web UI):"
gh api graphql -f query='query($p:ID!){node(id:$p){... on ProjectV2{workflows(first:20){nodes{name enabled}}}}}' -f p="$pid" \
  --jq '.data.node.workflows.nodes[] | "  \(if .enabled then "on " else "off" end) \(.name)"'
echo "Board: https://github.com/orgs/$OWNER/projects/$num"
