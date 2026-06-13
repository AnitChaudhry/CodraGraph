# CodraGraph Team Graph Platform

CodraGraph's team mode treats the graph as a shared, versioned understanding layer for a repository.

## Core Loop

1. CI runs `codragraph analyze`.
2. CI runs `codragraph semantic analyze` to extract developer-intent relationship families.
3. CI runs `codragraph graphpack publish --target main|pr`.
4. CI uploads `.codragraph/graphstore/**` and `.codragraph/graphpacks/**` as GitHub artifacts.
5. The repo commits only `.codragraph/index.lock.json` plus optional small structure files.
6. Developers run `codragraph bootstrap` after clone or checkout.
7. Agents answer from canonical graphpack, PR overlay, or local graph and should report the source.

## Storage Contract

- Commit: `.codragraph/index.lock.json`.
- Keep local: `.codragraph/cgdb`, `.codragraph/graphstore`, `.codragraph/graphpacks`, `.codragraph/semantic-relationships.json`.
- Artifact: graphstore CAS chunks, graphpack manifest, metadata, semantic relationship report.

The lock stays thin by storing the graphstore CAS digest and manifest checksum instead of every object checksum.

Artifact roots should preserve the same paths used inside `.codragraph`:

```text
index.lock.json
meta.json
graphstore/**
graphpacks/<target-or-id>/manifest.json
semantic-relationships.json
```

`codragraph graphpack pull --artifact-dir <dir>` accepts either that artifact root, a repo root containing `.codragraph`, or the manifest directory itself. Pull copies referenced chunks into the local `.codragraph` cache and then verifies the lock with strict checksums before reporting the graph as materializable.

## Commands

```bash
codragraph bootstrap
codragraph graphpack publish --target main --repo my-org/my-repo
codragraph graphpack pull
codragraph graphpack status
codragraph semantic analyze
codragraph context-pack Settings --compress balanced
codragraph recipes lookup --task-family codebase-qa --required-subgraph-signature subgraph:settings:v1
codragraph team serve --graphpack gpk_main_...
```

## Semantic Relationships

The deterministic extractor adds a provenance layer above raw graph edges:

- `COMPOSES`
- `ADAPTS`
- `DELEGATES_TO`
- `WRAPS`
- `CONFIGURES`
- `FACTORY_CREATES`
- `ORCHESTRATES`
- `PROXIES_TO`
- `MAPS_TO`

Every semantic edge includes source/target, confidence, evidence, extractor version, and provenance.

## GitHub Action

Use `.github/actions/codragraph-graphpack-publish` from a workflow after checkout:

```yaml
- uses: ./.github/actions/codragraph-graphpack-publish
  with:
    target: main
    repo: ${{ github.repository }}
```
