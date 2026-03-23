# AGENTS.md

## Package Manager

- This project uses `pnpm` only.
- Never use `npm`.
- Never generate or commit `package-lock.json` or `npm-shrinkwrap.json`.
- Use the existing `pnpm-lock.yaml` as the source of truth for dependency resolution.

## Dependency Commands

- Install dependencies with `pnpm install`.
- Add dependencies with `pnpm add <package>`.
- Add dev dependencies with `pnpm add -D <package>`.
- Remove dependencies with `pnpm remove <package>`.
- Run scripts with `pnpm <script>` or `pnpm run <script>`.

## Enforcement

- `package.json` includes a `preinstall` guard that fails installs when the package manager is not `pnpm`.
- `package.json` pins the package manager via the `packageManager` field.
