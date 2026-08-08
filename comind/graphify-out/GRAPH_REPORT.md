# Graph Report - .  (2026-08-08)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 3896 nodes · 8584 edges · 255 communities (194 shown, 61 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `df8c9881`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 221
- Community 223
- Community 224

## God Nodes (most connected - your core abstractions)
1. `SQLiteAdapter` - 105 edges
2. `StorageAdapter` - 95 edges
3. `SqlJsAdapter` - 87 edges
4. `DatabaseConnection` - 75 edges
5. `CoreClient` - 75 edges
6. `SQLiteTransactionAdapter<'a>` - 73 edges
7. `execute_with_adapter()` - 61 edges
8. `WasmClientAdapter` - 61 edges
9. `TauriClient` - 59 edges
10. `usePageStore` - 52 edges

## Surprising Connections (you probably didn't know these)
- `export_all()` --references--> `StorageAdapter`  [EXTRACTED]
  src-tauri/src/markdown.rs → crates/comind-core/src/storage/repository.rs
- `export_changed()` --references--> `StorageAdapter`  [EXTRACTED]
  src-tauri/src/markdown.rs → crates/comind-core/src/storage/repository.rs
- `import_all()` --references--> `StorageAdapter`  [EXTRACTED]
  src-tauri/src/markdown.rs → crates/comind-core/src/storage/repository.rs
- `DatabaseConnection` --references--> `SQLiteAdapter`  [EXTRACTED]
  src-tauri/src/state.rs → crates/comind-core/src/storage/sqlite.rs
- `SyncServerInner` --references--> `SyncEngine`  [EXTRACTED]
  src-tauri/src/sync_server.rs → crates/comind-core/src/sync/engine.rs

## Import Cycles
- None detected.

## Communities (255 total, 61 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (121): ExportResult, ImportResult, IncompleteTask, MutexGuard, auto_reconnect(), batch_check_and_fire_data(), batch_create_notifications(), BatchCheckAndFireData (+113 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (68): apply_lww_sync(), apply_lww_sync_raw(), commit_full_sync_sync(), create_test_engine(), DebounceBuffer, export_full_sync(), fetch_row_payloads_sync(), FullSyncBuffer (+60 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (53): props, { navigateToPageMock }, { relMenuMock }, setup(), useBlockEditorLifecycle(), UseBlockEditorLifecycleOptions, blockStore, editorStore (+45 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (33): row_to_block(), row_to_block_version(), row_to_date_ref(), row_to_link(), row_to_notification(), row_to_page(), row_to_property(), row_to_relationship_type() (+25 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (7): NotificationService, DateRef, CoreClient, TauriClient, Notification, SavedFilterRust, TaskViewRust

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (64): allCommands, bindEditorUpdate(), blockStore, close(), { commands }, deleteTemplateFromList(), editorStore, executeCommand() (+56 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (48): useBlockPropertySync(), editorStore, editProperty(), hoveredPropertyId, isBuiltIn(), propertyStore, props, visibleProperties (+40 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (47): DateTimePickerConfirm, editorStore, emit, enableTime, handleCancel(), handleConfirm(), localDate, localKind (+39 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (16): BlockRepository, BlockVersionRepository, DateRefRepository, LinkRepository, NotificationConfigRepository, NotificationRepository, PageRepository, PropertyRepository (+8 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (26): ADR-0001, PairedDevice, WasmClientAdapter, BatchOperation, BatchResult, ExportResult, ImportResult, IncompleteTask (+18 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (54): handleHeaderMouseDown(), activeSection, androidConnecting, androidIsAndroid, androidSyncing, androidSyncStatus, customWorkspacePath, { editorFontSize, setEditorFontSize } (+46 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (44): { register }, { register }, embedHandler, { register }, imageHandler, { register }, block, blockChildrenRef (+36 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (39): childrenContainerClass, draggableRef, emit, props, useBlockCollapse(), blockStore, circularDetected, detectCircular() (+31 more)

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (28): getNotificationDelivery(), NotificationDelivery, TauriNotificationDelivery, isTauriMock, payload, WebNotificationDelivery, getNotificationService(), loadNotificationSettings() (+20 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (28): HashSet, JoinHandle, SocketAddr, PeerInfo, PeerStatus, Arc, Box, Clone (+20 more)

### Community 16 - "Community 16"
Cohesion: 0.10
Nodes (37): Block, BlockCreateOptions, BlockTree, BlockUpdateOptions, IncompleteTask, HashMap, Option, Self (+29 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (31): Drop, AppConfig, default_config_has_required_fields(), get_db_path(), get_default_workspace_path(), get_device_name(), get_markdown_path(), get_workspace_path() (+23 more)

### Community 18 - "Community 18"
Cohesion: 0.05
Nodes (32): absolute, blockStore, canGoBack, canGoForward, editorStore, handleClose(), handleMaximize(), handleMinimize() (+24 more)

### Community 19 - "Community 19"
Cohesion: 0.16
Nodes (7): Block, Box, DateRef, Page, Property, String, Vec

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (25): BlockCard, DateRefLite, HashMap, String, Value, Vec, BlockSnapshot, BlockVersion (+17 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (31): emit, handleBackdropClick(), handleKeydown(), handleRestore(), isLoading, props, selectedVersion, sortedVersions (+23 more)

### Community 22 - "Community 22"
Cohesion: 0.17
Nodes (5): Error, Notification, Option, Result, SQLiteTransactionAdapter<'a>

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (31): BacklinkGroup, BacklinkItem, blockStore, collapsed, editorStore, { getHandler }, groupedBacklinks, handleBacklinkClick() (+23 more)

### Community 24 - "Community 24"
Cohesion: 0.06
Nodes (21): debouncedEmitSave, editor, emit, handleDateRefClick(), handleDateRefTrigger(), handleEnterAsBlock(), handleKindSelect(), hasContent (+13 more)

### Community 25 - "Community 25"
Cohesion: 0.08
Nodes (25): activeItems, { all, create, update, softDelete, restore, reorder }, cancelEdit(), canSave, deletedItems, editingKey, EditState, saveEdit() (+17 more)

### Community 26 - "Community 26"
Cohesion: 0.20
Nodes (35): BlockUpdate, default_aliases(), delete_page_cascade(), delete_property(), execute_batch(), get_all_pages(), get_backlinks(), get_block() (+27 more)

### Community 27 - "Community 27"
Cohesion: 0.08
Nodes (6): getClient(), fakeClient, useDateRefIndex(), parseJsonResult(), DateRefRecord, WasmClient

### Community 28 - "Community 28"
Cohesion: 0.06
Nodes (20): ALL_ICONS, GENERAL_ICONS, iconComponent, isFilled, PRIORITY_ICONS, props, STATUS_ICONS, emit (+12 more)

### Community 29 - "Community 29"
Cohesion: 0.08
Nodes (29): blockStore, dateRefs, deadlineRef, displayContent, editRef, emit, ensureBlockInStore(), handleBlur() (+21 more)

### Community 30 - "Community 30"
Cohesion: 0.08
Nodes (29): android, barcode-scanner:allow-scan, barcode-scanner:default, dialog:allow-save, fs:allow-write-file, fs:default, iOS, notification:default (+21 more)

### Community 31 - "Community 31"
Cohesion: 0.09
Nodes (13): clearImage(), copySuccess, emit, handleClick(), imgSrc, parsed, props, showActions (+5 more)

### Community 32 - "Community 32"
Cohesion: 0.09
Nodes (27): activeTimeRange, collapsed, dimIsolated, emit, emitChange(), endPickerPos, endPickerVisible, getFilterState() (+19 more)

### Community 33 - "Community 33"
Cohesion: 0.13
Nodes (23): listRef, props, attachKeyboardListener(), currentInstance, detachKeyboardListener(), handleKeydown(), initialState, RelationshipDirection (+15 more)

### Community 34 - "Community 34"
Cohesion: 0.07
Nodes (28): icons/128x128.png, icons/32x32.png, icons/icon.ico, icons/icon.png, app, security, windows, build (+20 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (22): createEditor(), currentLang, currentLangLabel, editorRef, emit, focus(), getLanguageExtension(), githubHighlightStyle (+14 more)

### Community 36 - "Community 36"
Cohesion: 0.14
Nodes (18): RFC-4122, deserializeBlockTree(), DeserializedBlock, DeserializeOptions, serializeBlockTree(), UNSUPPORTED_TYPES, ExpandResult, TemplateRenderer (+10 more)

### Community 37 - "Community 37"
Cohesion: 0.21
Nodes (14): compute_event_iso_matches_js_local_9am(), DateRefService, deleting_block_removes_all_its_notifications(), extract_date_refs_basic(), removing_one_kind_deletes_only_that_kinds_notification(), rescheduling_still_works_when_iso_changes(), Box, DateRef (+6 more)

### Community 38 - "Community 38"
Cohesion: 0.10
Nodes (22): getClient(), blockCardStore, currentViewQuery, currentViewType, filteredCards, handleRefresh(), handleStatusChange(), propertyStore (+14 more)

### Community 39 - "Community 39"
Cohesion: 0.09
Nodes (22): closeMenu(), currentPage, currentPageId, favorited, handleClickOutside(), handleNavigateToSettings(), handleNavigateToTrash(), handlePermanentDelete() (+14 more)

### Community 40 - "Community 40"
Cohesion: 0.10
Nodes (21): addTag(), blockId, builtInProperties, currentDef, currentValue, dropdownRef, editorStore, handleDateChange() (+13 more)

### Community 41 - "Community 41"
Cohesion: 0.08
Nodes (18): emit, cancelEditTitle(), currentPageTitle, editingTitle, editorStore, handleCancelRename(), isEditingTitle, isTitleEditable (+10 more)

### Community 42 - "Community 42"
Cohesion: 0.08
Nodes (26): properties, default, description, type, type, $ref, array, null (+18 more)

### Community 43 - "Community 43"
Cohesion: 0.16
Nodes (18): is_quiet_hours(), NotificationService, Block, Box, DateRef, Error, Notification, Option (+10 more)

### Community 44 - "Community 44"
Cohesion: 0.11
Nodes (23): blockStore, containerRef, currentLayout, currentPageId, fetchNeighbors(), graphRef, handleFitView(), handleLayoutChange() (+15 more)

### Community 45 - "Community 45"
Cohesion: 0.09
Nodes (10): COLUMNS, draggedCardId, emit, onDrop(), PRIORITY_COLORS, props, emptyQuery, emptyQuery (+2 more)

### Community 46 - "Community 46"
Cohesion: 0.14
Nodes (16): applyQuery(), compareCards(), compareFieldTime(), evaluateCondition(), fieldHasValue(), fieldMatches(), getFieldValues(), BlockField (+8 more)

### Community 47 - "Community 47"
Cohesion: 0.11
Nodes (8): formatMigrationReport(), hasDateRefInContent(), migrateDateProperties(), MigrationResult, parsePropertyDate(), TauriBatchCheckAndFireData, Block, BlockUpdate

### Community 48 - "Community 48"
Cohesion: 0.22
Nodes (17): getClient(), safeCalcInsertPos(), calcInsertPos(), findBlockIndex(), GAP_SIZE, GapExhaustedError, getNextSibling(), getPrevSibling() (+9 more)

### Community 49 - "Community 49"
Cohesion: 0.10
Nodes (5): Link, RelationshipType, SearchResult, ensureSqlJsLoaded(), initWasmClient()

### Community 50 - "Community 50"
Cohesion: 0.11
Nodes (17): apply(), availableOps(), emit, fieldOptions, filters, getFieldKind(), opLabels, props (+9 more)

### Community 51 - "Community 51"
Cohesion: 0.12
Nodes (9): BlockVersion, BlockVersionDB, BlockVersionRecord, convertToBlockVersion(), createWebBlockVersion(), getWebBlockVersionById(), getWebBlockVersions(), restoreWebBlockVersion() (+1 more)

### Community 52 - "Community 52"
Cohesion: 0.31
Nodes (8): BlockService, Block, Box, Error, Option, Result, String, Vec

### Community 53 - "Community 53"
Cohesion: 0.09
Nodes (21): ./crates/pkg/*, src/**/*.spec.ts, src/**/*.test.ts, src/**/*.ts, src/**/*.tsx, src/**/*.vue, vite/client, @vue/tsconfig/tsconfig.dom.json (+13 more)

### Community 54 - "Community 54"
Cohesion: 0.11
Nodes (16): canDelete, changeViewType(), currentView, deleteView(), editName, emit, handleFilterApplied(), isDefaultView (+8 more)

### Community 55 - "Community 55"
Cohesion: 0.10
Nodes (20): ES2023, vite.config.ts, compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection (+12 more)

### Community 56 - "Community 56"
Cohesion: 0.11
Nodes (11): key, closeDropdown(), formatEvent(), handleClickOutside(), handleNotificationClick(), isOpen, notificationStore, selectedSnooze (+3 more)

### Community 57 - "Community 57"
Cohesion: 0.10
Nodes (14): activePanel, isResizing, orderedPanels, sidebarWidth, { visible, activePanelId, settings, setActivePanel, setVisible, setWidth, persistSettings }, getRegisteredPanels(), panels, registerPanel() (+6 more)

### Community 58 - "Community 58"
Cohesion: 0.10
Nodes (14): { open: openSettings }, router, dockEl, dockState, dockTitle, editorStore, isOnline, isPaired (+6 more)

### Community 59 - "Community 59"
Cohesion: 0.10
Nodes (20): anyOf, definitions, Identifier, Number, PermissionEntry, Target, Value, description (+12 more)

### Community 61 - "Community 61"
Cohesion: 0.36
Nodes (8): FilterService, Box, Error, Result, SavedFilter, TaskView, Vec, StorageAdapter

### Community 62 - "Community 62"
Cohesion: 0.35
Nodes (8): PageService, Box, Error, Option, Page, Result, String, Vec

### Community 63 - "Community 63"
Cohesion: 0.21
Nodes (8): BlockVersion, F, Link, R, RelationshipType, SavedFilter, TaskView, UserTemplate

### Community 64 - "Community 64"
Cohesion: 0.11
Nodes (16): allEdges, blockStore, currentFilterState, edgesLoaded, filterPanelCollapsed, graphProps, GraphView, graphViewRef (+8 more)

### Community 65 - "Community 65"
Cohesion: 0.14
Nodes (18): emit, handleResync(), handleUnpair(), isOnline, isPaired, pairedDevice, peerName, qrExpiry (+10 more)

### Community 66 - "Community 66"
Cohesion: 0.28
Nodes (9): BlockVersionService, BlockVersion, Box, Error, Option, Result, String, Vec (+1 more)

### Community 67 - "Community 67"
Cohesion: 0.32
Nodes (8): LinkService, Box, Error, Link, Option, Result, String, Vec

### Community 68 - "Community 68"
Cohesion: 0.33
Nodes (9): Box, Connection, Error, Option, Result, String, Vec, SyncState (+1 more)

### Community 69 - "Community 69"
Cohesion: 0.25
Nodes (14): buildFullGraph(), createAccumulator(), createEdgeData(), createNodeData(), filterHiddenEdges(), GraphAccumulator, GraphSnapshot, processNeighbors() (+6 more)

### Community 70 - "Community 70"
Cohesion: 0.13
Nodes (15): emit, getClient(), groupedResults, handleKeydown(), loading, navigateToResult(), props, query (+7 more)

### Community 71 - "Community 71"
Cohesion: 0.31
Nodes (8): PropertyService, Box, Error, Option, Property, Result, String, Vec

### Community 72 - "Community 72"
Cohesion: 0.16
Nodes (15): focus(), focusAtCoords(), handleWikiLinkClose(), handleWikiLinkSelect(), closeWikiLinkMenu(), closeWikiLinkMenuByEditor(), findWikiLinkAtCursor(), handleWikiLinkDetection() (+7 more)

### Community 73 - "Community 73"
Cohesion: 0.14
Nodes (17): blockStore, currentMonth, currentPages, error, handleMonthChange(), isEmpty, loadedMonths, loading (+9 more)

### Community 74 - "Community 74"
Cohesion: 0.10
Nodes (20): anyOf, definitions, Identifier, Number, PermissionEntry, Target, Value, description (+12 more)

### Community 75 - "Community 75"
Cohesion: 0.12
Nodes (17): esbuild, jsdom, devDependencies, esbuild, jsdom, rollup, @typescript-eslint/eslint-plugin, @typescript-eslint/parser (+9 more)

### Community 76 - "Community 76"
Cohesion: 0.12
Nodes (17): scripts, android:build, android:build:apk, android:dev, build, dev, lint, lint:fix (+9 more)

### Community 77 - "Community 77"
Cohesion: 0.16
Nodes (11): DropAction, DropTarget, sharedIndicatorClass, sharedIndicatorStyle, sharedIndicatorVisible, useBlockDragDrop(), UseBlockDragDropOptions, useSharedDropIndicator() (+3 more)

### Community 78 - "Community 78"
Cohesion: 0.14
Nodes (13): mockIsFavorite, mockToggleFavorite, closeMenu(), emit, handleClickOutside(), handleToggleFavorite(), { isFavorite, toggleFavorite }, isMenuOpen (+5 more)

### Community 79 - "Community 79"
Cohesion: 0.08
Nodes (26): properties, default, description, type, type, $ref, array, null (+18 more)

### Community 80 - "Community 80"
Cohesion: 0.19
Nodes (14): get_blocks_projection(), make_content_preview(), parse_property_value(), BlockCard, Box, Error, Result, String (+6 more)

### Community 81 - "Community 81"
Cohesion: 0.33
Nodes (8): RelationshipTypeService, Box, Error, Option, RelationshipType, Result, String, Vec

### Community 82 - "Community 82"
Cohesion: 0.33
Nodes (8): Box, Error, Option, Result, String, UserTemplate, Vec, TemplateService

### Community 83 - "Community 83"
Cohesion: 0.15
Nodes (13): calendarDays, calendarMonth, calendarYear, currentYear, emit, handleOverlayClick(), monthNames, onKeyDown() (+5 more)

### Community 84 - "Community 84"
Cohesion: 0.16
Nodes (11): allBlocks, blockStore, emit, filteredBlocks, handleKeyDown(), menuItems, pageStore, props (+3 more)

### Community 85 - "Community 85"
Cohesion: 0.15
Nodes (11): currentMonth, currentYear, dataSet, emit, goToday(), isTodayActive, months, now (+3 more)

### Community 86 - "Community 86"
Cohesion: 0.18
Nodes (11): DONE_COUNT, emit, getSortDir(), getStatus(), handleStatusChange(), isDone(), PRIORITY_CONFIG, props (+3 more)

### Community 87 - "Community 87"
Cohesion: 0.26
Nodes (11): BlockSnapshotCache, PendingBlock, BlockSnapshot, BlockVersion, BlockVersionRecord, calculateSnapshotHash(), serializeSnapshot(), sortArrayByKeys() (+3 more)

### Community 88 - "Community 88"
Cohesion: 0.15
Nodes (13): definitions, Identifier, PermissionEntry, Target, Value, description, oneOf, anyOf (+5 more)

### Community 89 - "Community 89"
Cohesion: 0.13
Nodes (14): anyOf, definitions, PermissionEntry, Target, Value, description, anyOf, description (+6 more)

### Community 90 - "Community 90"
Cohesion: 0.36
Nodes (8): Box, Error, Option, Result, SearchResult, Vec, SearchService, SearchOptions

### Community 91 - "Community 91"
Cohesion: 0.14
Nodes (6): emit, pageStore, router, selectedPageId, showPermanentDeleteConfirm, showRestoreConfirm

### Community 92 - "Community 92"
Cohesion: 0.21
Nodes (10): DEFAULT_FILTER_STATE, EMPTY_VISIBILITY, FilterState, isEdgeDimmed(), SelectorEdge, SelectorNode, VisibilityResult, edges (+2 more)

### Community 93 - "Community 93"
Cohesion: 0.19
Nodes (10): close(), confirmSelect(), emit, filteredPages, menuItems, pageStore, props, selectedIndex (+2 more)

### Community 94 - "Community 94"
Cohesion: 0.16
Nodes (7): pageStore, { recentPages, isExpanded, toggleExpand }, renamingPageId, route, router, isExpanded, useRecent()

### Community 95 - "Community 95"
Cohesion: 0.14
Nodes (9): calendarRows, cardsByDate, currentMonth, currentYear, emit, monthLabel, props, today (+1 more)

### Community 96 - "Community 96"
Cohesion: 0.26
Nodes (10): applyRelationshipTypeToBlockContent(), RelationshipLinkSnapshot, useRelationshipSync(), extractLinkMatches(), LinkParse, parseBlockLinks(), parseContent(), parsePropertyValue() (+2 more)

### Community 97 - "Community 97"
Cohesion: 0.59
Nodes (12): create_test_adapter(), create_test_page(), Box, Error, Result, String, test_build_tree(), test_create_block() (+4 more)

### Community 98 - "Community 98"
Cohesion: 0.59
Nodes (12): create_test_adapter(), create_test_block(), Box, Error, Result, String, test_create_property(), test_delete_properties_by_block_id() (+4 more)

### Community 99 - "Community 99"
Cohesion: 0.18
Nodes (11): emit, handleClick(), heading, headingContent, headingTag, normalContent, props, { renderContentToHtml } (+3 more)

### Community 100 - "Community 100"
Cohesion: 0.24
Nodes (10): handleRelationshipTrigger(), closeRelationshipMenuByEditor(), findRelationshipAtCaret(), handleRelationshipDetection(), notifyRelationshipMenuSelect(), RelationshipAtCaretResult, RelationshipCloseEvent, RelationshipTriggerEvent (+2 more)

### Community 101 - "Community 101"
Cohesion: 0.24
Nodes (10): EDGE_STYLES, EdgeState, EdgeStyleConfig, getEdgeState(), getEdgeStyle(), getNodeState(), getNodeStyle(), NODE_STYLES (+2 more)

### Community 102 - "Community 102"
Cohesion: 0.24
Nodes (5): mountOptions, cleanupPages(), cleanupRelationshipTypes(), cleanupTemplates(), initTestCore()

### Community 103 - "Community 103"
Cohesion: 0.29
Nodes (9): getModalStack(), globalModalStack, hasModalOpen(), popModal(), pushModal(), clearModalStack(), useModalKeyboard(), useModalKeyboardRef() (+1 more)

### Community 104 - "Community 104"
Cohesion: 0.23
Nodes (12): ensureStarted(), isAndroid, pairedDevices, polling, refresh(), refreshPairedDevices(), status, useSyncStatus() (+4 more)

### Community 105 - "Community 105"
Cohesion: 0.15
Nodes (13): description, properties, type, Capability, default, description, type, type (+5 more)

### Community 106 - "Community 106"
Cohesion: 0.15
Nodes (13): description, properties, type, Capability, default, description, type, type (+5 more)

### Community 107 - "Community 107"
Cohesion: 0.21
Nodes (8): default_aliases(), default_id(), default_type(), Page, PageType, Option, Self, String

### Community 108 - "Community 108"
Cohesion: 0.20
Nodes (8): BracketPairExtension, PairConfig, PAIRS, pluginKey, checkForPairDeletion(), getClosePair(), PairConfig, shouldAutoPair()

### Community 109 - "Community 109"
Cohesion: 0.21
Nodes (12): description, required, type, Capability, description, required, type, Capability (+4 more)

### Community 110 - "Community 110"
Cohesion: 0.40
Nodes (4): anyOf, description, $schema, title

### Community 111 - "Community 111"
Cohesion: 0.17
Nodes (12): $ref, array, null, description, items, type, uniqueItems, description (+4 more)

### Community 112 - "Community 112"
Cohesion: 0.17
Nodes (12): $ref, array, null, description, items, type, uniqueItems, description (+4 more)

### Community 113 - "Community 113"
Cohesion: 0.64
Nodes (10): create_test_adapter(), Box, Error, Result, test_create_page(), test_get_all_pages(), test_get_page_by_id(), test_get_page_by_title() (+2 more)

### Community 114 - "Community 114"
Cohesion: 0.25
Nodes (9): emit, handleCancel(), handleConfirm(), handleKeydown(), inputRef, localRenaming, newTitle, props (+1 more)

### Community 115 - "Community 115"
Cohesion: 0.18
Nodes (7): create_block_via_api(), get_backlinks_from_store(), Test backlinks grouped display feature. Strategy: Use store API directly to…, Call blockStore.getBacklinks directly to check DB state., Create a block directly via blockStore API., Update block content and trigger save., update_block_content_via_api()

### Community 116 - "Community 116"
Cohesion: 0.20
Nodes (6): Bundle, PermissionRequest, MainActivity, WebChromeClient, TauriActivity, WebView

### Community 117 - "Community 117"
Cohesion: 0.67
Nodes (9): create_test_adapter(), Box, Error, Result, test_delete_from_index(), test_rebuild_index(), test_search(), test_search_empty_query() (+1 more)

### Community 118 - "Community 118"
Cohesion: 0.67
Nodes (9): create_test_adapter(), Box, Error, Result, test_create_link(), test_delete_link(), test_delete_links_by_source_block(), test_get_links_by_source_block() (+1 more)

### Community 119 - "Community 119"
Cohesion: 0.31
Nodes (3): Connection, Path, Self

### Community 120 - "Community 120"
Cohesion: 0.27
Nodes (6): DateRef, local_to_utc_ms(), Option, Self, String, NaiveDateTime

### Community 121 - "Community 121"
Cohesion: 0.22
Nodes (3): DecoratedEditor, WikiLinkMatch, WikiLinkExtension

### Community 122 - "Community 122"
Cohesion: 0.24
Nodes (6): bootstrap(), router, routes, RouteMeta, vue-router, getCoreClient()

### Community 123 - "Community 123"
Cohesion: 0.20
Nodes (10): type, webviews, windows, items, description, items, type, description (+2 more)

### Community 124 - "Community 124"
Cohesion: 0.20
Nodes (10): type, webviews, windows, items, description, items, type, description (+2 more)

### Community 125 - "Community 125"
Cohesion: 0.20
Nodes (10): type, webviews, windows, items, description, items, type, description (+2 more)

### Community 126 - "Community 126"
Cohesion: 0.20
Nodes (10): type, webviews, windows, items, description, items, type, description (+2 more)

### Community 127 - "Community 127"
Cohesion: 0.28
Nodes (5): NotificationConfig, Default, Option, Self, String

### Community 128 - "Community 128"
Cohesion: 0.22
Nodes (9): description, properties, required, type, CapabilityRemote, urls, urls, description (+1 more)

### Community 129 - "Community 129"
Cohesion: 0.22
Nodes (9): description, properties, required, type, CapabilityRemote, urls, urls, description (+1 more)

### Community 130 - "Community 130"
Cohesion: 0.22
Nodes (9): description, properties, required, type, CapabilityRemote, urls, urls, description (+1 more)

### Community 131 - "Community 131"
Cohesion: 0.22
Nodes (9): description, properties, required, type, CapabilityRemote, urls, urls, description (+1 more)

### Community 133 - "Community 133"
Cohesion: 0.36
Nodes (5): Link, LinkCreateOptions, Option, Self, String

### Community 134 - "Community 134"
Cohesion: 0.32
Nodes (6): Notification, NotificationSettings, Default, Option, Self, String

### Community 135 - "Community 135"
Cohesion: 0.32
Nodes (5): Property, PropertyCreateOptions, Option, Self, String

### Community 137 - "Community 137"
Cohesion: 0.39
Nodes (7): emit, error, scanLoop(), scanning, startScan(), stopScan(), videoRef

### Community 138 - "Community 138"
Cohesion: 0.32
Nodes (5): EditorFontSize, FONT_SIZE_VALUES, isEditorFontSize(), loadFontSize(), useEditorSettings()

### Community 139 - "Community 139"
Cohesion: 0.32
Nodes (5): applyTheme(), resolve(), resolvedTheme, Theme, useTheme()

### Community 140 - "Community 140"
Cohesion: 0.46
Nodes (6): advanceMonth(), advanceYear(), calculateNextRecurrence(), parseIsoLocal(), toDateOnly(), toIsoLocal()

### Community 141 - "Community 141"
Cohesion: 0.48
Nodes (7): @codemirror/lang-go, dependencies, @codemirror/lang-css, @codemirror/lang-go, @codemirror/lang-json, @codemirror/lang-rust, @codemirror/lang-sql

### Community 142 - "Community 142"
Cohesion: 0.29
Nodes (4): RelationshipType, Option, Self, String

### Community 143 - "Community 143"
Cohesion: 0.33
Nodes (5): Option, Self, String, SearchOptions, SearchResult

### Community 144 - "Community 144"
Cohesion: 0.52
Nodes (5): calculateIndentLeft(), calculateNewLeft(), calculateOutdentLeft(), reindexLeftValues(), validateLeftValues()

### Community 145 - "Community 145"
Cohesion: 0.29
Nodes (3): get_backlinks_from_store(), Debug test: check store state at each step to find why backlinks aren't created., Call blockStore.getBacklinks directly to check DB state.

### Community 146 - "Community 146"
Cohesion: 0.47
Nodes (4): Plugin, Project, Config, RustPlugin

### Community 147 - "Community 147"
Cohesion: 0.40
Nodes (5): emit, items, onKeyDown(), props, selectedIndex

### Community 150 - "Community 150"
Cohesion: 0.40
Nodes (3): String, Vec, TagService

### Community 151 - "Community 151"
Cohesion: 0.40
Nodes (3): Self, String, UserTemplate

### Community 153 - "Community 153"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 154 - "Community 154"
Cohesion: 0.40
Nodes (4): buttonClass, emit, isHovered, props

### Community 155 - "Community 155"
Cohesion: 0.60
Nodes (3): gradlew script, die(), warn()

### Community 157 - "Community 157"
Cohesion: 0.50
Nodes (4): @tauri-apps/plugin-dialog, @tauri-apps/plugin-fs, @tauri-apps/plugin-os, @tauri-apps/plugin-fs

### Community 158 - "Community 158"
Cohesion: 0.50
Nodes (3): GraphView, pageStore, ready

### Community 159 - "Community 159"
Cohesion: 0.67
Nodes (3): dismiss(), emit, ToastMessage

### Community 161 - "Community 161"
Cohesion: 0.50
Nodes (4): default, description, type, local

### Community 162 - "Community 162"
Cohesion: 0.50
Nodes (4): default, description, type, local

### Community 166 - "Community 166"
Cohesion: 0.67
Nodes (3): Number, anyOf, description

### Community 167 - "Community 167"
Cohesion: 0.67
Nodes (3): Identifier, description, oneOf

### Community 168 - "Community 168"
Cohesion: 0.67
Nodes (3): Number, anyOf, description

## Knowledge Gaps
- **988 isolated node(s):** `SyncTransport`, `PageType`, `name`, `private`, `version` (+983 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **61 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SQLiteAdapter` connect `Community 9` to `Community 0`, `Community 97`, `Community 98`, `Community 1`, `Community 37`, `Community 127`, `Community 15`, `Community 113`, `Community 19`, `Community 117`, `Community 118`, `Community 119`, `Community 22`, `Community 156`, `Community 61`, `Community 63`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `StorageAdapter` connect `Community 61` to `Community 66`, `Community 67`, `Community 3`, `Community 37`, `Community 71`, `Community 9`, `Community 43`, `Community 80`, `Community 81`, `Community 82`, `Community 16`, `Community 52`, `Community 22`, `Community 90`, `Community 62`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `CoreClient` connect `Community 4` to `Community 2`, `Community 132`, `Community 38`, `Community 6`, `Community 102`, `Community 10`, `Community 44`, `Community 45`, `Community 14`, `Community 47`, `Community 48`, `Community 49`, `Community 51`, `Community 27`, `Community 60`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `SyncTransport`, `PageType`, `name` to the rest of the system?**
  _988 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07025025249691393 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05131917631917632 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.04049416609471517 - nodes in this community are weakly interconnected._