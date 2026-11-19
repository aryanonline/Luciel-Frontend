# Contributing

Thanks for your interest in Luciel.

## Questions, bugs and ideas

Open an issue on GitHub. For a security problem, follow [`SECURITY.md`](SECURITY.md) instead of
opening a public issue.

## Pull requests

Luciel is maintained by one developer and does not take outside pull requests at the moment. You
are welcome to fork it under the [AGPL-3.0](LICENSE) and to suggest a change in an issue.

## Working on the code

- Run the whole product with Docker: see
  [Run Luciel on your computer](README.md#run-luciel-on-your-computer).
- Run the frontend alone on its mock adapters: see [Local development](README.md#local-development).
- Before a change is done, these pass from the repository root:

  ```bash
  pnpm -r typecheck
  pnpm --filter @luciel/web typecheck:tests
  pnpm -r test
  pnpm -r build
  pnpm format
  ```

- The `CLAUDE.md` files are the working guides to each part of the codebase: the product rules
  the code keeps, where things live and the tests that pin them.
