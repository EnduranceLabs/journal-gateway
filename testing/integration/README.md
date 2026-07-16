# Integration Tests

These tests run the real gateway process against the service-side client
libraries with no MCP servers configured. They verify connection lifecycle,
authentication, version pulls, and disconnect handling.

## Suites

| Path | What it covers | Root command |
|------|----------------|--------------|
| [`ts/`](./ts) | TypeScript client library with the real gateway | `pnpm test:integration` |
| [`python/`](./python) | Python client library with the real gateway | none; run manually |

`pnpm test:all` includes the TypeScript integration suite through
`pnpm test:integration`. The Python integration suite is separate from the root
scripts.

## Run manually

Build the gateway first:

```bash
pnpm -r build
```

Run the TypeScript suite:

```bash
pnpm test:integration
```

Run the Python suite:

```bash
PYTHON_BIN=${PYTHON:-python3}
"$PYTHON_BIN" -m venv clients/python/.venv
. clients/python/.venv/bin/activate
python -m pip install -q --upgrade pip
python -m pip install -q -e "./clients/python[dev]"
pytest testing/integration/python
```
