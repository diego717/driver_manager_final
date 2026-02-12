## 2025-05-22 - Dynamic Brand Filtering and Accessibility
**Learning:** In PyQt6, when dynamically updating a `QComboBox` that is linked to a filter signal, it is critical to use `blockSignals(True)` before `clear()` and `addItems()`, and `blockSignals(False)` after, to avoid triggering redundant filtering logic or index errors while the list is in a transient state.
**Action:** Always wrap `QComboBox` updates with `blockSignals` if they have connected `currentTextChanged` or `currentIndexChanged` slots.
