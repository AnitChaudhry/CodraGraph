---
name: codragraph-gh-release-workflow
description: "Use for the release workflow — semver bump, tag, generate release notes, attach assets, draft vs published, prerelease tagging, and propagating to npm. Examples: \"cut a release\", \"create a GitHub release\", \"draft release notes\", \"upload binaries to release\", \"prerelease v2 alpha\""
---

# Release Workflow with `gh`

## When to Use

- "Cut a 1.7.0 release."
- "Draft release notes from commits."
- "Attach the built binaries to the release."
- "Mark this as a prerelease (alpha / beta / RC)."
- "Re-publish notes after I edited them."

## Pre-release checklist (do these BEFORE `gh release create`)

```
- [ ] Branch is main / release/x.y, fully synced
- [ ] CHANGELOG.md updated (or ready to be auto-generated)
- [ ] Version bumped in package.json / Cargo.toml / pyproject.toml
- [ ] All commits since last tag intentional (no leftover wip)
- [ ] CI green on the release commit (gh pr checks <N>)
- [ ] codragraph diff <last-tag> HEAD --semantic — review removed APIs
      (any removed public API = SemVer major; document loudly in notes)
```

## Cutting the release

```bash
# 1. Bump + commit version
npm version 1.7.0 --no-git-tag-version            # or pnpm version, or manual edit
git add package.json package-lock.json
git commit -m "chore(release): 1.7.0"
git push origin main

# 2. Tag (annotated, signed if you have GPG):
git tag -a v1.7.0 -m "Release 1.7.0"              # annotated
git tag -s v1.7.0 -m "Release 1.7.0"              # signed (requires GPG setup)
git push origin v1.7.0

# 3. Create GitHub release. Auto-generate notes from commits since the previous tag:
gh release create v1.7.0 --generate-notes
```

`--generate-notes` uses `.github/release.yml` (if present) for category
filtering, or falls back to a flat list of commit titles.

## Custom notes

```bash
# Notes from a file:
gh release create v1.7.0 --notes-file RELEASE_NOTES.md

# Inline (HEREDOC, the right way):
gh release create v1.7.0 --notes "$(cat <<'EOF'
## What's new
- npx zero-install entry — no more 3-step setup
- PR review GitHub Action (deterministic + LLM modes)
- 17 built-in workflow skills

## Breaking
- None.

## Upgrade
\`\`\`
npm i -g @codragraph/cli@1.7.0
\`\`\`
EOF
)"

# Edit notes after publishing:
gh release edit v1.7.0 --notes-file new-notes.md
```

## Attach assets

```bash
# After creating the release, upload binaries / source bundles:
gh release upload v1.7.0 dist/cli-linux-x64.tar.gz dist/cli-darwin-arm64.tar.gz

# Or in one shot at create time:
gh release create v1.7.0 dist/*.tar.gz dist/*.zip --generate-notes
```

## Draft vs published vs prerelease

```bash
# Draft (visible only to maintainers, not yet announced):
gh release create v1.7.0 --draft --generate-notes

# Promote draft → published:
gh release edit v1.7.0 --draft=false

# Prerelease (alpha / beta / RC — semver string ends with -alpha.N etc.):
gh release create v2.0.0-alpha.1 --prerelease --generate-notes

# Mark an existing release as latest (otherwise GitHub picks by semver):
gh release edit v1.7.0 --latest
```

## Re-publish a release after editing

```bash
# View existing release:
gh release view v1.7.0

# Edit notes:
gh release edit v1.7.0 --notes-file fixed-notes.md

# Upload missing asset:
gh release upload v1.7.0 dist/cli-windows-x64.zip
```

## Coordinating with npm publish

For a TypeScript / Node package, the GitHub release and the npm publish
are TWO separate events:

```bash
# Order: tag → npm publish → GH release (so the release links a version
# users can `npm install`).

git tag v1.7.0 && git push origin v1.7.0
npm publish --access public                       # for scoped packages
gh release create v1.7.0 --generate-notes
```

You can automate this in a workflow that triggers on `push` of a `v*` tag:

```yaml
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci && npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

## Why CodraGraph helps here

The structural diff between two tags is the most honest changelog you'll
ever produce — it's derived from the graph, not from commit messages
that lie:

```bash
codragraph diff v1.6.4 v1.7.0 --semantic --json > /tmp/diff.json

# What changed:
jq '.semantic.addedAPIs | length, .semantic.removedAPIs | length, .semantic.classifiedModifications | length' /tmp/diff.json

# Generate a structured "API changes" section for the release notes:
jq -r '
  "### Added APIs\n" +
  ([.semantic.addedAPIs[] | "- `" + (.name // .id) + "`"] | join("\n")) +
  "\n\n### Removed APIs (BREAKING)\n" +
  ([.semantic.removedAPIs[] | "- `" + (.name // .id) + "`"] | join("\n"))
' /tmp/diff.json
```

Removed APIs = SemVer major. Modified signatures with parameter-count
changes = SemVer major. Use this to keep your bump honest.

## Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Forgot to push the tag | GH release creation fails | `git push origin v1.7.0` |
| `npm publish` before the tag | Tag not on the published commit | publish AFTER pushing the tag |
| Removed an API but bumped only minor | Breaking change in non-major release | Always run `codragraph diff <prev> HEAD --semantic` and bump major if removedAPIs is non-empty |
| `--generate-notes` produces noise | All commit messages flat-listed | Add `.github/release.yml` to categorize by labels / paths |
| Wrong release marked `latest` | Older release stays as latest | `gh release edit <new-version> --latest` |
| Released a prerelease as stable | Users on `latest` channel get unstable code | Always `--prerelease` for alpha / beta / RC |
```
