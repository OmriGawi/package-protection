# Frontend

React 19 + Vite + React Router. The Employee and Inventory Manager screens,
in RTL Hebrew.

```bash
cp .env.example .env
npm ci
npm run dev        # http://localhost:5173
```

`VITE_API_URL` points at the backend and is inlined at build time, not read at
runtime.

| Path | Holds |
|---|---|
| `src/App.tsx` | Routes |
| `src/api/client.ts` | The only module that knows the API's shape |
| `src/pages/` | One per route |
| `src/components/` | Reused across pages |
| `src/lib/` | Display formatting, hooks, label rules |

Screens are designed first in `../ui/index.html` — a standalone mockup, not
part of this build — and rebuilt here once settled.

See [../CONTRIBUTING.md](../CONTRIBUTING.md) for the gates and the workflow,
and [../docs/user-flows.md](../docs/user-flows.md) for what each screen does.
