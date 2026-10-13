import "./styles/app.css";
import {
  applyLanguage,
  getStoredLanguage,
  onLocaleChange,
  t,
  type LanguagePreference,
} from "./i18n/i18n";
import { installLiquidGlass } from "./ui/liquidGlass";
import { printPdfDocument } from "./pdf/print";
import { LinkPreviewController } from "./pdf/linkPreview";
import type { UserHighlight } from "./pdf/highlights";
import type { ViewPosition } from "./pdf/viewer";
import { AnnotationsPanel } from "./reader/annotationsPanel";
import { BookmarkStore } from "./reader/bookmarks";
import { BookmarksPanel } from "./reader/bookmarksPanel";
import { HighlightPopover } from "./reader/highlightPopover";
import { NavigationHistory } from "./reader/navigationHistory";
import {
  DEFAULT_HISTORY_SETTINGS,
  cacheDocument,
  clearCachedDocument,
  clearCachedDocuments,
  describeStorageError,
  forgetDocument,
  getActiveDocumentId,
  getDocument,
  getHistorySettings,
  listDocuments,
  readCachedDocument,
  rememberDocument,
  savePosition,
  setActiveDocumentId,
  setHistorySettings,
  type HistoryRecord,
  type HistorySettings,
  type ReadingPosition,
  clearReadingTime,
  getWindowDocumentId,
  listReadingTime,
  setWindowDocumentId,
} from "./history/readingHistory";
import {
  currentWindowId,
  getTabDocumentId,
  onWindowIdChange,
  resolveWindowId,
  setTabDocumentId,
} from "./history/windowSession";
import { TabPresence } from "./history/tabPresence";
import { ReadingTimer } from "./reader/readingTimer";
import { ReadingStatsView } from "./reader/readingStats";
import { AttachmentsController } from "./pdf/attachments";
import {
  UserHighlightController,
  type UserHighlightColor,
} from "./pdf/highlights";
import { LayersController } from "./pdf/layers";
import {
  describePdfError,
  loadPdf,
  loadPdfProgressively,
  loadPdfWithRange,
  type LoadedPdf,
  type PdfProgressiveConsumer,
  type PdfProgressiveSource,
  type PdfRangeSource,
} from "./pdf/loadPdf";
import { OutlineController } from "./pdf/outline";
import { PdfSearchController, type SearchState } from "./pdf/search";
import { ThumbnailController } from "./pdf/thumbnails";
import {
  MAX_MANUAL_SCALE,
  MIN_MANUAL_SCALE,
  PdfViewer,
  type ScrollMode,
  type SpreadMode,
  type ZoomMode,
} from "./pdf/viewer";
import {
  DEFAULT_PAGE_APPEARANCE,
  normalizePageAppearance,
  type PageAppearanceSettings,
} from "./theme/pageAppearance";
import {
  getPageThemePreset,
  type PageTheme,
} from "./theme/pageTheme";
import {
  applyUiTheme,
  getStoredUiTheme,
  type UiTheme,
} from "./theme/theme";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Reader UI failed to initialize: missing ${selector}`);
  }

  return element;
}

const readerApp = requireElement<HTMLElement>("#reader-app");
const fileInput = requireElement<HTMLInputElement>("#pdf-file-input");
const viewerContainer = requireElement<HTMLElement>("#viewer-container");
const pagesContainer = requireElement<HTMLElement>("#pages");
const emptyState = requireElement<HTMLElement>("#empty-state");
const loadingShell = requireElement<HTMLElement>("#loading-shell");
const loadingTitle = requireElement<HTMLElement>("#loading-title");
const loadingDetail = requireElement<HTMLElement>("#loading-detail");
const loadingTrack = requireElement<HTMLElement>("#loading-track");
const loadingBar = requireElement<HTMLElement>("#loading-bar");
const loadingStage = requireElement<HTMLElement>("#loading-stage");
const loadingPercent = requireElement<HTMLElement>("#loading-percent");
const dropOverlay = requireElement<HTMLElement>("#drop-overlay");
const status = requireElement<HTMLElement>("#status");
const textLayerCheck = requireElement<HTMLElement>("#text-layer-check");

const sidebar = requireElement<HTMLElement>("#sidebar");
const sidebarToggle = requireElement<HTMLButtonElement>("#sidebar-toggle");
const thumbnailTab = requireElement<HTMLButtonElement>("#thumbnail-tab");
const outlineTab = requireElement<HTMLButtonElement>("#outline-tab");
const attachmentsTab = requireElement<HTMLButtonElement>("#attachments-tab");
const layersTab = requireElement<HTMLButtonElement>("#layers-tab");
const thumbnailPanel = requireElement<HTMLElement>("#thumbnail-panel");
const outlinePanel = requireElement<HTMLElement>("#outline-panel");
const attachmentsPanel = requireElement<HTMLElement>("#attachments-panel");
const layersPanel = requireElement<HTMLElement>("#layers-panel");
const thumbnailView = requireElement<HTMLElement>("#thumbnail-view");
const outlineView = requireElement<HTMLElement>("#outline-view");
const attachmentsView = requireElement<HTMLElement>("#attachments-view");
const layersView = requireElement<HTMLElement>("#layers-view");

const pageNumberInput = requireElement<HTMLInputElement>("#page-number");
const totalPages = requireElement<HTMLElement>("#total-pages");

const zoomOut = requireElement<HTMLButtonElement>("#zoom-out");
const zoomIn = requireElement<HTMLButtonElement>("#zoom-in");
const zoomSelect = requireElement<HTMLSelectElement>("#zoom-select");
const zoomCustom = requireElement<HTMLOptionElement>("#zoom-custom");

const findToggle = requireElement<HTMLButtonElement>("#find-toggle");
const findbar = requireElement<HTMLElement>("#findbar");
const findInput = requireElement<HTMLInputElement>("#find-input");
const findCount = requireElement<HTMLElement>("#find-count");
const findPrevious = requireElement<HTMLButtonElement>("#find-previous");
const findNext = requireElement<HTMLButtonElement>("#find-next");
const findClose = requireElement<HTMLButtonElement>("#find-close");
const highlightSelectionButton =
  requireElement<HTMLButtonElement>("#highlight-selection");

const exitReaderButton =
  requireElement<HTMLButtonElement>("#exit-reader");
const printButton = requireElement<HTMLButtonElement>("#print");
const saveButton = requireElement<HTMLButtonElement>("#save");
const secondaryToggle = requireElement<HTMLButtonElement>("#secondary-toggle");
const secondaryToolbar = requireElement<HTMLElement>("#secondary-toolbar");
const openFileButton = requireElement<HTMLButtonElement>("#open-file");
const secondaryOpen = requireElement<HTMLButtonElement>("#secondary-open");
const recentButton = requireElement<HTMLButtonElement>("#recent-documents");
const secondaryRecent = requireElement<HTMLButtonElement>("#secondary-recent");
const secondaryStats = requireElement<HTMLButtonElement>("#secondary-stats");
const recentStatsButton = requireElement<HTMLButtonElement>("#recent-stats");
const recentOpenFile = requireElement<HTMLButtonElement>("#recent-open-file");
const statsDialog = requireElement<HTMLDialogElement>("#stats-dialog");
const statsBody = requireElement<HTMLElement>("#stats-body");
const statsClose = requireElement<HTMLButtonElement>("#stats-close");
const statsDone = requireElement<HTMLButtonElement>("#stats-done");
const statsClear = requireElement<HTMLButtonElement>("#stats-clear");
const emptyRecent = requireElement<HTMLButtonElement>("#empty-recent");
const recentDialog = requireElement<HTMLDialogElement>("#recent-dialog");
const recentList = requireElement<HTMLElement>("#recent-list");
const recentClose = requireElement<HTMLButtonElement>("#recent-close");
const recentDone = requireElement<HTMLButtonElement>("#recent-done");
const recentClearCache = requireElement<HTMLButtonElement>("#recent-clear-cache");
const restoreSessionCheckbox = requireElement<HTMLInputElement>("#restore-session");
const cacheLocalPdfsCheckbox = requireElement<HTMLInputElement>("#cache-local-pdfs");
const readerBody = requireElement<HTMLElement>(".reader-body");
const sidebarRevealWidthInput = requireElement<HTMLInputElement>("#sidebar-reveal-width");
const sidebarRevealWidthValue = requireElement<HTMLOutputElement>("#sidebar-reveal-width-value");
const glassRefractionInput = requireElement<HTMLInputElement>("#glass-refraction");
const glassRefractionValue = requireElement<HTMLOutputElement>("#glass-refraction-value");
const glassRimInput = requireElement<HTMLInputElement>("#glass-rim");
const glassRimValue = requireElement<HTMLOutputElement>("#glass-rim-value");
const glassFrostInput = requireElement<HTMLInputElement>("#glass-frost");
const glassFrostValue = requireElement<HTMLOutputElement>("#glass-frost-value");
const toolbarBlurInput = requireElement<HTMLInputElement>("#toolbar-blur");
const toolbarBlurValue = requireElement<HTMLOutputElement>("#toolbar-blur-value");
const glassResetButton = requireElement<HTMLButtonElement>("#glass-reset");
const sidebarAutoRevealCheckbox = requireElement<HTMLInputElement>("#sidebar-auto-reveal");
const liquidGlassCheckbox = requireElement<HTMLInputElement>("#liquid-glass");
const languageSelect = requireElement<HTMLSelectElement>("#language");
const navigateBackButton = requireElement<HTMLButtonElement>("#navigate-back");
const navigateForwardButton = requireElement<HTMLButtonElement>("#navigate-forward");
const bookmarkToggle = requireElement<HTMLButtonElement>("#bookmark-toggle");
const secondaryBack = requireElement<HTMLButtonElement>("#secondary-back");
const secondaryForward = requireElement<HTMLButtonElement>("#secondary-forward");
const secondaryBookmark = requireElement<HTMLButtonElement>("#secondary-bookmark");
const annotationsTab = requireElement<HTMLButtonElement>("#annotations-tab");
const bookmarksTab = requireElement<HTMLButtonElement>("#bookmarks-tab");
const annotationsPanelElement = requireElement<HTMLElement>("#annotations-panel");
const bookmarksPanelElement = requireElement<HTMLElement>("#bookmarks-panel");
const annotationsView = requireElement<HTMLElement>("#annotations-view");
const bookmarksView = requireElement<HTMLElement>("#bookmarks-view");
const clearPdfCacheButton = requireElement<HTMLButtonElement>("#clear-pdf-cache");
const secondarySave = requireElement<HTMLButtonElement>("#secondary-save");
const secondaryPrint = requireElement<HTMLButtonElement>("#secondary-print");
const presentationMode = requireElement<HTMLButtonElement>("#presentation-mode");
const firstPage = requireElement<HTMLButtonElement>("#first-page");
const lastPage = requireElement<HTMLButtonElement>("#last-page");
const rotateCounterclockwise =
  requireElement<HTMLButtonElement>("#rotate-ccw");
const rotateClockwise = requireElement<HTMLButtonElement>("#rotate-cw");
const scrollModeSelect = requireElement<HTMLSelectElement>("#scroll-mode");
const spreadModeSelect = requireElement<HTMLSelectElement>("#spread-mode");
const zoomSensitivity =
  requireElement<HTMLInputElement>("#zoom-sensitivity");
const zoomSensitivityValue =
  requireElement<HTMLOutputElement>("#zoom-sensitivity-value");
const pageThemeSelect = requireElement<HTMLSelectElement>("#page-theme");
const appearanceBrightness =
  requireElement<HTMLInputElement>("#appearance-brightness");
const appearanceBrightnessValue =
  requireElement<HTMLOutputElement>("#appearance-brightness-value");
const appearanceContrast =
  requireElement<HTMLInputElement>("#appearance-contrast");
const appearanceContrastValue =
  requireElement<HTMLOutputElement>("#appearance-contrast-value");
const appearanceTemperature =
  requireElement<HTMLInputElement>("#appearance-temperature");
const appearanceTemperatureValue =
  requireElement<HTMLOutputElement>("#appearance-temperature-value");
const appearanceSaturation =
  requireElement<HTMLInputElement>("#appearance-saturation");
const appearanceSaturationValue =
  requireElement<HTMLOutputElement>("#appearance-saturation-value");
const appearanceBackground =
  requireElement<HTMLInputElement>("#appearance-background");
const appearanceForeground =
  requireElement<HTMLInputElement>("#appearance-foreground");
const appearanceUsePreset =
  requireElement<HTMLButtonElement>("#appearance-use-preset");
const appearanceReset =
  requireElement<HTMLButtonElement>("#appearance-reset");
const highlightColorSelect =
  requireElement<HTMLSelectElement>("#highlight-color");
const clearHighlights =
  requireElement<HTMLButtonElement>("#clear-highlights");
const uiThemeSelect = requireElement<HTMLSelectElement>("#ui-theme");
const documentPropertiesButton =
  requireElement<HTMLButtonElement>("#document-properties-button");

const documentProperties =
  requireElement<HTMLDialogElement>("#document-properties");
const propertiesList = requireElement<HTMLDListElement>("#properties-list");

const documentControls = Array.from(
  document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement
  >(".requires-document"),
);

type SidebarPanel =
  | "thumbnails"
  | "outline"
  | "annotations"
  | "bookmarks"
  | "attachments"
  | "layers";

interface ReaderPreferences {
  pageAppearance: PageAppearanceSettings;
  pageTheme: PageTheme;
  highlightColor: UserHighlightColor;
  scrollMode: ScrollMode;
  liquidGlass: boolean;
  glassRefraction: number;
  glassRim: number;
  glassFrost: number;
  toolbarBlur: number;
  sidebarAutoReveal: boolean;
  sidebarRevealWidth: number;
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
  spreadMode: SpreadMode;
  zoomMode: ZoomMode;
  zoomScale: number;
  zoomSensitivity: number;
  zoomSensitivityCalibration: number;
}

const READER_PREFERENCES_KEY = "gemini-pdf-reader.preferences.v2";
const DOCUMENT_POSITION_PREFIX = "gemini-pdf-reader.position.";
const HIGHLIGHTS_PREFIX = "gemini-pdf-reader.highlights.";
const BOOKMARKS_PREFIX = "gemini-pdf-reader.bookmarks.";

const DEFAULT_PREFERENCES: ReaderPreferences = {
  pageAppearance: { ...DEFAULT_PAGE_APPEARANCE },
  pageTheme: "original",
  highlightColor: "yellow",
  scrollMode: "vertical",
  liquidGlass: true,
  glassRefraction: 50,
  glassRim: 60,
  glassFrost: 50,
  toolbarBlur: 5,
  sidebarAutoReveal: true,
  sidebarRevealWidth: 80,
  sidebarOpen: false,
  sidebarPanel: "thumbnails",
  spreadMode: "none",
  zoomMode: "automatic",
  zoomScale: 1,
  zoomSensitivity: 1,
  zoomSensitivityCalibration: 2,
};

function clampPreference(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function loadReaderPreferences(): ReaderPreferences {
  try {
    const stored = JSON.parse(
      localStorage.getItem(READER_PREFERENCES_KEY) ?? "{}",
    ) as Partial<ReaderPreferences>;
    const pageThemes: PageTheme[] = ["original", "dark", "sepia"];
    const highlightColors: UserHighlightColor[] = [
      "yellow",
      "green",
      "pink",
      "blue",
    ];
    const scrollModes: ScrollMode[] = [
      "vertical",
      "horizontal",
      "wrapped",
      "page",
    ];
    const sidebarPanels: SidebarPanel[] = [
      "thumbnails",
      "outline",
      "annotations",
      "bookmarks",
      "attachments",
      "layers",
    ];
    const spreadModes: SpreadMode[] = ["none", "odd", "even"];
    const zoomModes: ZoomMode[] = [
      "automatic",
      "actual",
      "page-fit",
      "page-width",
      "custom",
    ];

    return {
      pageAppearance: normalizePageAppearance(stored.pageAppearance),
      pageTheme: pageThemes.includes(stored.pageTheme as PageTheme)
        ? (stored.pageTheme as PageTheme)
        : DEFAULT_PREFERENCES.pageTheme,
      highlightColor: highlightColors.includes(
        stored.highlightColor as UserHighlightColor,
      )
        ? (stored.highlightColor as UserHighlightColor)
        : DEFAULT_PREFERENCES.highlightColor,
      scrollMode: scrollModes.includes(stored.scrollMode as ScrollMode)
        ? (stored.scrollMode as ScrollMode)
        : DEFAULT_PREFERENCES.scrollMode,
      liquidGlass:
        typeof stored.liquidGlass === "boolean"
          ? stored.liquidGlass
          : DEFAULT_PREFERENCES.liquidGlass,
      glassRefraction: clampPreference(stored.glassRefraction, 0, 100, DEFAULT_PREFERENCES.glassRefraction),
      glassRim: clampPreference(stored.glassRim, 0, 100, DEFAULT_PREFERENCES.glassRim),
      glassFrost: clampPreference(stored.glassFrost, 0, 100, DEFAULT_PREFERENCES.glassFrost),
      toolbarBlur: clampPreference(stored.toolbarBlur, 0, 20, DEFAULT_PREFERENCES.toolbarBlur),
      sidebarAutoReveal:
        typeof stored.sidebarAutoReveal === "boolean"
          ? stored.sidebarAutoReveal
          : DEFAULT_PREFERENCES.sidebarAutoReveal,
      // 36 was the earlier default, which proved too narrow; upgrade it.
      sidebarRevealWidth:
        stored.sidebarRevealWidth === 36
          ? DEFAULT_PREFERENCES.sidebarRevealWidth
          : clampPreference(stored.sidebarRevealWidth, 8, 240, DEFAULT_PREFERENCES.sidebarRevealWidth),
      sidebarOpen:
        typeof stored.sidebarOpen === "boolean"
          ? stored.sidebarOpen
          : DEFAULT_PREFERENCES.sidebarOpen,
      sidebarPanel: sidebarPanels.includes(
        stored.sidebarPanel as SidebarPanel,
      )
        ? (stored.sidebarPanel as SidebarPanel)
        : DEFAULT_PREFERENCES.sidebarPanel,
      spreadMode: spreadModes.includes(stored.spreadMode as SpreadMode)
        ? (stored.spreadMode as SpreadMode)
        : DEFAULT_PREFERENCES.spreadMode,
      zoomMode: zoomModes.includes(stored.zoomMode as ZoomMode)
        ? (stored.zoomMode as ZoomMode)
        : DEFAULT_PREFERENCES.zoomMode,
      zoomScale:
        typeof stored.zoomScale === "number" &&
        Number.isFinite(stored.zoomScale)
          ? Math.min(
              MAX_MANUAL_SCALE,
              Math.max(MIN_MANUAL_SCALE, stored.zoomScale),
            )
          : DEFAULT_PREFERENCES.zoomScale,
      zoomSensitivity:
        typeof stored.zoomSensitivity === "number" &&
        Number.isFinite(stored.zoomSensitivity)
          ? Math.min(
              2,
              Math.max(
                0.5,
                stored.zoomSensitivityCalibration === 2
                  ? stored.zoomSensitivity
                  : stored.zoomSensitivity / 1.5,
              ),
            )
          : DEFAULT_PREFERENCES.zoomSensitivity,
      zoomSensitivityCalibration: 2,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function saveReaderPreferences(): void {
  localStorage.setItem(
    READER_PREFERENCES_KEY,
    JSON.stringify(readerPreferences),
  );
}

const readerPreferences = loadReaderPreferences();
saveReaderPreferences();

let currentPdf: LoadedPdf | null = null;
let currentViewer: PdfViewer | null = null;
let currentThumbnails: ThumbnailController | null = null;
let currentOutline: OutlineController | null = null;
let currentAttachments: AttachmentsController | null = null;
let currentLayers: LayersController | null = null;
let currentHighlights: UserHighlightController | null = null;
let currentBookmarks: BookmarkStore | null = null;
let currentLinkPreview: LinkPreviewController | null = null;
let currentSearch: PdfSearchController | null = null;

interface PdfInputSource {
  arrayBuffer?(): Promise<ArrayBuffer>;
  name: string;
  originalBlob: Blob | null;
  progressiveSource?: PdfProgressiveSource;
  lastModified?: number;
  cachedSource?: boolean;
  rangeSource?: PdfRangeSource;
  size: number;
  type: string;
}

interface SidebarInitializationState {
  attachmentsStarted: boolean;
  layersStarted: boolean;
  loadedPdf: LoadedPdf;
  outlineStarted: boolean;
  sequence: number;
  thumbnailsStarted: boolean;
  viewer: PdfViewer;
}

let sidebarInitialization: SidebarInitializationState | null = null;
let currentFile: PdfInputSource | null = null;
let currentFingerprint: string | null = null;
let currentHistoryId: string | null = null;
let historySettings: HistorySettings = { ...DEFAULT_HISTORY_SETTINGS };
let progressTimer: number | null = null;
let cacheGeneration = 0;
let cacheQueue: Promise<void> = Promise.resolve();
let historyStartupStarted = false;
let optionalContentThumbnailUnsubscribe: (() => void) | null = null;

interface ExtensionPdfTransfer {
  token: string;
  filename: string;
  contentType: string;
  totalBytes: number | null;
  bytes: Uint8Array | null;
  chunks: Uint8Array[];
  receivedBytes: number;
}

interface PendingExtensionRange {
  begin: number;
  end: number;
  reject(error: Error): void;
  resolve(bytes: Uint8Array): void;
  timeout: number;
}

interface ExtensionRangeSession {
  nextRequestId: number;
  pending: Map<number, PendingExtensionRange>;
  token: string;
}

interface ExtensionProgressiveSession {
  consumer: PdfProgressiveConsumer | null;
  done: boolean;
  lastReportedPercent: number;
  queuedChunks: Uint8Array[];
  receivedBytes: number;
  token: string;
  totalBytes: number;
}

let extensionPdfTransfer: ExtensionPdfTransfer | null = null;
let extensionRangeSession: ExtensionRangeSession | null = null;
let extensionProgressiveSession: ExtensionProgressiveSession | null = null;
let extensionHandoffActive =
  extensionTransferToken() !== null ||
  document.documentElement.classList.contains("extension-handoff");
const cancelledExtensionTransfers = new Set<string>();
let openSequence = 0;
let dragDepth = 0;
let searchTimer: number | null = null;
let appearanceTimer: number | null = null;
let zoomCommitTimer: number | null = null;
let wheelZoomRaf: number | null = null;
let wheelZoomFactor = 1;
let wheelZoomAnchor: { clientX: number; clientY: number } | null = null;
let statusTimer: number | null = null;
let loadingShellTimer: number | null = null;

const ZOOM_COMMIT_DELAY_MS = 140;
const BASE_WHEEL_ZOOM_GAIN = 0.00495;
let presentationRestore:
  | {
      scale: number;
      mode: ZoomMode;
      sidebarOpen: boolean;
    }
  | null = null;

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function isPdf(file: Pick<PdfInputSource, "name" | "type">): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLocaleLowerCase().endsWith(".pdf")
  );
}

function pdfSourceFromFile(file: File): PdfInputSource {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    originalBlob: file,
    arrayBuffer: () => file.arrayBuffer(),
    lastModified: file.lastModified,
  };
}

function extensionTransferToken(): string | null {
  return new URL(window.location.href).searchParams.get(
    "extensionTransfer",
  );
}

function decodeBase64Chunk(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function rejectExtensionRangeSession(
  message: string,
): void {
  const session = extensionRangeSession;

  if (!session) {
    return;
  }

  for (const pending of session.pending.values()) {
    window.clearTimeout(pending.timeout);
    pending.reject(new Error(message));
  }

  session.pending.clear();
  extensionRangeSession = null;
}

function cancelActiveExtensionTransfer(): void {
  const token =
    extensionPdfTransfer?.token ??
    extensionRangeSession?.token ??
    extensionProgressiveSession?.token ??
    extensionTransferToken();

  if (token) {
    cancelledExtensionTransfers.add(token);

    window.postMessage(
      {
        source: "gemini-pdf-reader-page",
        type: "pdf-transfer-abort",
        token,
      },
      window.location.origin,
    );
  }

  extensionPdfTransfer = null;
  extensionProgressiveSession = null;
  rejectExtensionRangeSession("PDF transfer cancelled.");
  clearExtensionTransferUrl();
}

function clearExtensionTransferUrl(): void {
  const url = new URL(window.location.href);

  const hadQueryTransfer =
    url.searchParams.has("extensionTransfer");
  const hadDirectSource =
    url.hash.startsWith("#extensionSource=");

  if (!hadQueryTransfer && !hadDirectSource) {
    return;
  }

  url.searchParams.delete("extensionTransfer");
  if (hadDirectSource) {
    url.hash = "";
  }
  history.replaceState(history.state, "", url);
}

function handleExtensionPdfMessage(event: MessageEvent): void {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    typeof event.data !== "object" ||
    event.data === null ||
    event.data.source !== "gemini-pdf-reader-extension"
  ) {
    return;
  }

  extensionHandoffActive = true;

  const expectedToken = extensionTransferToken();
  const messageToken =
    typeof event.data.token === "string"
      ? event.data.token
      : null;

  if (event.data.type === "exit-reader-result") {
    if (event.data.ok) {
      return;
    }

    extensionHandoffActive = false;
    exitReaderButton.disabled = false;
    void disposeCurrentPdf().then(() => {
      resetLoadingShell();
      emptyState.hidden = false;
      showStatus(
        typeof event.data.message === "string"
          ? event.data.message
          : "Could not return to the original PDF.",
        5000,
      );
    });
    return;
  }

  if (
    messageToken &&
    cancelledExtensionTransfers.has(messageToken)
  ) {
    if (
      event.data.type === "pdf-end" ||
      event.data.type === "pdf-error"
    ) {
      cancelledExtensionTransfers.delete(messageToken);
    }
    return;
  }

  if (event.data.type === "pdf-direct-file-progress") {
    const filename =
      typeof event.data.filename === "string" &&
      event.data.filename.trim()
        ? event.data.filename
        : "PDF";
    const loaded =
      typeof event.data.loaded === "number" &&
      Number.isFinite(event.data.loaded) &&
      event.data.loaded >= 0
        ? event.data.loaded
        : null;
    const total =
      typeof event.data.total === "number" &&
      Number.isFinite(event.data.total) &&
      event.data.total > 0
        ? event.data.total
        : null;
    const hasProgress =
      loaded !== null && total !== null;

    showLoadingShell({
      filename,
      stage: "Reading local PDF",
      detail: hasProgress
        ? `${formatBytes(loaded)} of ${formatBytes(total)}`
        : loaded !== null
          ? `${formatBytes(loaded)} read`
          : "Reading local file",
      progress: hasProgress ? loaded / total : null,
    });
    return;
  }

  if (event.data.type === "pdf-direct-file-bytes") {
    if (
      typeof event.data.token !== "string" ||
      (expectedToken && event.data.token !== expectedToken) ||
      !(event.data.buffer instanceof ArrayBuffer)
    ) {
      return;
    }

    const buffer = event.data.buffer;
    const size = Number(event.data.size);

    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size !== buffer.byteLength ||
      size > 512 * 1024 * 1024
    ) {
      resetLoadingShell();
      emptyState.hidden = false;
      showStatus("Invalid local PDF transfer.", 5000);
      return;
    }

    clearExtensionTransferUrl();

    const filename =
      typeof event.data.filename === "string" &&
      event.data.filename.trim()
        ? event.data.filename
        : "document.pdf";

    showLoadingShell({
      filename,
      stage: "Parsing PDF",
      detail: "Preparing the document structure",
      progress: null,
    });

    const source: PdfInputSource = {
      name: filename,
      size,
      type:
        typeof event.data.contentType === "string"
          ? event.data.contentType
          : "application/pdf",
      originalBlob: null,
      arrayBuffer: async () => buffer,
    };

    showStatus("Opening PDF…", 0);
    void openLocalPdf(source, "extension");
    return;
  }

  if (event.data.type === "pdf-direct-file-error") {
    clearExtensionTransferUrl();
    resetLoadingShell();
    emptyState.hidden = false;
    showStatus(
      typeof event.data.message === "string"
        ? event.data.message
        : "Local PDF bridge failed.",
      6000,
    );
    return;
  }

  if (event.data.type === "pdf-progressive-start") {
    if (
      typeof event.data.token !== "string" ||
      (expectedToken && event.data.token !== expectedToken)
    ) {
      return;
    }

    const token = event.data.token;
    const totalBytes = Number(event.data.totalBytes);
    const encodedInitialData = event.data.initialData;

    if (
      !Number.isSafeInteger(totalBytes) ||
      totalBytes <= 0 ||
      totalBytes > 512 * 1024 * 1024 ||
      typeof encodedInitialData !== "string"
    ) {
      resetLoadingShell();
      emptyState.hidden = false;
      showStatus("Invalid progressive PDF transfer.", 5000);
      return;
    }

    const initialData = decodeBase64Chunk(encodedInitialData);

    if (
      initialData.byteLength <= 0 ||
      initialData.byteLength > totalBytes
    ) {
      resetLoadingShell();
      emptyState.hidden = false;
      showStatus("Invalid initial PDF data.", 5000);
      return;
    }

    extensionPdfTransfer = null;
    rejectExtensionRangeSession("Superseded by progressive PDF transfer.");

    const initialProgress = initialData.byteLength / totalBytes;
    const session: ExtensionProgressiveSession = {
      consumer: null,
      done: initialData.byteLength === totalBytes,
      lastReportedPercent: Math.floor(initialProgress * 100),
      queuedChunks: [],
      receivedBytes: initialData.byteLength,
      token,
      totalBytes,
    };
    extensionProgressiveSession = session;
    clearExtensionTransferUrl();

    const source: PdfInputSource = {
      name:
        typeof event.data.filename === "string" &&
        event.data.filename.trim()
          ? event.data.filename
          : "document.pdf",
      size: totalBytes,
      type:
        typeof event.data.contentType === "string"
          ? event.data.contentType
          : "application/pdf",
      originalBlob: null,
      progressiveSource: {
        length: totalBytes,
        initialData,
        setConsumer(consumer) {
          if (extensionProgressiveSession !== session) {
            consumer.done();
            return;
          }

          session.consumer = consumer;

          for (const chunk of session.queuedChunks) {
            consumer.push(chunk);
          }
          session.queuedChunks.length = 0;

          if (session.done) {
            consumer.done();
          }
        },
        abort() {
          if (extensionProgressiveSession !== session) {
            return;
          }

          window.postMessage(
            {
              source: "gemini-pdf-reader-page",
              type: "pdf-transfer-abort",
              token,
            },
            window.location.origin,
          );
          extensionProgressiveSession = null;
        },
      },
    };

    showLoadingShell({
      filename: source.name,
      stage: "Receiving PDF",
      detail:
        `${formatBytes(initialData.byteLength)} of ${formatBytes(totalBytes)}`,
      progress: initialProgress,
    });
    showStatus("Opening PDF…", 0);
    void openLocalPdf(source, "extension");

    window.postMessage(
      {
        source: "gemini-pdf-reader-page",
        type: "pdf-progressive-ack",
        token,
        nextOffset: initialData.byteLength,
      },
      window.location.origin,
    );
    return;
  }

  if (event.data.type === "pdf-progressive-chunk") {
    const session = extensionProgressiveSession;

    if (
      !session ||
      session.token !== event.data.token
    ) {
      return;
    }

    const offset = Number(event.data.offset);
    const encoded = event.data.data;

    if (
      !Number.isSafeInteger(offset) ||
      offset !== session.receivedBytes ||
      typeof encoded !== "string"
    ) {
      return;
    }

    const chunk = decodeBase64Chunk(encoded);

    if (
      chunk.byteLength <= 0 ||
      session.receivedBytes + chunk.byteLength >
        session.totalBytes
    ) {
      return;
    }

    session.receivedBytes += chunk.byteLength;

    const percent = Math.floor(
      (session.receivedBytes / session.totalBytes) * 100,
    );

    if (
      percent === 100 ||
      percent - session.lastReportedPercent >= 2
    ) {
      session.lastReportedPercent = percent;
      showLoadingShell({
        stage: "Receiving PDF",
        detail:
          `${formatBytes(session.receivedBytes)} of ${formatBytes(session.totalBytes)}`,
        progress: session.receivedBytes / session.totalBytes,
      });
    }

    if (session.consumer) {
      session.consumer.push(chunk);
    } else {
      session.queuedChunks.push(chunk);
    }

    window.postMessage(
      {
        source: "gemini-pdf-reader-page",
        type: "pdf-progressive-ack",
        token: session.token,
        nextOffset: session.receivedBytes,
      },
      window.location.origin,
    );
    return;
  }

  if (event.data.type === "pdf-progressive-end") {
    const session = extensionProgressiveSession;

    if (
      !session ||
      session.token !== event.data.token
    ) {
      return;
    }

    if (session.receivedBytes !== session.totalBytes) {
      session.consumer?.done();
      extensionProgressiveSession = null;
      resetLoadingShell();
      emptyState.hidden = false;
      showStatus("Incomplete progressive PDF transfer.", 5000);
      return;
    }

    session.done = true;
    session.consumer?.done();
    return;
  }

  if (event.data.type === "pdf-range-start") {
    if (
      typeof event.data.token !== "string" ||
      (expectedToken && event.data.token !== expectedToken)
    ) {
      return;
    }

    const token = event.data.token;

    const totalBytes = Number(event.data.totalBytes);
    const encodedInitialData = event.data.initialData;

    if (
      !Number.isSafeInteger(totalBytes) ||
      totalBytes <= 0 ||
      totalBytes > 512 * 1024 * 1024 ||
      typeof encodedInitialData !== "string"
    ) {
      resetLoadingShell();
      emptyState.hidden = false;
      showStatus("Invalid ranged PDF transfer.", 5000);
      return;
    }

    const initialData = decodeBase64Chunk(encodedInitialData);

    if (
      initialData.byteLength <= 0 ||
      initialData.byteLength > totalBytes
    ) {
      resetLoadingShell();
      emptyState.hidden = false;
      showStatus("Invalid initial PDF range.", 5000);
      return;
    }

    rejectExtensionRangeSession("Superseded by a new PDF.");
    const session: ExtensionRangeSession = {
      token,
      nextRequestId: 0,
      pending: new Map(),
    };
    extensionRangeSession = session;
    extensionPdfTransfer = null;
    clearExtensionTransferUrl();

    const requestRange = (
      begin: number,
      end: number,
    ): Promise<Uint8Array> => {
      if (
        extensionRangeSession !== session ||
        cancelledExtensionTransfers.has(token)
      ) {
        return Promise.reject(
          new Error("PDF range session is no longer active."),
        );
      }

      if (
        !Number.isSafeInteger(begin) ||
        !Number.isSafeInteger(end) ||
        begin < 0 ||
        end <= begin ||
        end > totalBytes
      ) {
        return Promise.reject(
          new Error("PDF.js requested an invalid byte range."),
        );
      }

      const requestId = ++session.nextRequestId;

      return new Promise<Uint8Array>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          session.pending.delete(requestId);
          reject(new Error("PDF range request timed out."));
        }, 15_000);

        session.pending.set(requestId, {
          begin,
          end,
          reject,
          resolve,
          timeout,
        });

        window.postMessage(
          {
            source: "gemini-pdf-reader-page",
            type: "pdf-range-request",
            token,
            requestId,
            begin,
            end,
          },
          window.location.origin,
        );
      });
    };

    const rangeFilename =
      typeof event.data.filename === "string" &&
      event.data.filename.trim()
        ? event.data.filename
        : "document.pdf";

    showLoadingShell({
      filename: rangeFilename,
      stage: "Loading PDF",
      detail:
        "Fetching only the document ranges needed for the first page",
      progress: null,
    });

    const source: PdfInputSource = {
      name: rangeFilename,
      size: totalBytes,
      type:
        typeof event.data.contentType === "string"
          ? event.data.contentType
          : "application/pdf",
      originalBlob: null,
      rangeSource: {
        length: totalBytes,
        initialData,
        requestRange,
        abort() {
          if (extensionRangeSession !== session) {
            return;
          }

          window.postMessage(
            {
              source: "gemini-pdf-reader-page",
              type: "pdf-transfer-abort",
              token,
            },
            window.location.origin,
          );
          rejectExtensionRangeSession("PDF range session aborted.");
        },
      },
    };

    showStatus("Opening PDF…", 0);
    void openLocalPdf(source, "extension");
    return;
  }

  if (event.data.type === "pdf-range-data") {
    const session = extensionRangeSession;

    if (
      !session ||
      session.token !== event.data.token
    ) {
      return;
    }

    const requestId = Number(event.data.requestId);
    const begin = Number(event.data.begin);
    const encoded = event.data.data;
    const pending = session.pending.get(requestId);

    if (
      !pending ||
      begin !== pending.begin ||
      typeof encoded !== "string"
    ) {
      return;
    }

    const bytes = decodeBase64Chunk(encoded);

    if (bytes.byteLength !== pending.end - pending.begin) {
      session.pending.delete(requestId);
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("PDF range length mismatch."));
      return;
    }

    session.pending.delete(requestId);
    window.clearTimeout(pending.timeout);
    pending.resolve(bytes);
    return;
  }

  if (event.data.type === "pdf-range-error") {
    const session = extensionRangeSession;

    if (
      !session ||
      session.token !== event.data.token
    ) {
      return;
    }

    const requestId = Number(event.data.requestId);
    const pending = session.pending.get(requestId);

    if (pending) {
      session.pending.delete(requestId);
      window.clearTimeout(pending.timeout);
      pending.reject(
        new Error(
          typeof event.data.message === "string"
            ? event.data.message
            : "PDF range request failed.",
        ),
      );
    }
    return;
  }

  if (event.data.type === "pdf-start") {
    if (
      typeof event.data.token !== "string" ||
      (expectedToken && event.data.token !== expectedToken)
    ) {
      return;
    }

    const token = event.data.token;

    const rawTotalBytes = event.data.totalBytes;
    const totalBytes =
      rawTotalBytes === null || rawTotalBytes === undefined
        ? null
        : Number(rawTotalBytes);

    if (
      totalBytes !== null &&
      (!Number.isSafeInteger(totalBytes) ||
        totalBytes <= 0 ||
        totalBytes > 512 * 1024 * 1024)
    ) {
      showStatus("Extension PDF is too large or invalid.", 5000);
      extensionPdfTransfer = null;
      return;
    }

    extensionPdfTransfer = {
      token,
      filename:
        typeof event.data.filename === "string" &&
        event.data.filename.trim()
          ? event.data.filename
          : "document.pdf",
      contentType:
        typeof event.data.contentType === "string"
          ? event.data.contentType
          : "application/pdf",
      totalBytes,
      bytes: totalBytes === null ? null : new Uint8Array(totalBytes),
      chunks: [],
      receivedBytes: 0,
    };
    showStatus("Receiving PDF from Chrome…", 0);
    return;
  }

  if (event.data.type === "pdf-chunk") {
    const transfer = extensionPdfTransfer;

    if (!transfer || transfer.token !== event.data.token) {
      return;
    }

    const offset = Number(event.data.offset);
    const encoded = event.data.data;

    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      typeof encoded !== "string"
    ) {
      extensionPdfTransfer = null;
      resetLoadingShell();
      emptyState.hidden = false;
      showStatus("Invalid PDF transfer from extension.", 5000);
      return;
    }

    const chunk = decodeBase64Chunk(encoded);

    if (
      offset !== transfer.receivedBytes ||
      offset + chunk.byteLength > 512 * 1024 * 1024 ||
      (transfer.totalBytes !== null &&
        offset + chunk.byteLength > transfer.totalBytes)
    ) {
      extensionPdfTransfer = null;
      resetLoadingShell();
      emptyState.hidden = false;
      showStatus("Invalid PDF transfer size.", 5000);
      return;
    }

    if (transfer.bytes) {
      transfer.bytes.set(chunk, offset);
    } else {
      transfer.chunks.push(chunk);
    }

    transfer.receivedBytes += chunk.byteLength;

    window.postMessage(
      {
        source: "gemini-pdf-reader-page",
        type: "pdf-chunk-ack",
        token: transfer.token,
        nextOffset: transfer.receivedBytes,
      },
      window.location.origin,
    );
    return;
  }

  if (event.data.type === "pdf-end") {
    const transfer = extensionPdfTransfer;
    extensionPdfTransfer = null;

    if (
      !transfer ||
      transfer.token !== event.data.token ||
      (transfer.totalBytes !== null &&
        transfer.receivedBytes !== transfer.totalBytes)
    ) {
      showStatus("Incomplete PDF transfer from extension.", 5000);
      return;
    }

    clearExtensionTransferUrl();

    const bytes =
      transfer.bytes ??
      (() => {
        const merged = new Uint8Array(transfer.receivedBytes);
        let offset = 0;

        for (const chunk of transfer.chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }

        return merged;
      })();

    const buffer =
      bytes.byteOffset === 0 &&
      bytes.byteLength === bytes.buffer.byteLength &&
      bytes.buffer instanceof ArrayBuffer
        ? bytes.buffer
        : bytes.slice().buffer;

    const source: PdfInputSource = {
      name: transfer.filename,
      size: bytes.byteLength,
      type: transfer.contentType || "application/pdf",
      originalBlob: null,
      arrayBuffer: async () => buffer,
    };

    void openLocalPdf(source, "extension");
    return;
  }

  if (event.data.type === "pdf-error") {
    extensionPdfTransfer = null;
    resetLoadingShell();
    emptyState.hidden = false;

    const progressiveSession =
      extensionProgressiveSession;

    if (
      progressiveSession &&
      progressiveSession.token === event.data.token
    ) {
      progressiveSession.consumer?.done();
      extensionProgressiveSession = null;
    }

    if (
      extensionRangeSession?.token === event.data.token
    ) {
      rejectExtensionRangeSession(
        typeof event.data.message === "string"
          ? event.data.message
          : "Chrome extension could not open this PDF.",
      );
    }

    clearExtensionTransferUrl();
    showStatus(
      typeof event.data.message === "string"
        ? event.data.message
        : "Chrome extension could not open this PDF.",
      6000,
    );
  }
}

interface LoadingShellState {
  detail: string;
  filename?: string;
  progress?: number | null;
  stage: string;
}

function showLoadingShell(state: LoadingShellState): void {
  if (loadingShellTimer !== null) {
    window.clearTimeout(loadingShellTimer);
    loadingShellTimer = null;
  }

  loadingShell.hidden = false;
  loadingShell.classList.remove("is-finishing");
  loadingShell.setAttribute("aria-busy", "true");

  if (state.filename) {
    loadingTitle.textContent = state.filename;
  } else if (!loadingTitle.textContent.trim()) {
    loadingTitle.textContent = t("Opening PDF…");
  }

  loadingDetail.textContent = t(state.detail);
  loadingStage.textContent = t(state.stage);

  if (
    typeof state.progress === "number" &&
    Number.isFinite(state.progress)
  ) {
    const progress = Math.min(1, Math.max(0, state.progress));
    const percent = Math.round(progress * 100);

    loadingShell.dataset.indeterminate = "false";
    loadingBar.style.width = `${percent}%`;
    loadingPercent.textContent = `${percent}%`;
    loadingTrack.setAttribute("aria-valuenow", String(percent));
  } else {
    loadingShell.dataset.indeterminate = "true";
    loadingBar.style.width = "";
    loadingPercent.textContent = "";
    loadingTrack.removeAttribute("aria-valuenow");
  }
}

function finishLoadingShell(): void {
  if (loadingShell.hidden) {
    return;
  }

  loadingShell.dataset.indeterminate = "false";
  loadingBar.style.width = "100%";
  loadingPercent.textContent = "100%";
  loadingStage.textContent = t("Ready");
  loadingDetail.textContent = t("Document ready");
  loadingTrack.setAttribute("aria-valuenow", "100");
  loadingShell.setAttribute("aria-busy", "false");
  loadingShell.classList.add("is-finishing");

  loadingShellTimer = window.setTimeout(() => {
    loadingShell.hidden = true;
    loadingShell.classList.remove("is-finishing");
    loadingShellTimer = null;
  }, 170);
}

function resetLoadingShell(): void {
  document.documentElement.classList.remove("extension-handoff");

  if (loadingShellTimer !== null) {
    window.clearTimeout(loadingShellTimer);
    loadingShellTimer = null;
  }

  loadingShell.hidden = true;
  loadingShell.classList.remove("is-finishing");
  loadingShell.removeAttribute("data-indeterminate");
  loadingBar.style.width = "";
  loadingPercent.textContent = "";
  loadingTrack.removeAttribute("aria-valuenow");
  loadingShell.setAttribute("aria-busy", "false");
}

function showStatus(message: string, duration = 2400): void {
  if (statusTimer !== null) {
    window.clearTimeout(statusTimer);
    statusTimer = null;
  }

  status.textContent = t(message);

  if (message && duration > 0) {
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
      statusTimer = null;
    }, duration);
  }
}

function setDocumentReady(ready: boolean): void {
  for (const control of documentControls) {
    control.disabled = !ready;
  }

  syncSidebarEdge();
  updateNavigationUi();
}

function updatePageUi(pageNumber: number): void {
  const viewer = currentViewer;
  const total = viewer?.totalPages ?? 0;

  pageNumberInput.value = String(total > 0 ? pageNumber : 1);
  totalPages.textContent = String(total);
  currentThumbnails?.setCurrentPage(pageNumber);
  updateBookmarkUi();

  if (currentFingerprint && total > 0) {
    localStorage.setItem(
      DOCUMENT_POSITION_PREFIX + currentFingerprint,
      String(pageNumber),
    );
  }
}
  scheduleProgressSave();

function syncZoomSensitivityUi(): void {
  zoomSensitivity.value = String(
    Math.round(readerPreferences.zoomSensitivity * 100),
  );
  zoomSensitivityValue.value =
    `${readerPreferences.zoomSensitivity.toFixed(1)}×`;
}

function syncAppearanceUi(): void {
  const appearance = readerPreferences.pageAppearance;
  const preset = getPageThemePreset(readerPreferences.pageTheme);
  const enabled =
    Boolean(currentViewer) &&
    readerPreferences.pageTheme !== "original";

  appearanceBrightness.value = String(appearance.brightness);
  appearanceContrast.value = String(appearance.contrast);
  appearanceTemperature.value = String(appearance.temperature);
  appearanceSaturation.value = String(appearance.saturation);
  appearanceBrightnessValue.value = `${appearance.brightness}%`;
  appearanceContrastValue.value = `${appearance.contrast}%`;
  appearanceTemperatureValue.value =
    appearance.temperature > 0
      ? t("Warm {value}", { value: appearance.temperature })
      : appearance.temperature < 0
        ? t("Cool {value}", { value: Math.abs(appearance.temperature) })
        : t("Neutral");
  appearanceSaturationValue.value = `${appearance.saturation}%`;
  appearanceBackground.value =
    appearance.backgroundOverride ?? preset.background;
  appearanceForeground.value =
    appearance.foregroundOverride ?? preset.foreground;

  for (const control of [
    appearanceBrightness,
    appearanceContrast,
    appearanceTemperature,
    appearanceSaturation,
    appearanceBackground,
    appearanceForeground,
    appearanceUsePreset,
    appearanceReset,
  ]) {
    control.disabled = !enabled;
  }
}

function scheduleAppearanceApply(): void {
  const brightness = Number(appearanceBrightness.value);
  const contrast = Number(appearanceContrast.value);
  const temperature = Number(appearanceTemperature.value);
  const saturation = Number(appearanceSaturation.value);

  readerPreferences.pageAppearance = normalizePageAppearance({
    ...readerPreferences.pageAppearance,
    brightness,
    contrast,
    temperature,
    saturation,
  });

  appearanceBrightnessValue.value = `${brightness}%`;
  appearanceContrastValue.value = `${contrast}%`;
  appearanceTemperatureValue.value =
    temperature > 0
      ? t("Warm {value}", { value: temperature })
      : temperature < 0
        ? t("Cool {value}", { value: Math.abs(temperature) })
        : t("Neutral");
  appearanceSaturationValue.value = `${saturation}%`;
  saveReaderPreferences();

  if (appearanceTimer !== null) {
    window.clearTimeout(appearanceTimer);
  }

  appearanceTimer = window.setTimeout(() => {
    appearanceTimer = null;
    currentViewer?.setPageAppearance(
      readerPreferences.pageAppearance,
    );
  }, 90);
}

function applyAppearanceColorOverrides(): void {
  readerPreferences.pageAppearance = normalizePageAppearance({
    ...readerPreferences.pageAppearance,
    backgroundOverride: appearanceBackground.value,
    foregroundOverride: appearanceForeground.value,
  });
  saveReaderPreferences();
  currentViewer?.setPageAppearance(
    readerPreferences.pageAppearance,
  );
  syncAppearanceUi();
}

function updateHighlightUi(): void {
  const erasing = currentHighlights?.selectionCoverage() === "full";
  highlightSelectionButton.disabled =
    !currentViewer || !currentHighlights?.canHighlightSelection();
  // Selecting already-highlighted text turns the highlighter into an eraser.
  highlightSelectionButton.setAttribute("aria-pressed", String(erasing));
  highlightSelectionButton.title = erasing
    ? t("Remove Highlight")
    : t("Highlight Selection");
  highlightSelectionButton.setAttribute(
    "aria-label",
    erasing ? t("Remove highlight from selected text") : t("Highlight selected text"),
  );
  clearHighlights.disabled =
    !currentViewer || (currentHighlights?.count ?? 0) === 0;
}

function updateZoomUi(): void {
  const viewer = currentViewer;

  if (!viewer) {
    zoomSelect.value = "automatic";
    zoomCustom.hidden = true;
    return;
  }

  if (viewer.zoomMode !== "custom") {
    zoomCustom.hidden = true;
    zoomSelect.value = viewer.zoomMode;
    return;
  }

  const fixedValues = new Set([
    "0.5",
    "0.75",
    "1",
    "1.25",
    "1.5",
    "2",
    "2.5",
    "3",
    "4",
  ]);
  const scaleValue = String(viewer.scale);

  if (fixedValues.has(scaleValue)) {
    zoomCustom.hidden = true;
    zoomSelect.value = scaleValue;
    return;
  }

  zoomCustom.hidden = false;
  zoomCustom.textContent = `${Math.round(viewer.scale * 100)}%`;
  zoomSelect.value = "custom";
}

/*
 * Hover-to-peek state machine:
 *   idle → opening (dwell timer) → open → closing (grace timer) → leaving
 *   (exit animation) → idle.
 * Hovering again while closing or leaving revives the peek, so a stray
 * pointer move can never strand it in a half-hidden state.
 */
type SidebarPeekState = "idle" | "opening" | "open" | "closing" | "leaving";

let sidebarPeekState: SidebarPeekState = "idle";
let sidebarPeekTimer: number | null = null;
const SIDEBAR_PEEK_DELAY = 140;
const SIDEBAR_BUTTON_PEEK_DELAY = 180;
const SIDEBAR_HIDE_DELAY = 320;
const SIDEBAR_LEAVE_ANIMATION = 180;

function clearSidebarPeekTimer(): void {
  if (sidebarPeekTimer !== null) {
    window.clearTimeout(sidebarPeekTimer);
    sidebarPeekTimer = null;
  }
}

function setSidebarPeekTimer(callback: () => void, delay: number): void {
  clearSidebarPeekTimer();
  sidebarPeekTimer = window.setTimeout(() => {
    sidebarPeekTimer = null;
    callback();
  }, delay);
}

function sidebarPeekVisible(): boolean {
  return (
    sidebarPeekState === "open" ||
    sidebarPeekState === "closing" ||
    sidebarPeekState === "leaving"
  );
}

function sidebarPinned(): boolean {
  return sidebarToggle.getAttribute("aria-expanded") === "true";
}

let sidebarEdgeEnabled = false;

function syncSidebarEdge(): void {
  sidebarEdgeEnabled =
    readerPreferences.sidebarAutoReveal &&
    !sidebarToggle.disabled &&
    !sidebarPinned() &&
    !readerApp.classList.contains("presentation-mode");

  if (!sidebarEdgeEnabled && sidebarPeekState !== "idle") {
    endSidebarPeek(true);
  }
}

/** Show the sidebar as a floating overlay without changing the page layout. */
function showSidebarPeek(): void {
  clearSidebarPeekTimer();

  if (sidebarPinned() || sidebarToggle.disabled) {
    sidebarPeekState = "idle";
    return;
  }

  sidebarPeekState = "open";
  readerApp.classList.remove("sidebar-peek-leaving");
  readerApp.classList.add("sidebar-peeking");
  sidebar.hidden = false;
  ensureSidebarPanelInitialized(readerPreferences.sidebarPanel);
}

/** The pointer is in the trigger zone, on the sidebar button or on the sidebar. */
function requestSidebarPeek(delay: number): void {
  if (!sidebarEdgeEnabled) return;

  switch (sidebarPeekState) {
    case "idle":
      sidebarPeekState = "opening";
      setSidebarPeekTimer(showSidebarPeek, delay);
      break;
    case "closing":
      clearSidebarPeekTimer();
      sidebarPeekState = "open";
      break;
    case "leaving":
      showSidebarPeek();
      break;
    default:
      break;
  }
}

/** The pointer left every place that keeps the peek alive. */
function releaseSidebarPeek(): void {
  switch (sidebarPeekState) {
    case "opening":
      clearSidebarPeekTimer();
      sidebarPeekState = "idle";
      break;
    case "open":
      sidebarPeekState = "closing";
      setSidebarPeekTimer(() => endSidebarPeek(), SIDEBAR_HIDE_DELAY);
      break;
    default:
      break;
  }
}

function finishSidebarPeek(): void {
  clearSidebarPeekTimer();
  sidebarPeekState = "idle";
  readerApp.classList.remove("sidebar-peeking", "sidebar-peek-leaving");
  if (!sidebarPinned()) {
    sidebar.hidden = true;
  }
}

function endSidebarPeek(immediate = false): void {
  if (sidebarPeekState === "idle") {
    clearSidebarPeekTimer();
    return;
  }

  if (immediate || sidebarPeekState === "opening") {
    finishSidebarPeek();
    return;
  }

  if (sidebarPeekState === "leaving") return;

  sidebarPeekState = "leaving";
  readerApp.classList.add("sidebar-peek-leaving");
  setSidebarPeekTimer(finishSidebarPeek, SIDEBAR_LEAVE_ANIMATION);
}

function setSidebarOpen(open: boolean, persist = true): void {
  endSidebarPeek(true);
  sidebar.hidden = !open;
  sidebarToggle.setAttribute("aria-expanded", String(open));
  syncSidebarEdge();

  if (persist) {
    readerPreferences.sidebarOpen = open;
    saveReaderPreferences();
  }

  window.requestAnimationFrame(() => {
    currentViewer?.refreshZoomMode();

    if (open) {
      ensureSidebarPanelInitialized(
        readerPreferences.sidebarPanel,
      );
    }
  });
}

function showSidebarPanel(panel: SidebarPanel, persist = true): void {
  const tabs: Array<
    [SidebarPanel, HTMLButtonElement, HTMLElement]
  > = [
    ["thumbnails", thumbnailTab, thumbnailPanel],
    ["outline", outlineTab, outlinePanel],
    ["annotations", annotationsTab, annotationsPanelElement],
    ["bookmarks", bookmarksTab, bookmarksPanelElement],
    ["attachments", attachmentsTab, attachmentsPanel],
    ["layers", layersTab, layersPanel],
  ];

  for (const [name, tab, panelElement] of tabs) {
    const active = name === panel;
    panelElement.hidden = !active;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }

  if (persist) {
    readerPreferences.sidebarPanel = panel;
    saveReaderPreferences();
  }

  if (!sidebar.hidden) {
    requestAnimationFrame(() => {
      ensureSidebarPanelInitialized(panel);
    });
  }
}

function setFindbarOpen(open: boolean): void {
  findbar.hidden = !open;
  findToggle.setAttribute("aria-expanded", String(open));

  if (open) {
    secondaryToolbar.hidden = true;
    secondaryToggle.setAttribute("aria-expanded", "false");
    findInput.focus();
    findInput.select();
  }
}

function setSecondaryOpen(open: boolean): void {
  secondaryToolbar.hidden = !open;
  secondaryToggle.setAttribute("aria-expanded", String(open));

  if (open) {
    findbar.hidden = true;
    findToggle.setAttribute("aria-expanded", "false");
  }
}

function searchStateChanged(state: SearchState): void {
  if (state.searching) {
    findCount.textContent =
      state.total > 0
        ? t("Searching… {count}", { count: state.total })
        : t("Searching…");
    return;
  }

  findCount.textContent =
    state.query.trim().length === 0
      ? ""
      : state.total === 0
        ? "0 / 0"
        : `${state.current} / ${state.total}`;
}

function scheduleSearch(): void {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer);
  }

  searchTimer = window.setTimeout(() => {
    searchTimer = null;
    void currentSearch?.search(findInput.value);
  }, 180);
}

let storageWarningShown = false;

function reportHistoryError(error: unknown): void {
  if (!storageWarningShown) {
    storageWarningShown = true;
    showStatus(t("Reading history: {error}", { error: describeStorageError(error) }), 6500);
  }
}

function currentReadingPosition(): ReadingPosition | null {
  const viewer = currentViewer;
  if (!viewer || !currentHistoryId) return null;
  return {
    page: viewer.currentPage,
    scrollTop: Math.max(0, viewerContainer.scrollTop),
    scrollLeft: Math.max(0, viewerContainer.scrollLeft),
    zoomMode: viewer.zoomMode,
    zoomScale: viewer.scale,
    pageTheme: viewer.pageTheme,
    lastReadAt: Date.now(),
  };
}

async function saveCurrentPosition(): Promise<void> {
  if (progressTimer !== null) {
    window.clearTimeout(progressTimer);
    progressTimer = null;
  }
  const id = currentHistoryId;
  const position = currentReadingPosition();
  if (!id || !position) return;
  try {
    await savePosition(id, position);
    storageWarningShown = false;
  } catch (error) {
    reportHistoryError(error);
  }
}

function scheduleProgressSave(): void {
  if (!currentHistoryId || !currentViewer) return;
  if (progressTimer !== null) window.clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => {
    void saveCurrentPosition();
  }, 400);
}

function queueLocalCache(id: string, blob: Blob): void {
  if (!historySettings.cacheLocalFiles) return;
  const generation = cacheGeneration;
  const start = () => {
    cacheQueue = cacheQueue.then(async () => {
      if (!historySettings.cacheLocalFiles || generation !== cacheGeneration) return;
      await cacheDocument(id, blob);
      if (!historySettings.cacheLocalFiles || generation !== cacheGeneration) {
        await clearCachedDocument(id);
      }
    }).catch((error: unknown) => {
      // Storage pressure must never prevent PDF reading; the file handle and
      // Recent Documents metadata are still usable without an OPFS copy.
      showStatus(t("Offline copy unavailable: {error}", { error: describeStorageError(error) }), 6000);
    });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(start, { timeout: 900 });
  } else {
    window.setTimeout(start, 300);
  }
}

function queueExtensionCache(
  id: string,
  loadedPdf: LoadedPdf,
  size: number,
  sequence: number,
): void {
  // Extension range/progressive transports may not expose a Blob. PDF.js can
  // supply the complete data, but only for modest documents, after first paint.
  // Never synthesize an additional whole-file buffer for a large PDF.
  if (!historySettings.cacheLocalFiles || size > 32 * 1024 * 1024) return;
  const generation = cacheGeneration;
  window.setTimeout(() => {
    if (currentPdf !== loadedPdf || sequence !== openSequence ||
        generation !== cacheGeneration || !historySettings.cacheLocalFiles) return;
    scheduleIdleWork(() => {
      if (currentPdf !== loadedPdf || sequence !== openSequence ||
          generation !== cacheGeneration || !historySettings.cacheLocalFiles) return;
      void (async () => {
        try {
          const record = await getDocument(id);
          if (record?.cacheKey) return;
          const data = await loadedPdf.document.getData();
          if (currentPdf !== loadedPdf || sequence !== openSequence ||
              generation !== cacheGeneration || !historySettings.cacheLocalFiles) return;
          const blob = new Blob([Uint8Array.from(data)], { type: "application/pdf" });
          queueLocalCache(id, blob);
        } catch {
          // A fully readable PDF may still be uncachable; keep its metadata.
        }
      })();
    });
  }, 1800);
}

async function clearOfflineCache(): Promise<void> {
  cacheGeneration += 1; // Cancel any queued idle copy before clearing.
  clearPdfCacheButton.disabled = true;
  recentClearCache.disabled = true;
  try {
    await cacheQueue;
    await clearCachedDocuments();
    showStatus("Offline PDF cache cleared. Reading history is retained.", 4000);
    if (recentDialog.open) await renderRecentDocuments();
  } catch (error) {
    showStatus(t("Could not clear PDF cache: {error}", { error: describeStorageError(error) }), 6000);
  } finally {
    clearPdfCacheButton.disabled = false;
    recentClearCache.disabled = false;
  }
}

async function reopenHistoryRecord(record: HistoryRecord, interactive: boolean): Promise<void> {
  const startedAtSequence = openSequence;
  const handle = record.fileHandle as
    | (FileSystemFileHandle & {
        queryPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
        requestPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
      })
    | undefined;

  if (handle) {
    try {
      let permission = await handle.queryPermission?.({ mode: "read" }) ?? "granted";
      if (permission !== "granted" && interactive && !record.cacheKey) {
        permission = await handle.requestPermission?.({ mode: "read" }) ?? permission;
      }
      if (permission === "granted") {
        const file = await handle.getFile();
        if (!interactive && openSequence !== startedAtSequence) return;
        if (file.size === record.size && file.lastModified === record.lastModified) {
          await openLocalPdf(file, "manual", record, handle);
        } else {
          showStatus("The original PDF has changed; opening the current version.", 5000);
          await openLocalPdf(file, "manual", undefined, handle);
        }
        return;
      }
    } catch {
      // Permission can be revoked, the file can be moved, or the handle can
      // become invalid. Try the local cached copy instead.
    }
  }

  if (record.cacheKey) {
    try {
      const cached = await readCachedDocument(record);
      if (cached) {
        if (!interactive && openSequence !== startedAtSequence) return;
        const input: PdfInputSource = {
          name: record.name,
          size: cached.size,
          type: "application/pdf",
          lastModified: record.lastModified,
          originalBlob: cached,
          cachedSource: true,
          arrayBuffer: () => cached.arrayBuffer(),
        };
        await openLocalPdf(input, "manual", record);
        return;
      }
    } catch (error) {
      reportHistoryError(error);
    }
  }

  if (!interactive && openSequence !== startedAtSequence) return;
  showStatus(
    interactive
      ? "Original PDF needs permission or a new selection."
      : "Previous PDF is unavailable. Reopen it from Recent Documents.",
    5500,
  );
  if (interactive) void openFilePicker();
}

/** Badge recent documents that another reader tab is showing right now. */
async function markDocumentsOpenElsewhere(): Promise<void> {
  const open = await tabPresence.openElsewhere(200);
  const windowId = currentWindowId();
  for (const other of open) {
    const row = recentList.querySelector<HTMLElement>(
      `.recent-item[data-document-id="${CSS.escape(other.documentId)}"]`,
    );
    if (!row || row.querySelector(".recent-item-badge")) continue;
    const badge = document.createElement("span");
    badge.className = "recent-item-badge";
    badge.textContent =
      windowId !== null && other.windowId === windowId
        ? t("Open in another tab")
        : t("Open in another window");
    row.querySelector(".recent-item-name")?.after(badge);
  }
}

async function renderRecentDocuments(): Promise<void> {
  recentList.replaceChildren();
  try {
    const records = await listDocuments();
    if (!records.length) {
      const empty = document.createElement("p");
      empty.textContent = t("No recent PDFs yet. Open a local document to start.");
      recentList.append(empty);
      return;
    }
    for (const record of records) {
      const row = document.createElement("article");
      row.className = "recent-item";
      row.dataset.documentId = record.id;
      const details = document.createElement("div");
      details.className = "recent-item-main";
      const title = document.createElement("div");
      title.className = "recent-item-name";
      title.textContent = record.name;
      const meta = document.createElement("div");
      meta.className = "recent-item-meta";
      const date = new Date(record.lastReadAt);
      meta.textContent =
        t("{size} · Page {page} · {date}", {
          size: formatBytes(record.size),
          page: record.page,
          date: Number.isFinite(date.getTime())
            ? date.toLocaleString(document.documentElement.lang)
            : t("Unknown date"),
        }) +
        t(record.cacheKey ? " · Offline copy" : record.fileHandle ? " · Original file" : " · Select file to reopen");
      details.append(title, meta);
      const buttons = document.createElement("div");
      buttons.className = "recent-item-actions";
      const reopen = document.createElement("button");
      reopen.type = "button";
      reopen.textContent = t("Open");
      reopen.setAttribute("aria-label", t("Open {name}", { name: record.name }));
      reopen.addEventListener("click", () => {
        recentDialog.close();
        void reopenHistoryRecord(record, true);
      });
      const forget = document.createElement("button");
      forget.type = "button";
      forget.textContent = t("Remove");
      forget.setAttribute("aria-label", t("Remove {name} from history", { name: record.name }));
      forget.addEventListener("click", async () => {
        forget.disabled = true;
        try {
          await forgetDocument(record.id);
          try { localStorage.removeItem(DOCUMENT_POSITION_PREFIX + record.id); } catch { /* private mode */ }
          if (currentHistoryId === record.id) currentHistoryId = null;
          await renderRecentDocuments();
        } catch (error) {
          forget.disabled = false;
          showStatus(t("Could not remove document: {error}", { error: describeStorageError(error) }), 5500);
        }
      });
      buttons.append(reopen, forget);
      row.append(details, buttons);
      recentList.append(row);
    }
    void markDocumentsOpenElsewhere();
  } catch (error) {
    recentList.textContent = t("Reading history is unavailable: {error}", { error: describeStorageError(error) });
  }
}

/** Record the document as this Chrome window's latest (needs the extension). */
function rememberForThisWindow(id: string | null): void {
  const windowId = currentWindowId();
  if (windowId !== null) {
    void setWindowDocumentId(windowId, id).catch(reportHistoryError);
  }
}

async function showReadingStats(): Promise<void> {
  setSecondaryOpen(false);
  await readingTimer.flush();
  try {
    const [records, documents] = await Promise.all([listReadingTime(), listDocuments()]);
    readingStatsDocuments = new Set(documents.map((record) => record.id));
    readingStats.setRecords(records);
  } catch (error) {
    reportHistoryError(error);
    readingStats.setRecords([]);
  }
  if (recentDialog.open) recentDialog.close();
  if (!statsDialog.open) statsDialog.showModal();
}

function showRecentDocuments(): void {
  setSecondaryOpen(false);
  if (!recentDialog.open) recentDialog.showModal();
  void renderRecentDocuments();
}

async function initializeHistory(): Promise<void> {
  if (historyStartupStarted) return;
  historyStartupStarted = true;
  try {
    historySettings = await getHistorySettings();
    restoreSessionCheckbox.checked = historySettings.restorePreviousSession;
    cacheLocalPdfsCheckbox.checked = historySettings.cacheLocalFiles;
    if (!historySettings.restorePreviousSession || extensionHandoffActive ||
        extensionTransferToken() || openSequence !== 0 || currentViewer) return;
    // This tab's own document first, then this window's, then the global one.
    const tabId = getTabDocumentId();
    if (tabId === null) return; // The reader was closed in this tab.
    const windowId = await resolveWindowId();

    // A brand-new tab in a window that is already reading something opens the
    // history instead of a second copy. Without the extension the window is
    // unknown, so any other open reader tab counts.
    if (tabId === undefined) {
      const others = await tabPresence.openElsewhere();
      const windowBusy = windowId !== null
        ? others.some((other) => other.windowId === windowId)
        : others.length > 0;
      if (windowBusy) {
        if (!extensionHandoffActive && openSequence === 0 && !currentViewer) {
          showRecentDocuments();
        }
        return;
      }
    }

    const candidates: string[] = [];
    if (tabId) candidates.push(tabId);
    if (windowId !== null) {
      const windowDocument = await getWindowDocumentId(windowId).catch(() => null);
      if (windowDocument) candidates.push(windowDocument);
    }
    const activeId = await getActiveDocumentId();
    if (activeId) candidates.push(activeId);

    if ((document as Document & { wasDiscarded?: boolean }).wasDiscarded && candidates.length) {
      showStatus("Restoring discarded PDF tab from local history…", 2800);
    }

    for (const id of new Set(candidates)) {
      if (extensionHandoffActive || openSequence !== 0 || currentViewer) return;
      const record = await getDocument(id);
      if (record) {
        await reopenHistoryRecord(record, false);
        return;
      }
    }
  } catch (error) {
    reportHistoryError(error);
  }
}

function openFilePicker(): void {
  setSecondaryOpen(false);
  const picker = (window as Window & {
    showOpenFilePicker?: (options: {
      multiple: boolean;
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle[]>;
  }).showOpenFilePicker;
  if (picker) {
    void picker.call(window, {
      multiple: false,
      types: [{ description: t("PDF documents"), accept: { "application/pdf": [".pdf"] } }],
    }).then(async ([handle]) => {
      if (handle) await openLocalPdf(await handle.getFile(), "manual", undefined, handle);
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // On platforms where the File System Access picker is unsupported,
      // retain the native file input as a compatible fallback.
      fileInput.value = "";
      fileInput.click();
    });
    return;
  }
  fileInput.value = "";
  fileInput.click();
}

async function exitReader(): Promise<void> {
  setSecondaryOpen(false);
  setFindbarOpen(false);

  if (
    extensionHandoffActive ||
    extensionTransferToken() !== null
  ) {
    exitReaderButton.disabled = true;
    showStatus("Returning to the original PDF…", 0);

    window.postMessage(
      {
        source: "gemini-pdf-reader-page",
        type: "exit-reader",
      },
      window.location.origin,
    );
    return;
  }

  await disposeCurrentPdf();
  resetLoadingShell();
  emptyState.hidden = false;
  showStatus("Reader closed.", 1800);
  setTabDocumentId(null);
  rememberForThisWindow(null);
  void setActiveDocumentId(null).catch(reportHistoryError);
}

async function disposeCurrentPdf(): Promise<void> {
  readingTimer.setDocument(null);
  await saveCurrentPosition();
  currentHistoryId = null;
  cancelPendingWheelZoom();
  cancelPendingZoomCommit();
  currentSearch?.dispose();
  currentSearch = null;

  highlightPopover.hide();
  annotationsPanel.setController(null);
  currentHighlights?.dispose();
  currentHighlights = null;
  bookmarksPanel.setStore(null);
  currentBookmarks = null;
  currentLinkPreview?.dispose();
  currentLinkPreview = null;
  navigationHistory.reset();

  currentLayers?.dispose();
  currentLayers = null;

  currentAttachments?.dispose();
  currentAttachments = null;

  currentOutline?.dispose();
  currentOutline = null;

  currentThumbnails?.dispose();
  currentThumbnails = null;

  optionalContentThumbnailUnsubscribe?.();
  optionalContentThumbnailUnsubscribe = null;

  currentViewer?.dispose();
  currentViewer = null;
  sidebarInitialization = null;

  const pdf = currentPdf;
  currentPdf = null;
  currentFile = null;
  currentFingerprint = null;

  if (appearanceTimer !== null) {
    window.clearTimeout(appearanceTimer);
    appearanceTimer = null;
  }

  attachmentsTab.hidden = true;
  layersTab.hidden = true;
  attachmentsView.replaceChildren();
  layersView.replaceChildren();
  pagesContainer.replaceChildren();
  pagesContainer.hidden = true;
  emptyState.hidden = false;
  textLayerCheck.hidden = true;
  findInput.value = "";
  findCount.textContent = "";
  setFindbarOpen(false);
  setSidebarOpen(false, false);
  setDocumentReady(false);
  updatePageUi(1);
  updateZoomUi();
  updateHighlightUi();
  document.title = "PageNest PDF";

  if (pdf) {
    await pdf.destroy();
  }
}

function scheduleIdleWork(
  work: () => void | Promise<void>,
): void {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void) => number;
  };

  const run = () => {
    void Promise.resolve(work()).catch(() => {});
  };

  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(run);
  } else {
    window.setTimeout(run, 500);
  }
}

function isSidebarInitializationCurrent(
  state: SidebarInitializationState,
): boolean {
  return (
    sidebarInitialization === state &&
    state.sequence === openSequence &&
    currentPdf === state.loadedPdf &&
    currentViewer === state.viewer
  );
}

function ensureSidebarPanelInitialized(panel: SidebarPanel): void {
  const state = sidebarInitialization;

  if (!state || !isSidebarInitializationCurrent(state)) {
    return;
  }

  const { loadedPdf, viewer } = state;

  if (panel === "thumbnails" && !state.thumbnailsStarted) {
    state.thumbnailsStarted = true;

    const thumbnails = new ThumbnailController(
      loadedPdf.document,
      thumbnailView,
      thumbnailPanel,
      (pageNumber) => viewer.canCleanupPageResources(pageNumber),
      () => viewer.optionalContentConfig,
      (pageNumber) => {
        void jumpTo({ pageNumber, fraction: 0 });
      },
    );

    currentThumbnails = thumbnails;
    thumbnails.initialize();
    thumbnails.setCurrentPage(viewer.currentPage);
    optionalContentThumbnailUnsubscribe =
      viewer.onOptionalContentChanged(() => thumbnails.refresh());
    return;
  }

  if (panel === "outline" && !state.outlineStarted) {
    state.outlineStarted = true;

    const outline = new OutlineController(
      loadedPdf.document,
      outlineView,
      (destination) => viewer.resolveDestination(destination),
      (target) => void jumpTo(target),
    );

    currentOutline = outline;
    void outline.initialize();
    return;
  }

  if (panel === "attachments" && !state.attachmentsStarted) {
    state.attachmentsStarted = true;

    const attachments = new AttachmentsController(
      loadedPdf.document,
      attachmentsView,
      (available) => {
        attachmentsTab.hidden = !available;

        if (
          !available &&
          readerPreferences.sidebarPanel === "attachments"
        ) {
          showSidebarPanel("thumbnails", false);
        }
      },
    );

    currentAttachments = attachments;
    void attachments.initialize();
    return;
  }

  if (panel === "layers" && !state.layersStarted) {
    state.layersStarted = true;

    void viewer.whenOptionalContentConfigReady().then((config) => {
      if (!config || !isSidebarInitializationCurrent(state)) {
        layersTab.hidden = true;
        return;
      }

      const layers = new LayersController(
        config,
        layersView,
        (id, visible) => viewer.setLayerVisibility(id, visible),
        (available) => {
          layersTab.hidden = !available;

          if (
            !available &&
            readerPreferences.sidebarPanel === "layers"
          ) {
            showSidebarPanel("thumbnails", false);
          }
        },
        (listener) => viewer.onOptionalContentChanged(listener),
      );

      layers.initialize();
      currentLayers = layers;
    });
  }
}

function initializeBackgroundDocumentServices(
  loadedPdf: LoadedPdf,
  viewer: PdfViewer,
  sequence: number,
): void {
  const state: SidebarInitializationState = {
    attachmentsStarted: false,
    layersStarted: false,
    loadedPdf,
    outlineStarted: false,
    sequence,
    thumbnailsStarted: false,
    viewer,
  };

  sidebarInitialization = state;

  // Attachments/Layers tabs need availability discovery, but that work has no
  // reason to compete with first paint. Give the document a few quiet seconds
  // before pre-warming those rare panels.
  window.setTimeout(() => {
    if (!isSidebarInitializationCurrent(state)) {
      return;
    }

    scheduleIdleWork(() => {
      if (!isSidebarInitializationCurrent(state)) {
        return;
      }

      ensureSidebarPanelInitialized("attachments");
      ensureSidebarPanelInitialized("layers");
    });
  }, 3000);

  if (readerPreferences.sidebarOpen) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (isSidebarInitializationCurrent(state)) {
          ensureSidebarPanelInitialized(
            readerPreferences.sidebarPanel,
          );
        }
      });
    });
  }
}

async function openLocalPdf(
  input: File | PdfInputSource,
  source: "manual" | "extension" = "manual",
  restoreRecord?: HistoryRecord,
  fileHandle?: FileSystemFileHandle,
): Promise<void> {
  const file =
    input instanceof File ? pdfSourceFromFile(input) : input;

  if (source === "manual") {
    extensionHandoffActive = false;
    cancelActiveExtensionTransfer();
  } else {
    extensionHandoffActive = true;
  }

  if (!isPdf(file)) {
    showStatus("Please choose a PDF file.", 3500);
    return;
  }

  const sequence = ++openSequence;
  showStatus("Opening PDF…", 0);
  await disposeCurrentPdf();
  if (sequence !== openSequence) return;

  showLoadingShell({
    filename: file.name,
    stage: "Parsing PDF",
    detail: "Preparing the document structure",
    progress: null,
  });

  let loadedPdf: LoadedPdf | null = null;

  try {
    if (file.rangeSource) {
      loadedPdf = await loadPdfWithRange(file.rangeSource);
    } else if (file.progressiveSource) {
      loadedPdf = await loadPdfProgressively(
        file.progressiveSource,
      );
    } else {
      if (!file.arrayBuffer) {
        throw new Error("PDF source has no readable data.");
      }

      const buffer = await file.arrayBuffer();

      if (sequence !== openSequence) {
        return;
      }

      loadedPdf = await loadPdf(buffer);
    }

    if (sequence !== openSequence) {
      await loadedPdf.destroy();
      return;
    }

    currentPdf = loadedPdf;
    currentFile = file;
    currentFingerprint =
      loadedPdf.document.fingerprints[0] ??
      `${file.name}:${file.size}`;
    if (sequence !== openSequence) {
      await loadedPdf.destroy();
      return;
    }
    const historyId = currentFingerprint;
    const historyRecord = restoreRecord ?? await getDocument(historyId).catch(() => undefined);
    currentHistoryId = historyId;
    if (sequence !== openSequence) {
      await loadedPdf.destroy();
      return;
    }
    const restore = historyRecord?.id === historyId ? historyRecord : undefined;

    const legacyPage = localStorage.getItem(DOCUMENT_POSITION_PREFIX + currentFingerprint);
    const storedPage = legacyPage === null ? NaN : Number(legacyPage);
    const restoredPage = Number.isFinite(storedPage) && storedPage >= 1
      ? storedPage
      : (restore?.page ?? 1);
    const initialPage = Number.isFinite(restoredPage)
      ? Math.min(loadedPdf.document.numPages, Math.max(1, Math.round(restoredPage)))
      : 1;

    // Set the final layout before calculating fit zoom. The loading shell
    // remains above it until the restored page is sharp and interactive.
    sidebar.hidden = !readerPreferences.sidebarOpen;
    emptyState.hidden = true;
    pagesContainer.hidden = false;

    const viewer = new PdfViewer(
      loadedPdf.document,
      pagesContainer,
      viewerContainer,
      {
        initialAppearance: readerPreferences.pageAppearance,
        initialPage,
        initialScale: restoreRecord ? (restore?.zoomScale ?? readerPreferences.zoomScale) : readerPreferences.zoomScale,
        initialTheme: restoreRecord ? (restore?.pageTheme ?? readerPreferences.pageTheme) : readerPreferences.pageTheme,
        initialZoomMode: restoreRecord ? (restore?.zoomMode ?? readerPreferences.zoomMode) : readerPreferences.zoomMode,
        initialScrollMode: readerPreferences.scrollMode,
        initialSpreadMode: readerPreferences.spreadMode,
        onCurrentPageChange(pageNumber) {
          updatePageUi(pageNumber);
        },
        onGeminiTestPhraseFound() {
          textLayerCheck.hidden = false;
        },
        onLinkNavigation() {
          const active = currentViewer;
          if (active) navigationHistory.record(active.getViewPosition());
        },
        onNamedAction(action) {
          if (action === "Print") {
            printCurrentPdf();
          } else if (action === "SaveAs") {
            saveCurrentPdf();
          }
        },
        onRenderError(message) {
          showStatus(message, 5000);
        },
      },
    );

    currentViewer = viewer;
    showLoadingShell({
      filename: file.name,
      stage: initialPage === 1
        ? "Rendering first page"
        : t("Rendering page {page}", { page: initialPage }),
      detail: "Building the PDF canvas and text layer",
      progress: null,
    });
    await viewer.initialize();

    if (sequence !== openSequence || currentViewer !== viewer) {
      viewer.dispose();
      return;
    }

    // The restored page is already sharp at this point. Make the Reader
    // interactive now; sidebar/document metadata work is intentionally deferred
    // so it cannot compete with first paint.
    currentSearch = new PdfSearchController(
      loadedPdf.document,
      viewer,
      searchStateChanged,
    );
    const highlights = new UserHighlightController(
      viewer,
      HIGHLIGHTS_PREFIX + currentFingerprint,
      (id, marker) =>
        highlightPopover.show(highlights, id, marker.getBoundingClientRect(), {
          focusNote: true,
        }),
    );
    currentHighlights = highlights;
    highlights.onChange(updateHighlightUi);
    highlights.refresh();
    annotationsPanel.setController(highlights);
    currentBookmarks = new BookmarkStore(BOOKMARKS_PREFIX + currentFingerprint);
    currentBookmarks.onChange(updateBookmarkUi);
    bookmarksPanel.setStore(currentBookmarks);
    currentLinkPreview = new LinkPreviewController(
      loadedPdf.document,
      viewer,
      viewerContainer,
      {
        getPageTheme: () => readerPreferences.pageTheme,
        onNavigate: (target) => void jumpTo(target),
      },
    );
    navigationHistory.reset();
    updateBookmarkUi();

    emptyState.hidden = true;
    pagesContainer.hidden = false;
    setDocumentReady(true);
    if (currentHistoryId) {
      setTabDocumentId(currentHistoryId);
      readingTimer.setDocument({ id: currentHistoryId, name: file.name });
    }
    totalPages.textContent = String(loadedPdf.document.numPages);

    pageThemeSelect.value = readerPreferences.pageTheme;
    syncAppearanceUi();
    highlightColorSelect.value = readerPreferences.highlightColor;
    scrollModeSelect.value = readerPreferences.scrollMode;
    spreadModeSelect.value = readerPreferences.spreadMode;

    updateZoomUi();

    const preferredPanel =
      readerPreferences.sidebarPanel === "attachments" &&
      attachmentsTab.hidden
        ? "thumbnails"
        : readerPreferences.sidebarPanel === "layers" &&
            layersTab.hidden
          ? "thumbnails"
          : readerPreferences.sidebarPanel;

    showSidebarPanel(preferredPanel, false);
    setSidebarOpen(readerPreferences.sidebarOpen, false);

    // initialize() has already restored and aligned this page at final zoom.

    if (sequence !== openSequence || currentViewer !== viewer) {
      return;
    }

    updatePageUi(initialPage);
    updateHighlightUi();
    if (restore) {
      // initialize() starts at the restored page rather than rendering page 1.
      // Align the exact intra-page offset after the final layout is in place.
      if (initialPage === restore.page && Number.isFinite(restore.scrollTop) && Number.isFinite(restore.scrollLeft)) {
        viewerContainer.scrollTo({
          top: Math.max(0, restore.scrollTop),
          left: Math.max(0, restore.scrollLeft),
          behavior: "instant",
        });
      }
    }
    if (currentHistoryId) {
      const recordId = currentHistoryId;
      const selectedHandle = fileHandle;
      const position = currentReadingPosition();
      if (position) {
        const record: HistoryRecord = {
          ...position,
          id: recordId,
          name: file.name,
          size: file.size,
          lastModified: file.lastModified ?? 0,
          fileHandle: selectedHandle,
        };
        void rememberDocument(record).then(async () => {
          if (sequence === openSequence && currentHistoryId === recordId) {
            await setActiveDocumentId(recordId);
            rememberForThisWindow(recordId);
          }
          if (historySettings.cacheLocalFiles && file.originalBlob && !file.cachedSource) {
            queueLocalCache(recordId, file.originalBlob);
          } else if (source === "extension" && historySettings.cacheLocalFiles) {
            queueExtensionCache(recordId, loadedPdf!, file.size, sequence);
          }
        }).catch(reportHistoryError);
      }
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(finishLoadingShell);
    });

    document.title = `${file.name} — ${"PageNest PDF"}`;
    showStatus(
      t("{name} · {size} · local only", {
        name: file.name,
        size: formatBytes(file.size),
      }),
      3200,
    );

    initializeBackgroundDocumentServices(
      loadedPdf,
      viewer,
      sequence,
    );
  } catch (error) {
    if (sequence !== openSequence) {
      return;
    }

    if (loadedPdf && currentPdf !== loadedPdf) {
      await loadedPdf.destroy();
    } else {
      await disposeCurrentPdf();
    }

    resetLoadingShell();
    emptyState.hidden = false;
    showStatus(describePdfError(error), 6000);
  }
}

/** Jump somewhere, remembering the current spot for Back. */
async function jumpTo(target: ViewPosition, record = true): Promise<boolean> {
  const viewer = currentViewer;
  if (!viewer) return false;
  if (record) navigationHistory.record(viewer.getViewPosition());
  return viewer.goToPage(target.pageNumber, { offsetFraction: target.fraction });
}

function goBack(): void {
  const viewer = currentViewer;
  const target = viewer ? navigationHistory.back(viewer.getViewPosition()) : null;
  if (viewer && target) void viewer.goToPage(target.pageNumber, { offsetFraction: target.fraction });
}

function goForward(): void {
  const viewer = currentViewer;
  const target = viewer ? navigationHistory.forward(viewer.getViewPosition()) : null;
  if (viewer && target) void viewer.goToPage(target.pageNumber, { offsetFraction: target.fraction });
}

function updateNavigationUi(): void {
  const hasViewer = Boolean(currentViewer);
  navigateBackButton.disabled = !hasViewer || !navigationHistory.canGoBack;
  navigateForwardButton.disabled = !hasViewer || !navigationHistory.canGoForward;
  secondaryBack.disabled = navigateBackButton.disabled;
  secondaryForward.disabled = navigateForwardButton.disabled;
}

function updateBookmarkUi(): void {
  const viewer = currentViewer;
  const pressed = Boolean(viewer && currentBookmarks?.findOnPage(viewer.currentPage));
  bookmarkToggle.setAttribute("aria-pressed", String(pressed));
  bookmarkToggle
    .querySelector("use")
    ?.setAttribute("href", pressed ? "#i-bookmark-fill" : "#i-bookmark");
}

function addBookmark(): void {
  const viewer = currentViewer;
  const store = currentBookmarks;
  if (!viewer || !store) return;
  const position = viewer.getViewPosition();
  store.add(position, t("Page {page}", { page: position.pageNumber }));
  showStatus(t("Bookmarked page {page}.", { page: position.pageNumber }), 1800);
}

/** ⌘D / toolbar: bookmark the current page, or remove its bookmark. */
function toggleBookmark(): void {
  const viewer = currentViewer;
  const existing = viewer ? currentBookmarks?.findOnPage(viewer.currentPage) : undefined;
  if (existing) {
    currentBookmarks?.remove(existing.id);
    showStatus("Bookmark removed.", 1800);
  } else {
    addBookmark();
  }
}

async function jumpToHighlight(item: UserHighlight): Promise<void> {
  const highlights = currentHighlights;
  const viewer = currentViewer;
  if (!highlights || !viewer) return;

  await jumpTo({
    pageNumber: item.pageNumber,
    fraction: Math.max(0, (item.fraction ?? 0) - 0.06),
  });

  // The text layer may still be rendering; wait briefly before flashing.
  let range = highlights.rangeFor(item.id);
  for (let attempt = 0; !range && attempt < 30; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    range = highlights.rangeFor(item.id);
  }
  if (!range || currentHighlights !== highlights) return;

  const rect = range.getBoundingClientRect();
  const root = viewerContainer.getBoundingClientRect();
  const inset = parseFloat(getComputedStyle(viewerContainer).scrollPaddingTop) || 0;
  if (rect.top < root.top + inset || rect.bottom > root.bottom) {
    viewerContainer.scrollBy({ top: rect.top - root.top - inset - 60 });
  }
  highlights.flash(item.id);
}

async function goToPageFromInput(): Promise<void> {
  const viewer = currentViewer;

  if (!viewer) {
    return;
  }

  const pageNumber = Number(pageNumberInput.value);

  if (!Number.isFinite(pageNumber)) {
    updatePageUi(viewer.currentPage);
    return;
  }

  await jumpTo({ pageNumber, fraction: 0 });
}

function setZoomFromSelect(): void {
  const viewer = currentViewer;

  if (!viewer) {
    return;
  }

  cancelPendingWheelZoom();
  cancelPendingZoomCommit();
  viewer.commitScalePreview();

  const value = zoomSelect.value;

  if (
    value === "automatic" ||
    value === "actual" ||
    value === "page-fit" ||
    value === "page-width"
  ) {
    viewer.setZoomMode(value);
    readerPreferences.zoomMode = value;
  } else if (value !== "custom") {
    const scale = Number(value);

    if (Number.isFinite(scale)) {
      viewer.previewScale(scale);
      viewer.commitScalePreview();
      readerPreferences.zoomMode = "custom";
      readerPreferences.zoomScale = viewer.scale;
    }
  }

  saveReaderPreferences();
  updateZoomUi();
}

function cancelPendingZoomCommit(): void {
  if (zoomCommitTimer !== null) {
    window.clearTimeout(zoomCommitTimer);
    zoomCommitTimer = null;
  }
}

function cancelPendingWheelZoom(): void {
  if (wheelZoomRaf !== null) {
    cancelAnimationFrame(wheelZoomRaf);
    wheelZoomRaf = null;
  }

  wheelZoomFactor = 1;
  wheelZoomAnchor = null;
}

function scheduleZoomCommit(): void {
  cancelPendingZoomCommit();

  zoomCommitTimer = window.setTimeout(() => {
    zoomCommitTimer = null;
    const viewer = currentViewer;

    if (!viewer) {
      return;
    }

    viewer.commitScalePreview();
    readerPreferences.zoomMode = "custom";
    readerPreferences.zoomScale = viewer.scale;
    saveReaderPreferences();
    updateZoomUi();
  }, ZOOM_COMMIT_DELAY_MS);
}

function zoomStepForScale(scale: number): number {
  if (scale < 2) {
    return 0.05;
  }

  if (scale < 3) {
    return 0.1;
  }

  return 0.2;
}

function adjustZoom(
  direction: -1 | 1,
  anchor?: { clientX: number; clientY: number },
): void {
  const viewer = currentViewer;

  if (!viewer) {
    return;
  }

  const step = zoomStepForScale(viewer.scale);
  const nextScale = Math.min(
    MAX_MANUAL_SCALE,
    Math.max(
      MIN_MANUAL_SCALE,
      Math.round((viewer.scale + direction * step) * 100) / 100,
    ),
  );

  viewer.previewScale(nextScale, anchor);
  readerPreferences.zoomMode = "custom";
  readerPreferences.zoomScale = viewer.scale;
  updateZoomUi();
  scheduleZoomCommit();
}

function adjustWheelZoom(event: WheelEvent): void {
  if (!currentViewer) {
    return;
  }

  const rawFactor = Math.exp(
    -event.deltaY *
      BASE_WHEEL_ZOOM_GAIN *
      readerPreferences.zoomSensitivity,
  );

  // Preserve the existing per-event sensitivity curve, but merge all wheel
  // events received in the same paint frame. Multiplying the factors is
  // equivalent to applying them one by one without paying repeated layout
  // and geometry costs.
  wheelZoomFactor *= Math.min(1.12, Math.max(0.88, rawFactor));
  wheelZoomAnchor = {
    clientX: event.clientX,
    clientY: event.clientY,
  };

  if (wheelZoomRaf !== null) {
    return;
  }

  wheelZoomRaf = requestAnimationFrame(() => {
    wheelZoomRaf = null;
    const viewer = currentViewer;
    const anchor = wheelZoomAnchor;
    const factor = wheelZoomFactor;

    wheelZoomFactor = 1;
    wheelZoomAnchor = null;

    if (!viewer || !anchor || factor === 1) {
      return;
    }

    const nextScale = Math.min(
      MAX_MANUAL_SCALE,
      Math.max(
        MIN_MANUAL_SCALE,
        Math.round(viewer.scale * factor * 1000) / 1000,
      ),
    );

    viewer.previewScale(nextScale, anchor);
    readerPreferences.zoomMode = "custom";
    readerPreferences.zoomScale = viewer.scale;
    updateZoomUi();
    scheduleZoomCommit();
  });
}

function rotateViewer(delta: -90 | 90): void {
  const viewer = currentViewer;

  if (!viewer) {
    return;
  }

  cancelPendingWheelZoom();
  cancelPendingZoomCommit();
  viewer.commitScalePreview();
  viewer.setRotation(viewer.rotation + delta);
  currentThumbnails?.setRotation(viewer.rotation);
  setSecondaryOpen(false);
}

function setScrollModeFromSelect(): void {
  const viewer = currentViewer;
  const mode = scrollModeSelect.value as ScrollMode;

  if (!viewer) {
    return;
  }

  viewer.setScrollMode(mode);
  readerPreferences.scrollMode = mode;
  saveReaderPreferences();
}

function setSpreadModeFromSelect(): void {
  const viewer = currentViewer;
  const mode = spreadModeSelect.value as SpreadMode;

  if (!viewer) {
    return;
  }

  viewer.setSpreadMode(mode);
  readerPreferences.spreadMode = mode;
  saveReaderPreferences();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function currentPdfBlob(): Promise<Blob | null> {
  const loaded = currentPdf;
  const file = currentFile;

  if (!loaded || !file) {
    return null;
  }

  const hasStoredChanges =
    loaded.document.annotationStorage.size > 0;

  if (!hasStoredChanges) {
    if (file.originalBlob) {
      return file.originalBlob;
    }

    const bytes = await loaded.document.getData();

    if (currentPdf !== loaded) {
      return null;
    }

    return new Blob([bytes as BlobPart], {
      type: file.type || "application/pdf",
    });
  }

  const bytes = await loaded.document.saveDocument();

  if (currentPdf !== loaded) {
    return null;
  }

  return new Blob([bytes as BlobPart], {
    type: "application/pdf",
  });
}

async function saveCurrentPdf(): Promise<void> {
  const file = currentFile;
  if (!file) {
    return;
  }

  try {
    const blob = await currentPdfBlob();
    if (!blob) {
      return;
    }

    downloadBlob(blob, file.name);
  } catch {
    showStatus(
      "Could not save the current form changes. The original PDF was not downloaded.",
      5000,
    );
  }
}

let printInProgress = false;

async function printCurrentPdf(): Promise<void> {
  const loaded = currentPdf;

  if (!loaded) {
    return;
  }

  if (printInProgress) {
    showStatus("Printing is already being prepared.", 2500);
    return;
  }

  printInProgress = true;
  const total = loaded.document.numPages;
  showStatus(t("Preparing pages for printing… {done} / {total}", { done: 0, total }), 0);

  try {
    await printPdfDocument(loaded.document, {
      onProgress(done) {
        showStatus(
          t("Preparing pages for printing… {done} / {total}", { done, total }),
          done === total ? 1200 : 0,
        );
      },
    });
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      showStatus("Could not prepare the PDF for printing.", 5000);
    }
  } finally {
    printInProgress = false;
  }
}

function formatPdfDate(value: unknown): string {
  if (typeof value !== "string") {
    return value == null ? "—" : String(value);
  }

  const match =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?'?/.exec(
      value,
    );

  if (!match) {
    return value || "—";
  }

  const [
    ,
    year,
    month = "01",
    day = "01",
    hour = "00",
    minute = "00",
    second = "00",
    zone,
    zoneHour = "00",
    zoneMinute = "00",
  ] = match;

  const parts = [
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ] as const;

  let date: Date;

  if (zone === "Z") {
    date = new Date(Date.UTC(...parts));
  } else if (zone === "+" || zone === "-") {
    const offsetMinutes = Number(zoneHour) * 60 + Number(zoneMinute);
    const signedOffset = zone === "+" ? offsetMinutes : -offsetMinutes;
    date = new Date(Date.UTC(...parts) - signedOffset * 60_000);
  } else {
    date = new Date(...parts);
  }

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function showDocumentProperties(): Promise<void> {
  const loaded = currentPdf;
  const file = currentFile;

  if (!loaded || !file) {
    return;
  }

  const { info, metadata } = await loaded.document.getMetadata();

  if (currentPdf !== loaded) {
    return;
  }

  const infoRecord = info as Record<string, unknown>;
  const firstPageProxy = await loaded.document.getPage(1);
  const viewport = firstPageProxy.getViewport({ scale: 1 });

  if (currentViewer?.canCleanupPageResources(1)) {
    firstPageProxy.cleanup();
  }

  if (currentPdf !== loaded) {
    return;
  }

  const metadataTitle =
    typeof metadata?.get === "function" ? metadata.get("dc:title") : null;

  const rows: Array<[string, unknown]> = [
    ["File name", file.name],
    ["File size", formatBytes(file.size)],
    ["Title", infoRecord.Title ?? metadataTitle],
    ["Author", infoRecord.Author],
    ["Subject", infoRecord.Subject],
    ["Keywords", infoRecord.Keywords],
    ["Creator", infoRecord.Creator],
    ["Producer", infoRecord.Producer],
    ["Creation date", formatPdfDate(infoRecord.CreationDate)],
    ["Modified date", formatPdfDate(infoRecord.ModDate)],
    ["PDF version", infoRecord.PDFFormatVersion],
    ["Pages", loaded.document.numPages],
    [
      "First page size",
      `${Math.round(viewport.width)} × ${Math.round(viewport.height)} pt`,
    ],
  ];

  const fragment = document.createDocumentFragment();

  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");

    term.textContent = t(label);
    description.textContent =
      value === null || value === undefined || value === "" ? "—" : String(value);

    fragment.append(term, description);
  }

  propertiesList.replaceChildren(fragment);

  if (!documentProperties.open) {
    documentProperties.showModal();
  }

  setSecondaryOpen(false);
}

async function enterPresentationMode(): Promise<void> {
  const viewer = currentViewer;

  if (!viewer) {
    return;
  }

  presentationRestore = {
    mode: viewer.zoomMode,
    scale: viewer.scale,
    sidebarOpen: !sidebar.hidden,
  };

  try {
    await readerApp.requestFullscreen();
    readerApp.classList.add("presentation-mode");
    setSidebarOpen(false, false);
    syncSidebarEdge();
    viewer.setZoomMode("page-fit");
    updateZoomUi();
    setSecondaryOpen(false);
  } catch {
    presentationRestore = null;
    showStatus("Presentation mode is not available.", 4000);
  }
}

function restoreAfterPresentation(): void {
  const viewer = currentViewer;
  const restore = presentationRestore;
  presentationRestore = null;
  readerApp.classList.remove("presentation-mode");
  syncSidebarEdge();

  if (!viewer || !restore) {
    return;
  }

  if (restore.mode === "custom") {
    viewer.setScale(restore.scale);
  } else {
    viewer.setZoomMode(restore.mode);
  }

  setSidebarOpen(restore.sidebarOpen, false);
  updateZoomUi();
}

function targetIsTextEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

fileInput.addEventListener("change", () => {
  // The native input picker does not grant a persistent FileSystemFileHandle.
  const file = fileInput.files?.[0];

  if (file) {
    void openLocalPdf(file);
  }
});


recentButton.addEventListener("click", showRecentDocuments);
secondaryRecent.addEventListener("click", showRecentDocuments);
secondaryStats.addEventListener("click", () => void showReadingStats());
recentOpenFile.addEventListener("click", () => {
  recentDialog.close();
  openFilePicker();
});
recentStatsButton.addEventListener("click", () => void showReadingStats());
statsClose.addEventListener("click", () => statsDialog.close());
statsDone.addEventListener("click", () => statsDialog.close());
statsClear.addEventListener("click", async () => {
  if (!window.confirm(t("Clear all reading statistics? This cannot be undone."))) return;
  try {
    await readingTimer.flush();
    await clearReadingTime();
    readingStats.setRecords([]);
  } catch (error) {
    reportHistoryError(error);
  }
});

// Whichever reader tab you return to becomes its window's latest document,
// and a tab dragged into another window carries its document along.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentHistoryId) rememberForThisWindow(currentHistoryId);
});
onWindowIdChange(() => {
  if (currentHistoryId) rememberForThisWindow(currentHistoryId);
});
emptyRecent.addEventListener("click", showRecentDocuments);
recentClose.addEventListener("click", () => recentDialog.close());
recentDone.addEventListener("click", () => recentDialog.close());
recentClearCache.addEventListener("click", () => { void clearOfflineCache(); });
clearPdfCacheButton.addEventListener("click", () => { void clearOfflineCache(); });
restoreSessionCheckbox.addEventListener("change", () => {
  historySettings.restorePreviousSession = restoreSessionCheckbox.checked;
  void setHistorySettings(historySettings).catch(reportHistoryError);
});
cacheLocalPdfsCheckbox.addEventListener("change", () => {
  historySettings.cacheLocalFiles = cacheLocalPdfsCheckbox.checked;
  void setHistorySettings(historySettings).catch(reportHistoryError);
  if (!historySettings.cacheLocalFiles) void clearOfflineCache();
  else if (currentHistoryId && currentFile?.originalBlob) {
    queueLocalCache(currentHistoryId, currentFile.originalBlob);
  }
});
viewerContainer.addEventListener("scroll", scheduleProgressSave, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) void saveCurrentPosition();
  else if (!currentViewer && !extensionHandoffActive) void initializeHistory();
});
window.addEventListener("pagehide", () => { void saveCurrentPosition(); });
window.addEventListener("pageshow", () => {
  if (!currentViewer && !extensionHandoffActive) void initializeHistory();
});
document.addEventListener("freeze", () => { void saveCurrentPosition(); });
document.addEventListener("resume", () => {
  if (!currentViewer && !extensionHandoffActive) void initializeHistory();
});
openFileButton.addEventListener("click", openFilePicker);
secondaryOpen.addEventListener("click", openFilePicker);
exitReaderButton.addEventListener("click", () => {
  void exitReader();
});

sidebarToggle.addEventListener("click", () => {
  // Clicking while the sidebar is peeking pins it open.
  setSidebarOpen(sidebarPeekVisible() || sidebar.hidden);
});

/*
 * The trigger is a distance from the reader's left edge rather than an
 * overlay strip, so it never blocks clicks or text selection, and it can be
 * wide enough that the pointer need not touch the window edge (where
 * Chrome's vertical tab strip lives).
 */
readerBody.addEventListener("pointermove", (event) => {
  if (!sidebarEdgeEnabled || event.pointerType === "touch") return;

  const overSidebar =
    sidebarPeekVisible() && sidebar.contains(event.target as Node);
  const inZone =
    event.clientX - readerBody.getBoundingClientRect().left <=
    readerPreferences.sidebarRevealWidth;

  // Don't start a peek in the middle of a drag (e.g. selecting text).
  if (overSidebar || (inZone && (event.buttons === 0 || sidebarPeekState !== "idle"))) {
    requestSidebarPeek(SIDEBAR_PEEK_DELAY);
  } else {
    releaseSidebarPeek();
  }
});

// Hovering the sidebar button also peeks it; clicking then pins it.
sidebarToggle.addEventListener("pointerenter", (event) => {
  if (event.pointerType !== "touch") {
    requestSidebarPeek(SIDEBAR_BUTTON_PEEK_DELAY);
  }
});

sidebarToggle.addEventListener("pointerleave", releaseSidebarPeek);

// Leaving the page (e.g. into the browser's tab strip) never opens it.
readerBody.addEventListener("pointerleave", releaseSidebarPeek);

sidebarAutoRevealCheckbox.addEventListener("change", () => {
  readerPreferences.sidebarAutoReveal = sidebarAutoRevealCheckbox.checked;
  saveReaderPreferences();
  syncSidebarEdge();
});

function applyGlassSettings(): void {
  const prefs = readerPreferences;
  const root = document.documentElement.style;
  root.setProperty("--glass-frost", String(prefs.glassFrost / 100));
  root.setProperty("--glass-rim-k", String(prefs.glassRim / 60));
  root.setProperty("--edge-blur", `${prefs.toolbarBlur}px`);
  root.setProperty("--edge-tint", `${Math.min(55, prefs.toolbarBlur * 11)}%`);
  liquidGlass.setTuning({
    refraction: prefs.glassRefraction / 100,
    frost: prefs.glassFrost / 100,
  });

  glassRefractionInput.value = String(prefs.glassRefraction);
  glassRimInput.value = String(prefs.glassRim);
  glassFrostInput.value = String(prefs.glassFrost);
  toolbarBlurInput.value = String(prefs.toolbarBlur);
  sidebarRevealWidthInput.value = String(prefs.sidebarRevealWidth);
  glassRefractionValue.value = `${prefs.glassRefraction}%`;
  glassRimValue.value = `${prefs.glassRim}%`;
  glassFrostValue.value = `${prefs.glassFrost}%`;
  toolbarBlurValue.value = `${prefs.toolbarBlur} px`;
  sidebarRevealWidthValue.value = `${prefs.sidebarRevealWidth} px`;
  glassRefractionInput.disabled = !liquidGlass.supported || !prefs.liquidGlass;
}

const glassSliders: Array<
  [HTMLInputElement, "glassRefraction" | "glassRim" | "glassFrost" | "toolbarBlur" | "sidebarRevealWidth"]
> = [
  [glassRefractionInput, "glassRefraction"],
  [glassRimInput, "glassRim"],
  [glassFrostInput, "glassFrost"],
  [toolbarBlurInput, "toolbarBlur"],
  [sidebarRevealWidthInput, "sidebarRevealWidth"],
];

for (const [input, key] of glassSliders) {
  input.addEventListener("input", () => {
    readerPreferences[key] = Number(input.value);
    applyGlassSettings();
  });
  input.addEventListener("change", saveReaderPreferences);
}

glassResetButton.addEventListener("click", () => {
  for (const key of ["glassRefraction", "glassRim", "glassFrost", "toolbarBlur"] as const) {
    readerPreferences[key] = DEFAULT_PREFERENCES[key];
  }
  saveReaderPreferences();
  applyGlassSettings();
});

liquidGlassCheckbox.addEventListener("change", () => {
  readerPreferences.liquidGlass = liquidGlassCheckbox.checked;
  saveReaderPreferences();
  liquidGlass.setEnabled(readerPreferences.liquidGlass);
  applyGlassSettings();
});

languageSelect.addEventListener("change", () => {
  applyLanguage(languageSelect.value as LanguagePreference);
});

thumbnailTab.addEventListener("click", () => showSidebarPanel("thumbnails"));
outlineTab.addEventListener("click", () => showSidebarPanel("outline"));
attachmentsTab.addEventListener("click", () =>
  showSidebarPanel("attachments"),
);
layersTab.addEventListener("click", () => showSidebarPanel("layers"));

pageNumberInput.addEventListener("change", () => {
  void goToPageFromInput();
});

pageNumberInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void goToPageFromInput();
  }
});

zoomOut.addEventListener("click", () => adjustZoom(-1));
zoomIn.addEventListener("click", () => adjustZoom(1));
zoomSelect.addEventListener("change", setZoomFromSelect);

for (const control of [
  appearanceBrightness,
  appearanceContrast,
  appearanceTemperature,
  appearanceSaturation,
]) {
  control.addEventListener("input", scheduleAppearanceApply);
}

appearanceBackground.addEventListener(
  "change",
  applyAppearanceColorOverrides,
);
appearanceForeground.addEventListener(
  "change",
  applyAppearanceColorOverrides,
);

appearanceUsePreset.addEventListener("click", () => {
  readerPreferences.pageAppearance = normalizePageAppearance({
    ...readerPreferences.pageAppearance,
    backgroundOverride: null,
    foregroundOverride: null,
  });
  saveReaderPreferences();
  currentViewer?.setPageAppearance(
    readerPreferences.pageAppearance,
  );
  syncAppearanceUi();
});

appearanceReset.addEventListener("click", () => {
  readerPreferences.pageAppearance = {
    ...DEFAULT_PAGE_APPEARANCE,
  };
  saveReaderPreferences();
  currentViewer?.setPageAppearance(
    readerPreferences.pageAppearance,
  );
  syncAppearanceUi();
});

findToggle.addEventListener("click", () => setFindbarOpen(findbar.hidden));
findClose.addEventListener("click", () => setFindbarOpen(false));
findPrevious.addEventListener("click", () => {
  void currentSearch?.previous();
});
findNext.addEventListener("click", () => {
  void currentSearch?.next();
});

findInput.addEventListener("input", scheduleSearch);
highlightSelectionButton.addEventListener("click", () => {
  const color =
    highlightColorSelect.value as UserHighlightColor;

  const highlights = currentHighlights;
  if (!highlights) return;

  const changed =
    highlights.selectionCoverage() === "full"
      ? highlights.eraseSelection()
      : highlights.addSelection(color);

  if (changed) {
    // Clear the selection so the next click on the highlight opens its editor.
    document.getSelection()?.removeAllRanges();
    updateHighlightUi();
  }
});

highlightColorSelect.addEventListener("change", () => {
  readerPreferences.highlightColor =
    highlightColorSelect.value as UserHighlightColor;
  saveReaderPreferences();
});

clearHighlights.addEventListener("click", () => {
  currentHighlights?.clearAll();
  updateHighlightUi();
});

findInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();

    if (event.shiftKey) {
      void currentSearch?.previous();
    } else {
      void currentSearch?.next();
    }
  } else if (event.key === "Escape") {
    event.preventDefault();
    setFindbarOpen(false);
  }
});

printButton.addEventListener("click", () => {
  void printCurrentPdf();
});
saveButton.addEventListener("click", () => {
  void saveCurrentPdf();
});
secondaryPrint.addEventListener("click", () => {
  setSecondaryOpen(false);
  void printCurrentPdf();
});
secondarySave.addEventListener("click", () => {
  setSecondaryOpen(false);
  void saveCurrentPdf();
});

secondaryToggle.addEventListener("click", () => {
  setSecondaryOpen(secondaryToolbar.hidden);
});

presentationMode.addEventListener("click", () => {
  void enterPresentationMode();
});

firstPage.addEventListener("click", () => {
  void jumpTo({ pageNumber: 1, fraction: 0 });
  setSecondaryOpen(false);
});

lastPage.addEventListener("click", () => {
  const viewer = currentViewer;
  if (viewer) {
    void jumpTo({ pageNumber: viewer.totalPages, fraction: 0 });
  }
  setSecondaryOpen(false);
});

navigateBackButton.addEventListener("click", goBack);
navigateForwardButton.addEventListener("click", goForward);
secondaryBack.addEventListener("click", () => {
  goBack();
  setSecondaryOpen(false);
});
secondaryForward.addEventListener("click", () => {
  goForward();
  setSecondaryOpen(false);
});
bookmarkToggle.addEventListener("click", toggleBookmark);
secondaryBookmark.addEventListener("click", () => {
  addBookmark();
  setSecondaryOpen(false);
});
annotationsTab.addEventListener("click", () => showSidebarPanel("annotations"));
bookmarksTab.addEventListener("click", () => showSidebarPanel("bookmarks"));

// Mouse back/forward buttons walk the in-document history first.
window.addEventListener("mouseup", (event) => {
  if (event.button === 3 && navigationHistory.canGoBack) {
    event.preventDefault();
    goBack();
  } else if (event.button === 4 && navigationHistory.canGoForward) {
    event.preventDefault();
    goForward();
  }
});

// Clicking highlighted text opens its color/note editor. A "click" is judged
// by pointer travel, not selection state: a click that dismisses a leftover
// selection still counts.
let highlightPointerDown: { x: number; y: number } | null = null;
viewerContainer.addEventListener("pointerdown", (event) => {
  highlightPointerDown = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
});

viewerContainer.addEventListener("click", (event) => {
  const highlights = currentHighlights;
  const down = highlightPointerDown;
  highlightPointerDown = null;
  if (!highlights || event.button !== 0 || event.detail > 1) return;
  if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
  if ((event.target as Element).closest("a, button, input, textarea, select")) return;
  const id = highlights.highlightAt(event.clientX, event.clientY);
  const range = id ? highlights.rangeFor(id) : null;
  if (id && range) {
    highlightPopover.show(highlights, id, range.getBoundingClientRect());
  }
});

rotateCounterclockwise.addEventListener("click", () => rotateViewer(-90));
rotateClockwise.addEventListener("click", () => rotateViewer(90));

scrollModeSelect.addEventListener("change", setScrollModeFromSelect);
spreadModeSelect.addEventListener("change", setSpreadModeFromSelect);

zoomSensitivity.addEventListener("input", () => {
  const value = Number(zoomSensitivity.value) / 100;

  readerPreferences.zoomSensitivity = Math.min(
    2,
    Math.max(0.5, value),
  );
  zoomSensitivityValue.value =
    `${readerPreferences.zoomSensitivity.toFixed(1)}×`;
  saveReaderPreferences();
});

pageThemeSelect.addEventListener("change", () => {
  const theme = pageThemeSelect.value as PageTheme;
  currentViewer?.setPageTheme(theme);
  readerPreferences.pageTheme = theme;
  saveReaderPreferences();
  syncAppearanceUi();
});

uiThemeSelect.addEventListener("change", () => {
  applyUiTheme(uiThemeSelect.value as UiTheme);
});

documentPropertiesButton.addEventListener("click", () => {
  void showDocumentProperties();
});

window.addEventListener("message", handleExtensionPdfMessage);

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    restoreAfterPresentation();
  }
});

document.addEventListener("selectionchange", () => {
  updateHighlightUi();
});

viewerContainer.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  dropOverlay.hidden = false;
});

viewerContainer.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
});

viewerContainer.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);

  if (dragDepth === 0) {
    dropOverlay.hidden = true;
  }
});

viewerContainer.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;

  const file = event.dataTransfer?.files[0];

  if (file) {
    void openLocalPdf(file);
  }
});

viewerContainer.addEventListener(
  "wheel",
  (event) => {
    if (!currentViewer || (!event.ctrlKey && !event.metaKey)) {
      return;
    }

    event.preventDefault();
    adjustWheelZoom(event);
  },
  { passive: false },
);

document.addEventListener("click", (event) => {
  if (
    !secondaryToolbar.hidden &&
    event.target instanceof Node &&
    !secondaryToolbar.contains(event.target) &&
    !secondaryToggle.contains(event.target)
  ) {
    setSecondaryOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  const command = event.metaKey || event.ctrlKey;
  const key = event.key.toLocaleLowerCase();

  if (command && key === "o") {
    event.preventDefault();
    openFilePicker();
    return;
  }

  if (command && key === "f" && currentViewer) {
    event.preventDefault();
    setFindbarOpen(true);
    return;
  }

  if (command && key === "s" && currentFile) {
    event.preventDefault();
    void saveCurrentPdf();
    return;
  }

  if (command && (event.key === "[" || event.key === "]") && currentViewer) {
    event.preventDefault();
    if (event.key === "[") goBack();
    else goForward();
    return;
  }

  if (command && key === "d" && currentViewer) {
    event.preventDefault();
    toggleBookmark();
    return;
  }

  if (command && key === "p" && currentFile) {
    event.preventDefault();
    void printCurrentPdf();
    return;
  }

  if (command && (key === "+" || key === "=") && currentViewer) {
    event.preventDefault();
    adjustZoom(1);
    return;
  }

  if (command && key === "-" && currentViewer) {
    event.preventDefault();
    adjustZoom(-1);
    return;
  }

  if (command && key === "0" && currentViewer) {
    event.preventDefault();
    cancelPendingWheelZoom();
    cancelPendingZoomCommit();
    currentViewer.commitScalePreview();
    currentViewer.setZoomMode("actual");
    readerPreferences.zoomMode = "actual";
    saveReaderPreferences();
    updateZoomUi();
    return;
  }

  if (event.key === "Escape") {
    if (!findbar.hidden) {
      setFindbarOpen(false);
    }
    if (!secondaryToolbar.hidden) {
      setSecondaryOpen(false);
    }
    return;
  }

  if (targetIsTextEditing(event.target) || !currentViewer) {
    return;
  }

  if (!command && key === "r") {
    event.preventDefault();
    rotateViewer(event.shiftKey ? -90 : 90);
    return;
  }

  if (event.altKey && !command && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    if (event.key === "ArrowLeft") goBack();
    else goForward();
    return;
  }

  if (event.key === "Home") {
    event.preventDefault();
    void jumpTo({ pageNumber: 1, fraction: 0 });
  } else if (event.key === "End") {
    event.preventDefault();
    void jumpTo({ pageNumber: currentViewer.totalPages, fraction: 0 });
  }
});

const liquidGlass = installLiquidGlass(
  ".glass-group, .findbar, .status-toast, .sidebar, .secondary-toolbar",
);
liquidGlass.setEnabled(readerPreferences.liquidGlass);
liquidGlassCheckbox.checked = readerPreferences.liquidGlass;
liquidGlassCheckbox.disabled = !liquidGlass.supported;
sidebarAutoRevealCheckbox.checked = readerPreferences.sidebarAutoReveal;
applyGlassSettings();

const navigationHistory = new NavigationHistory(updateNavigationUi);
const tabPresence = new TabPresence(() => ({
  windowId: currentWindowId(),
  documentId: currentViewer ? currentHistoryId : null,
}));
const readingTimer = new ReadingTimer(viewerContainer, reportHistoryError);
let readingStatsDocuments = new Set<string>();
const readingStats = new ReadingStatsView(statsBody, {
  canOpenDocument: (id) => readingStatsDocuments.has(id),
  onOpenDocument: (id) => {
    statsDialog.close();
    void getDocument(id).then((record) => {
      if (record) void reopenHistoryRecord(record, true);
    }).catch(reportHistoryError);
  },
});
const highlightPopover = new HighlightPopover();
const annotationsPanel = new AnnotationsPanel(annotationsView, {
  onJump: (item) => void jumpToHighlight(item),
  onEdit: (item, anchor) => {
    const highlights = currentHighlights;
    if (highlights) {
      highlightPopover.show(highlights, item.id, anchor.getBoundingClientRect(), {
        focusNote: true,
      });
    }
  },
  onStatus: (message) => showStatus(message, 2400),
  getDocumentName: () => currentFile?.name ?? "PageNest PDF",
});
const bookmarksPanel = new BookmarksPanel(bookmarksView, {
  onAdd: addBookmark,
  onJump: (bookmark) => void jumpTo(bookmark),
});

const storedLanguage = getStoredLanguage();
languageSelect.value = storedLanguage;
applyLanguage(storedLanguage);
annotationsPanel.localize();
bookmarksPanel.localize();
highlightPopover.localize();
onLocaleChange(() => {
  syncAppearanceUi();
  annotationsPanel.localize();
  bookmarksPanel.localize();
  highlightPopover.localize();
  if (statsDialog.open) readingStats.render();
  if (currentFile) {
    document.title = `${currentFile.name} — ${"PageNest PDF"}`;
  } else {
    document.title = "PageNest PDF";
  }
  if (recentDialog.open) {
    void renderRecentDocuments();
  }
});

const storedUiTheme = getStoredUiTheme();
uiThemeSelect.value = storedUiTheme;
pageThemeSelect.value = readerPreferences.pageTheme;
highlightColorSelect.value = readerPreferences.highlightColor;
scrollModeSelect.value = readerPreferences.scrollMode;
spreadModeSelect.value = readerPreferences.spreadMode;
syncZoomSensitivityUi();
applyUiTheme(storedUiTheme);
setDocumentReady(false);
updatePageUi(1);
updateZoomUi();
syncAppearanceUi();
updateHighlightUi();
showSidebarPanel(readerPreferences.sidebarPanel, false);
setSidebarOpen(false, false);

void initializeHistory();

if (extensionTransferToken()) {
  // The extension owns its handoff; never restore into its receiving tab.
  emptyState.hidden = true;
  showLoadingShell({
    stage: "Connecting to PDF",
    detail: "Preparing the secure extension handoff",
    progress: null,
  });
  document.documentElement.classList.remove("extension-handoff");
}

// Startup finished: every listener above is registered.
document.documentElement.dataset.readerReady = "true";
