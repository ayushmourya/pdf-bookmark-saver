console.log("PDF Bookmark extension loaded");

let pdfViewerState = {
  currentPage: 1,
  totalPages: null,
  isTracking: false,
};

function injectViewerMonitor() {
  const script = document.createElement("script");
  script.textContent = `
        // Create a custom event dispatcher
        window.dispatchPDFPageChange = (pageNumber) => {
            window.dispatchEvent(new CustomEvent('__pdfPageChanged', {
                detail: { pageNumber: pageNumber }
            }));
        };

        // Hook into the PDF viewer's native methods
        if (window.PDFViewerApplication) {
            const originalSetPage = window.PDFViewerApplication.pdfViewer._setCurrentPageNumber;
            window.PDFViewerApplication.pdfViewer._setCurrentPageNumber = function(val) {
                window.dispatchPDFPageChange(val);
                return originalSetPage.apply(this, arguments);
            };
        }
    `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

function checkViewerProperties() {
  try {
    const embed = document.querySelector(
      'embed[type="application/x-google-chrome-pdf"]'
    );
    if (embed && embed.postMessage) {
      embed.postMessage(
        {
          type: "getPage",
        },
        "*"
      );
    }

    const pages = document.querySelectorAll(".page");
    if (pages.length > 0) {
      let mostVisiblePage = null;
      let maxVisibleArea = 0;

      pages.forEach((page) => {
        const rect = page.getBoundingClientRect();
        const visibleArea = getVisibleArea(rect);
        if (visibleArea > maxVisibleArea) {
          maxVisibleArea = visibleArea;
          mostVisiblePage = page;
        }
      });

      if (mostVisiblePage) {
        const pageNum = parseInt(
          mostVisiblePage.getAttribute("data-page-number")
        );
        if (pageNum && pageNum !== pdfViewerState.currentPage) {
          updatePageState(pageNum);
        }
      }
    }
  } catch (e) {
    console.error("Error checking viewer properties:", e);
  }
}

function getVisibleArea(rect) {
  const windowHeight = window.innerHeight;
  if (rect.top > windowHeight || rect.bottom < 0) return 0;

  const visibleTop = Math.max(0, rect.top);
  const visibleBottom = Math.min(windowHeight, rect.bottom);
  return visibleBottom - visibleTop;
}

function updatePageState(pageNumber) {
  if (!pageNumber || pageNumber === pdfViewerState.currentPage) return;

  pdfViewerState.currentPage = pageNumber;
  console.log("Page state updated:", pdfViewerState);

  chrome.runtime.sendMessage({
    action: "savePage",
    pageNumber: pageNumber,
    totalPages: pdfViewerState.totalPages,
    url: window.location.href,
    filename: getFilenameFromUrl(window.location.href),
    timestamp: Date.now(),
  });
}

function setupEventListeners() {
  window.addEventListener("__pdfPageChanged", (e) => {
    updatePageState(e.detail.pageNumber);
  });

  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "pageNumber") {
      updatePageState(e.data.pageNumber);
    }
  });

  const viewerContainer =
    document.querySelector("#viewerContainer") || document.body;
  viewerContainer.addEventListener(
    "scroll",
    debounce(() => {
      checkViewerProperties();
    }, 150)
  );

  document.addEventListener("keydown", (e) => {
    if (
      e.key === "ArrowRight" ||
      e.key === "ArrowLeft" ||
      e.key === "PageUp" ||
      e.key === "PageDown"
    ) {
      setTimeout(checkViewerProperties, 100);
    }
  });

  document.addEventListener(
    "wheel",
    debounce(() => {
      checkViewerProperties();
    }, 150)
  );

  setInterval(checkViewerProperties, 1000);
}

function initializePDFMonitoring() {
  if (pdfViewerState.isTracking) return;

  console.log("Initializing PDF monitoring...");

  injectViewerMonitor();

  setupEventListeners();

  setTimeout(checkViewerProperties, 1000);

  pdfViewerState.isTracking = true;
}

function getFilenameFromUrl(url) {
  try {
    const decodedUrl = decodeURIComponent(url);
    return decodedUrl.split("/").pop().split("#")[0] || "Unnamed PDF";
  } catch (e) {
    return "Unnamed PDF";
  }
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCurrentPage") {
    checkViewerProperties(); // Force a check
    sendResponse({
      pageNumber: pdfViewerState.currentPage,
      totalPages: pdfViewerState.totalPages,
      url: window.location.href,
      filename: getFilenameFromUrl(window.location.href),
      timestamp: Date.now(),
    });
    return true;
  } else if (request.action === "jumpToPage") {
    const pageNumber = request.pageNumber;
    if (window.PDFViewerApplication) {
      window.PDFViewerApplication.pdfViewer.currentPageNumber = pageNumber;
      pdfViewerState.currentPage = pageNumber;
      console.log("Jumped to page:", pageNumber);
    }
  }
});

function isPDFViewer() {
  return !!(
    document.querySelector('embed[type="application/x-google-chrome-pdf"]') ||
    document.querySelector('object[type="application/pdf"]') ||
    document.querySelector("#viewerContainer")
  );
}

if (isPDFViewer()) {
  console.log("PDF viewer detected, starting monitoring...");
  const initInterval = setInterval(() => {
    if (document.readyState === "complete") {
      clearInterval(initInterval);
      initializePDFMonitoring();
    }
  }, 100);

  setTimeout(() => clearInterval(initInterval), 10000);
}
