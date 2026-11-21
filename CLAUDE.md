# CLAUDE.md

See @AGENTS.md for project coding standards.

## Claude Code only

These add to AGENTS.md and CONTRIBUTING.md, using Claude Code features other harnesses may lack.

- **Run `/simplify` on code and docs before each commit**, ahead of the gates in [After making changes](AGENTS.md#after-making-changes), so its edits are linted and formatted too. Run it again before an amend that changes code or docs, but not one that only rewords the message.
- **Keep its fixes to what you changed, and its reuse findings within one package** ([Public APIs](AGENTS.md#public-apis)).
- **`/simplify` does not look for bugs;** use `/code-review` for that.
