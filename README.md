# Obsidian Kanban (with Calendar View)

> **Fork notice.** This is a fork of [mgmeyers/obsidian-kanban](https://github.com/mgmeyers/obsidian-kanban) (originally maintained at [obsidian-community/obsidian-kanban](https://github.com/obsidian-community/obsidian-kanban)). All credit for the base plugin belongs to its original authors. This fork adds a **calendar view** on top of the existing board / table / list views.

Maintainer of this fork: **[Miłosz Zając — Netfly.pl](https://github.com/netflyapp)**

---

## What's new in this fork

A fourth view option — **Calendar** — added next to the existing **Board / Table / List** views in the view-switcher dropdown.

![view switcher](https://placehold.co/400x200?text=View+as+calendar)

### Calendar features

- **Two layouts**: monthly grid (6×7 days) and weekly grid (Google Calendar–style hour timeline, 00:00–24:00, 40 px per hour)
- **Drag-and-drop scheduling**:
  - Drop a card on a day → sets the date (preserves time)
  - Drop a card on a specific hour slot in week view → sets date **and** time (snapped to 15 min)
  - Drop a card on the *all-day* strip → sets the date and clears the time
  - Drop a card on the **Unscheduled** sidebar → removes the date
- **Click to create** — click any empty day or empty hour slot to open a modal that adds a new card with the date (and time, if you clicked on a slot) prefilled
- **Click to edit** — click any card on the calendar to edit its title, time, or delete it
- **Time field** — modal includes a `<input type="time">` so you can attach an `HH:mm` to any card
- **Visual highlights** — today's day is accented; the drop target gets a thicker accent border while you drag
- **Unscheduled sidebar** — lists every card that has no date so you can drag them onto the calendar

### How dates and times are stored

The plugin uses the existing kanban metadata triggers — your cards stay 100 % markdown:

```
- [ ] Doctor's appointment @{2026-04-29} @@{14:30}
```

| Trigger | Meaning | Example | Default config key |
|---|---|---|---|
| `@{...}` | Date (parsed via `date-format`, default `YYYY-MM-DD`) | `@{2026-04-29}` | `date-trigger` |
| `@@{...}` | Time (parsed via `time-format`, default `HH:mm`) | `@@{14:30}` | `time-trigger` |

> If `link-date-to-daily-note` is enabled, dates are written as `@[[2026-04-29]]` instead of `@{...}` — calendar handles both.

The calendar reads `item.metadata.date` and `item.metadata.time`, so any card that already has a date in your existing boards shows up automatically.

### How drag-and-drop is wired

The calendar uses native HTML5 drag-and-drop (`draggable=true` + `dragstart` / `dragover` / `drop`). On drop, the card's `titleRaw` is rewritten with the new triggers and `stateManager.updateItemContent()` is called, which re-parses the card and persists the change to the markdown file.

The plugin's built-in HTML5 paste/drop handler (used to drop external files into a board) is **disabled while in calendar view** to prevent event-handler conflicts that previously caused drag flakiness.

### How creating a card works

The "create" flow uses `stateManager.getNewItem(titleRaw, ' ')` and pushes the new item into the selected lane's children via `boardModifiers.appendItems([laneIdx, 0], [newItem])`. Title raw is `"<your text> @{date} @@{time}"` (time only included if filled).

---

## How to switch to calendar view

1. Open any kanban board
2. Click the view button in the note's action bar (cube icon)
3. Choose **View as calendar**
4. Inside the calendar, use the **Month / Week** toggle in the top-right to switch layouts

Your choice is persisted per board in the file's frontmatter under `kanban-plugin: calendar`.

---

## Original Kanban plugin

For the full feature set of the underlying plugin (board/table/list, lane sorting, archives, settings, date triggers, formula support, etc.), see the original docs:

- 📖 [Obsidian Kanban Plugin Documentation](https://publish.obsidian.md/kanban/)
- 🐛 Issues with the **base** plugin: [mgmeyers/obsidian-kanban](https://github.com/mgmeyers/obsidian-kanban/issues)
- 🐛 Issues with the **calendar view** in this fork: [netflyapp/obsidian-kanban](https://github.com/netflyapp/obsidian-kanban/issues)

---

## Installation (manual)

This fork is not in the official Obsidian community plugins catalogue. Install it manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/netflyapp/obsidian-kanban/releases)
2. Copy them to `<your vault>/.obsidian/plugins/obsidian-kanban/`
3. In Obsidian, go to **Settings → Community plugins** → enable **Kanban**

Or use [BRAT](https://github.com/TfTHacker/obsidian42-brat) and add `netflyapp/obsidian-kanban` as a beta repository.

---

## Building from source

```bash
yarn install
yarn build         # production build → main.js, styles.css
yarn dev           # watch mode
yarn typecheck     # TypeScript-only check
```

---

## License

**GPL-3.0** — see [LICENSE.md](LICENSE.md). The original `obsidian-kanban` is licensed under GPL-3.0 (copyleft), so this fork inherits the same license. All original copyright and license notices are preserved.
