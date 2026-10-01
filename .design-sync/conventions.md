# Play WSRC — how to build with this system

Play WSRC is the member and admin app of a squash club (ladder, leagues, tournaments, court booking). These components render the app's real markup and class names, and `styles.css` is the app's own stylesheet, so a design built here converts straight back into the app.

## Setup

No provider or wrapper is needed: components are styled by `styles.css` alone. A full page starts with `<AppShell>` (navy sidebar, white top bar, grey scrolling content area). Put the page inside it, and one primary `<Button size="sm">` in `actions`.

```jsx
const { AppShell, Button, Icon, Tabs, GroupCard, StatusBadge } = window.PlayWSRC;

<AppShell role="admin" activePage="tournaments" title="Spring Open 2026" back
  actions={<Button variant="primary" size="sm" icon={<Icon name="plus" />}>Add match</Button>}>
  <div className="tr-detail">
    <div className="tr-detail-meta">
      <StatusBadge status="active">Group Stage</StatusBadge>
      <span className="tr-detail-champ-date">Championship: Saturday, April 18</span>
    </div>
    <Tabs variant="underline" tabs={['Groups', 'Bracket']} active="Groups" />
    <div className="tr-groups-grid">
      <GroupCard name="A" standings={[{ name: 'Sam Patel', wins: 2, losses: 0, advances: true }]} />
    </div>
  </div>
</AppShell>
```

## Styling idiom

Use components first. For your own layout glue, use the app's CSS custom properties with plain CSS or inline styles. Never invent colours.

| Role | Tokens |
|---|---|
| Brand / actions | `--primary` #1e2758 navy, `--primary-hover`, `--navy-deep` (big figures) |
| Surfaces | `--bg` page grey, `--surface` white, `--surface-2` tint |
| Text | `--text`, `--text-muted`, `--text-muted-2` |
| Lines | `--border`, `--border-soft`, `--divider` |
| Meaning | `--win` / `--win-bg`, `--loss` / `--loss-bg`, `--warning` / `--warning-light`, `--you` (the signed-in player, blue) |
| Placings | `--gold`, `--silver`, `--bronze` |
| Shape | `--radius` 8px, `--radius-lg` 12px, `--shadow`, `--shadow-md`, `--page-pad` 24px |

Type: body is Inter 13.5px. Headings, big numbers and scores are Barlow 700/800 (`font-family: 'Barlow'`); every `h1`–`h6` already gets Barlow. Small uppercase headings use `<SectionLabel>`.

Layout classes worth reusing: `league-grid` (auto-fill card grid, 300px min), `tr-groups-grid` (two columns, one on phones), `tr-detail` (tournament page body, 960px max).

## Rules the app keeps

- Exactly one `variant="primary"` button per screen; everything beside it is `secondary`. Cancel comes before the primary in `<FormActions>`.
- State is a `<Pill>` (never clickable). The kind of competition is a `<Chip>`. A league or tournament's lifecycle is a `<StatusBadge>`.
- Forms: `<FormField label>` wrapping `<Input>`, `<Select>` or `<Textarea>`, ending in `<FormActions>`. They live in a `<Modal>` (480px, `size="medium"` 580px, `size="wide"` 920px).
- An empty list is `<TableCard><EmptyState title>…</EmptyState></TableCard>`.
- Scores are best of five (3–0, 3–1, 3–2). Enter them with `<ScorePicker>` in a `<Modal title="Score Entry" size="medium">`.
- Any match opens as a `<MatchCard>`.
- Below 768px the sidebar becomes a drawer and grids collapse to one column; keep designs usable at phone width.

## Where the truth lives

`styles.css` imports `_ds_bundle.css`, the app's full stylesheet. Read its `:root` block for tokens and its `COMPONENTS` section for the shared class vocabulary (`.btn`, `.pill`, `.chip`, `.tabbar`, `.section-label`). Each component's `.prompt.md` and `.d.ts` give its props.
