# Sidebar ref badges

Only sidebar CommitRow instances use SidebarRefBadges. Other locations retain the
existing row-meta rendering. The component consumes the existing ordered live and
ghost badge lists after graph-side ref-movement endpoints have been excluded.
It does not change graph facts, lane placement, Reflog visibility or ref identity.

Short subjects keep badges immediately after the text. Longer subjects shrink
first. ResizeObserver measures the row heading, unshortened badge content and the
overflow counter with the active font. Available space accounts for fixed row
markers and a small subject allowance. Names switch to icons before a long subject would have less than a 80px preview.
Short subjects reserve only their natural width. The icon/overflow budget still
uses the smaller subject allowance, so earlier icon switching does not hide
additional refs. Badges switch as a group from names to
20px type icons, then retain the leading icons and an exact +N overflow count.
On very narrow rows, history classification text can shrink to preserve a minimal
ref indicator. Empty ref lists do not create a badge area.

Local/special refs use a laptop, remote refs a cloud, and tags a tag outline.
Existing route colors, ghost dashes and default status are retained. Tooltips
and accessible names keep full ref identities; the overflow tooltip lists its
hidden refs. Measurement copies are invisible, non-interactive and aria-hidden.
Clicking a badge continues to select the commit through its existing row button.

Checks: sidebar-ref-presentation, sidebar-ref-badges and sidebar-ref-row tests.
Browser layout checks should use the real React row at multiple widths, including
long subjects, long/multiple refs, PREVIOUS/deleted routes and Linked Worktree rows.
Native VS Code rendering is a separate validation step.

The sidebar canvas reserves 96px beyond the required graph/content origin before
horizontal scrolling, instead of 120px. Messages may shrink further within that
area; ref icons and overflow counts retain their priority. Graph geometry and
minimum widths in editor and bottom-panel presentations are unchanged.
