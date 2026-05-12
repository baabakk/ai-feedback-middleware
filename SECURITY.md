# Security Policy

## Supported versions

While the project remains at `0.x` only the latest minor line receives security
patches. Once `1.0.0` ships the supported-version table will be updated to
follow the typical N and N-1 minor cadence.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a vulnerability

**Please do not file a public GitHub issue for security problems.** Public
issue trackers signal a vulnerability to attackers before consumers can patch.

Instead, report privately through one of the channels below:

1. **GitHub Security Advisories (preferred).** Open a private advisory at
   `https://github.com/baabakk/ai-feedback-middleware/security/advisories/new`.
   GitHub notifies the maintainers and gives us a private workspace to
   coordinate the fix and CVE assignment.
2. **Email.** Send the report to the address listed in the project's
   `package.json` `author` field. Use the subject line
   `[security] ai-feedback-middleware: <one-line summary>`.

Please include:

- A description of the vulnerability and its impact.
- A minimal reproduction (script, code snippet, or curl invocation).
- The package(s) and version(s) affected.
- Your assessment of severity (low / medium / high / critical) and any
  mitigations you have already identified.

## What to expect

| Event                              | Target time                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Acknowledgment of the report       | Within 3 working days                                                                    |
| Initial assessment + severity call | Within 7 working days                                                                    |
| Patch released                     | Within 30 days for high/critical findings; longer for low/medium with public mitigations |
| Coordinated public disclosure      | After the patch ships and a reasonable upgrade window has passed                         |

We will keep you updated as we work through the issue, and will credit you in
the advisory unless you ask to remain anonymous.

## Out of scope

The following are not security issues for this project:

- Reports against the consumer's own deployment configuration (Postgres
  password rotation, Redis network exposure, etc). Those are application
  concerns even though they may interact with the framework.
- Theoretical attacks that require an already-compromised machine, root
  access, or out-of-band credentials.
- Denial of service caused by feeding pathological adapter inputs that the
  consumer has full control over (e.g. an attacker who can already write
  arbitrary rows to your event store).

## Hardening notes

Consumers can reduce blast radius by following these defaults:

- Treat `feedback_events.payload` as untrusted; validate before re-emitting.
- Run the outbox scanner with the advisory-lock leader-election option so a
  rogue replica cannot double-publish.
- Pin adapter versions and watch for advisory updates via Dependabot or a
  similar tool.
- Verify webhook signatures using the framework's `createWebhookCaptureAdapter`
  with a strong HMAC secret rotated at least quarterly.
