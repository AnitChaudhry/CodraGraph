# Security Policy

## Reporting a vulnerability

**Please don't open a public issue for security reports.** Email
**security@thinqmesh.com** with subject line `[SECURITY] CodraGraph: <short title>`.

Include in the report:

- Affected package(s) — `@codragraph/cli`, `@codragraph/sdk`, `@codragraph/graphstore`, `@codragraph/harness`, `@codragraph/compress`, a plugin, or the web dashboard
- Affected version(s) (`npm view <pkg> version` or commit SHA)
- The vulnerability class (RCE, path traversal, prototype pollution, supply-chain, denial of service, secret exposure, etc.)
- A minimal reproduction (commands, payload, expected vs observed)
- Whether you've seen the issue exploited in the wild

## What to expect

- **Acknowledgement** within 72 hours.
- A **disclosure timeline** agreed with the reporter, defaulting to 90 days
  from triage to public advisory. Critical vulnerabilities (RCE, supply-chain
  trust break) get prioritized and may go faster.
- **Credit** in the published advisory + CHANGELOG, unless the reporter
  prefers to remain anonymous.

## Supported versions

Pre-1.0 the latest minor receives security fixes. Older minors are
out-of-scope. Once a 1.0 lands, the latest two minors will be supported.

## Out of scope

- Vulnerabilities in third-party LLM providers (Anthropic, OpenAI, OpenCode)
  themselves — report those upstream.
- Issues that require a malicious local user with write access to
  `~/.codragraph/config.json` or the local repo (the threat model assumes
  the user trusts their own machine).
- Self-XSS in the local web dashboard when the user paste-injects content.

## Hall of fame

We list reporters in the public advisory after a fix lands. If you'd like to
be left out of the list, say so in your initial report.
