# Meta India — Pantry Inventory (React + Node.js)

A pantry inventory dashboard with 5 screens: **Dashboard, Receive GRN, Distribute, Stock Update, Settings**.

## How the two parts work together

```
┌──────────────────┐         HTTP requests          ┌──────────────────┐
│  React frontend   │  ───────────────────────────► │  Node.js backend  │
│  (what you SEE)   │   GET /api/dashboard etc.     │  (stores the DATA)│
│  localhost:5173   │  ◄─────────────────────────── │  localhost:5000   │
└──────────────────┘         JSON responses         └──────────────────┘
```

## Step 1 — Run the backend (Node.js)

```bash
cd backend
npm install        # downloads Express + CORS (one time only)
node server.js     # starts the API on http://localhost:5000
```

Test it: open **http://localhost:5000/api/dashboard** in your browser — you should see JSON data.

## Step 2 — Run the frontend (React)

```bash
# In a NEW terminal window:
npm create vite@latest pantry-frontend -- --template react
cd pantry-frontend
npm install
```

Then:
1. Copy `PantryDashboard.jsx` into `pantry-frontend/src/`
2. Replace the contents of `src/App.jsx` with:

```jsx
import PantryDashboard from "./PantryDashboard";
export default function App() {
  return <PantryDashboard />;
}
```

3. Run it:

```bash
npm run dev        # opens http://localhost:5173
```

## Step 3 (later) — Connect frontend to backend

Right now the React app uses built-in sample data so it works on its own.
When you're ready, replace the sample data with API calls, e.g.:

```jsx
import { useState, useEffect } from "react";

// inside the component:
useEffect(() => {
  fetch("http://localhost:5000/api/dashboard")
    .then((res) => res.json())
    .then((data) => setCategories(data.categories));
}, []);
```

Look for comments marked `// API: ...` in `PantryDashboard.jsx` — each one
tells you which backend endpoint that action should call.

## API endpoints reference

| Method | URL                      | What it does                          |
|--------|--------------------------|---------------------------------------|
| GET    | /api/dashboard           | Stats + category health table         |
| GET    | /api/grn                 | Pending inbound delivery              |
| POST   | /api/grn/acknowledge     | Accept delivery, add qty to stock     |
| GET    | /api/stock               | Stock counts with days-left calculated|
| POST   | /api/stock               | Submit new physical counts            |
| POST   | /api/distribute          | Confirm floor-wise allocation         |
| GET    | /api/locations           | List mini-kitchen locations           |
| POST   | /api/locations           | Add a location                        |
| PUT    | /api/locations/:id       | Edit a location                       |
| DELETE | /api/locations/:id       | Delete a location                     |

## Key logic to understand

**Days left = physical count ÷ daily consumption.**
Status is then: under 2 days → Critical, under 4 days → Low, otherwise Healthy.
This one formula drives the colors and pills across the whole app.
