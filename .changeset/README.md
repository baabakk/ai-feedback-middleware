# Changesets

This directory contains "changesets" — small markdown files describing changes that affect package versions.

When you make a user-facing change, run `pnpm changeset` and follow the prompts. The changeset file is committed alongside your code.

When PRs merge to main, a release PR is automatically opened that bumps versions and updates CHANGELOGs based on the accumulated changesets.

See [Changesets documentation](https://github.com/changesets/changesets) for details.
