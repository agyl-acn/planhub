# Planhub v0.2

Personal planner: KPI, projects with Kanban, mind dump, calendar, and an optional time tracker.

## Run
Needs Node 18 or newer. No `npm install`, there are no dependencies.

    node server.js

Open http://localhost:3000. Data lives in `data/db.json`.
Upgrading from v0.1: copy your old `data/db.json` into this folder. The format is compatible.

## Open it from your phone (same Wi-Fi)
1. Find the laptop IP: `ipconfig` (Windows) or `ip a` (Linux/Mac).
2. On the phone, open `http://<laptop-ip>:3000`.
3. If it does not load, allow Node through the Windows firewall for private networks.

There is no login yet. Keep it on your local network until auth lands.

## Changes in v0.2
- Today: quick add to-do, day timeline with free gaps, Set time with one-tap free slots.
- KPI: collapsible cards, Expand all / Collapse all, categories with filter and grouping.
- Time: logs grouped per activity with total h m s, project and KPI shown, This week / month / all.

## Options
    PORT=4000 node server.js
    DB_FILE=/path/db.json node server.js

PowerShell: `$env:PORT=4000; node server.js`
