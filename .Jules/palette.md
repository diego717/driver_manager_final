## 2025-05-22 - Dynamic Brand Filtering and Accessibility
**Learning:** In PyQt6, when dynamically updating a `QComboBox` that is linked to a filter signal, it is critical to use `blockSignals(True)` before `clear()` and `addItems()`, and `blockSignals(False)` after, to avoid triggering redundant filtering logic or index errors while the list is in a transient state.
**Action:** Always wrap `QComboBox` updates with `blockSignals` if they have connected `currentTextChanged` or `currentIndexChanged` slots.

## 2026-02-13 - Visual Upgrades and Rich Previews
**Learning:** Transitioning from plain text to rich HTML (via `setHtml`) in UI previews significantly improves information hierarchy and user engagement. Using Qt dynamic properties (e.g., `setProperty("class", "big")`) allows for cleaner separation of concerns by keeping styles in a central theme manager rather than hardcoding them in components.
**Action:** Favor centralizing styles in `ThemeManager` using CSS classes and utilize HTML for complex data previews.
